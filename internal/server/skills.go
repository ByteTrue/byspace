package server

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Ported from packages/server/src/server/orchestration-skills/internal/operations.ts
// (getSkillsStatus / applySkills) and sync.ts. The shapes matter: the app renders the three
// states and the per-op target list, so a fabricated "up-to-date" makes the UI lie about
// drifted or missing skill copies.

// SkillTargetIDs are the agent homes BySpace can write, in a stable order.
var SkillTargetIDs = []string{"agents", "claude"}

// legacySkillNames are retired bundled skills that still need cleanup on disk.
// Mirrors LEGACY_SKILL_NAMES in node.
var legacySkillNames = []string{}

// skillFiles maps a skill-relative file path to its SHA-256.
type skillFiles map[string]string

// skillOp is a single add/update/delete convergence step for one skill.
type skillOp struct {
	Kind    string   `json:"kind"`
	Name    string   `json:"name"`
	Targets []string `json:"targets"`
}

// skillsStatus mirrors SkillsStatus in node.
type skillsStatus struct {
	State     string              `json:"state"`
	Ops       []skillOp           `json:"ops"`
	Available []string            `json:"available"`
	Installed []string            `json:"installed"`
	Targets   map[string][]string `json:"targets"`
}

func compareStrings(a, b string) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}

// listBundledSkills returns the skill directories shipped with the repo, sorted.
func listBundledSkills(sourceDir string) []string {
	entries, err := os.ReadDir(sourceDir)
	if err != nil {
		return []string{}
	}
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			out = append(out, e.Name())
		}
	}
	sort.Slice(out, func(i, j int) bool { return compareStrings(out[i], out[j]) < 0 })
	return out
}

// managedSkillNames is every name BySpace owns on disk: shipped now plus retired names.
func managedSkillNames(available []string) []string {
	set := make(map[string]bool, len(available)+len(legacySkillNames))
	for _, n := range available {
		set[n] = true
	}
	for _, n := range legacySkillNames {
		set[n] = true
	}
	out := make([]string, 0, len(set))
	for n := range set {
		out = append(out, n)
	}
	sort.Slice(out, func(i, j int) bool { return compareStrings(out[i], out[j]) < 0 })
	return out
}

// skillHome is one writable agent home.
type skillHome struct {
	ID  string
	Dir string
}

func skillHomes(userHome string) []skillHome {
	return []skillHome{
		{ID: "agents", Dir: filepath.Join(userHome, ".agents", "skills")},
		{ID: "claude", Dir: filepath.Join(userHome, ".claude", "skills")},
	}
}

// hashSkills fingerprints every file of the named skills inside dir.
func hashSkills(dir string, names []string) map[string]skillFiles {
	out := make(map[string]skillFiles, len(names))
	for _, name := range names {
		skillDir := filepath.Join(dir, name)
		files := skillFiles{}
		var walk func(rel string)
		walk = func(rel string) {
			entries, err := os.ReadDir(filepath.Join(skillDir, rel))
			if err != nil {
				return
			}
			for _, e := range entries {
				childRel := filepath.Join(rel, e.Name())
				if e.IsDir() {
					walk(childRel)
					continue
				}
				f, openErr := os.Open(filepath.Join(skillDir, childRel))
				if openErr != nil {
					continue
				}
				h := sha256.New()
				_, _ = io.Copy(h, f)
				_ = f.Close()
				files[childRel] = hex.EncodeToString(h.Sum(nil))
			}
		}
		walk(".")
		if _, err := os.Stat(skillDir); err == nil {
			out[name] = files
		}
	}
	return out
}

func bundleFilesMatch(bundle, disk skillFiles) bool {
	for rel, sha := range bundle {
		if disk[rel] != sha {
			return false
		}
	}
	return true
}

// resolveDesiredSkills mirrors node: "all" follows the bundle as it grows, "custom" is explicit.
func resolveDesiredSkills(selection map[string]any, available []string) map[string]bool {
	desired := make(map[string]bool)
	mode, _ := selection["mode"].(string)
	if mode == "custom" {
		// Filtered against what the bundle actually ships. A name left over from an older
		// bundle (the skill was renamed or removed) would otherwise be "desired" with no source
		// to copy from, which fails the whole reconcile instead of dropping one entry — and the
		// user has no way to see or fix that selection.
		availableSet := make(map[string]bool, len(available))
		for _, name := range available {
			availableSet[name] = true
		}
		raw, _ := selection["skills"].([]any)
		for _, item := range raw {
			if name, ok := item.(string); ok && availableSet[name] {
				desired[name] = true
			}
		}
		return desired
	}
	for _, name := range available {
		desired[name] = true
	}
	return desired
}

// diffSkills is the port of diff(): per skill, work out which selected homes are missing it,
// which have different bytes, and which hold a copy the selection no longer wants.
func diffSkills(
	bundle map[string]skillFiles,
	homes []skillHome,
	disks []map[string]skillFiles,
	names []string,
	desired map[string]bool,
	selected map[string]bool,
) []skillOp {
	ops := make([]skillOp, 0)
	for _, name := range names {
		var b skillFiles
		if desired[name] {
			b = bundle[name]
		}
		var missing, changed, unexpected []string
		for i, home := range homes {
			files, ok := disks[i][name]
			if b != nil && selected[home.ID] {
				if !ok {
					missing = append(missing, home.ID)
				} else if !bundleFilesMatch(b, files) {
					changed = append(changed, home.ID)
				}
				continue
			}
			if ok {
				unexpected = append(unexpected, home.ID)
			}
		}
		switch {
		case b == nil:
			if len(unexpected) > 0 {
				ops = append(ops, skillOp{Kind: "delete", Name: name, Targets: unexpected})
			}
		default:
			if len(missing) > 0 || len(changed) > 0 {
				targets := append(append([]string{}, missing...), changed...)
				kind := "update"
				if len(changed) == 0 && len(missing) == len(targets) {
					kind = "add"
				}
				ops = append(ops, skillOp{Kind: kind, Name: name, Targets: targets})
			}
			if len(unexpected) > 0 {
				ops = append(ops, skillOp{Kind: "delete", Name: name, Targets: unexpected})
			}
		}
	}
	return ops
}

// getSkillsStatus is the port of node's getSkillsStatus: a real three-state answer with the
// convergence plan, not a hardcoded label.
func getSkillsStatus(sourceDir, userHome string, selection map[string]any, selectedTargets []string) skillsStatus {
	available := listBundledSkills(sourceDir)
	names := managedSkillNames(available)
	homes := skillHomes(userHome)
	selected := make(map[string]bool, len(selectedTargets))
	if len(selectedTargets) == 0 {
		selectedTargets = SkillTargetIDs
	}
	for _, id := range selectedTargets {
		selected[id] = true
	}

	bundle := hashSkills(sourceDir, available)
	disks := make([]map[string]skillFiles, 0, len(homes))
	installed := make([]string, 0)
	for _, home := range homes {
		disk := hashSkills(home.Dir, names)
		disks = append(disks, disk)
		for name := range disk {
			installed = append(installed, name)
		}
	}

	ops := diffSkills(bundle, homes, disks, names, resolveDesiredSkills(selection, available), selected)

	installedSet := make(map[string]bool, len(installed))
	for _, n := range installed {
		installedSet[n] = true
	}
	installedNames := make([]string, 0, len(installedSet))
	for n := range installedSet {
		if containsString(names, n) {
			installedNames = append(installedNames, n)
		}
	}
	sort.Slice(installedNames, func(i, j int) bool { return compareStrings(installedNames[i], installedNames[j]) < 0 })

	hasAny := false
	for _, disk := range disks {
		if len(disk) > 0 {
			hasAny = true
			break
		}
	}

	state := "drift"
	switch {
	case !hasAny:
		state = "not-installed"
	case len(ops) == 0:
		state = "up-to-date"
	}

	return skillsStatus{
		State:     state,
		Ops:       ops,
		Available: available,
		Installed: installedNames,
		Targets: map[string][]string{
			"available": SkillTargetIDs,
			"selected":  selectedTargets,
		},
	}
}

func containsString(list []string, wanted string) bool {
	for _, item := range list {
		if item == wanted {
			return true
		}
	}
	return false
}

// applySkillsStatus executes a previously computed plan, mirroring node's applySkills: the
// homes written are exactly the homes each op names.
func applySkillsStatus(sourceDir, userHome string, status skillsStatus) error {
	dirs := make(map[string]string, len(SkillTargetIDs))
	for _, home := range skillHomes(userHome) {
		dirs[home.ID] = home.Dir
	}

	// Every mutation is journalled so a failure halfway through leaves the skill directories as
	// they were. Without this a copy that dies on the third target leaves two homes with a new
	// skill and the rest without, and the reported status no longer describes the disk.
	type undo struct {
		path    string
		existed bool
		backup  string
	}
	var journal []undo
	rollback := func() {
		for i := len(journal) - 1; i >= 0; i-- {
			entry := journal[i]
			if entry.existed {
				_ = os.RemoveAll(entry.path)
				if entry.backup != "" {
					_ = os.Rename(entry.backup, entry.path)
				}
				continue
			}
			_ = os.RemoveAll(entry.path)
		}
	}
	stage := func(path string) {
		entry := undo{path: path}
		if _, err := os.Stat(path); err == nil {
			entry.existed = true
			// Move the old copy aside rather than copying it: a skill directory is small but a
			// rename is atomic and cannot half-succeed.
			backup := path + ".byspace-rollback"
			_ = os.RemoveAll(backup)
			if err := os.Rename(path, backup); err == nil {
				entry.backup = backup
			}
		}
		journal = append(journal, entry)
	}

	for _, op := range status.Ops {
		if op.Kind == "delete" {
			continue
		}
		for _, target := range op.Targets {
			dir, ok := dirs[target]
			if !ok {
				continue
			}
			dest := filepath.Join(dir, op.Name)
			stage(dest)
			if err := copySkillDir(filepath.Join(sourceDir, op.Name), dest); err != nil {
				rollback()
				return fmt.Errorf("install skill %q for %s: %w", op.Name, target, err)
			}
		}
	}
	for _, op := range status.Ops {
		if op.Kind != "delete" {
			continue
		}
		for _, target := range op.Targets {
			dir, ok := dirs[target]
			if !ok {
				continue
			}
			dest := filepath.Join(dir, op.Name)
			stage(dest)
		}
	}

	// Commit: drop the staged backups only after every mutation succeeded.
	for _, entry := range journal {
		if entry.backup != "" {
			_ = os.RemoveAll(entry.backup)
		}
	}
	return nil
}

// resolveSkillsSourceDir finds the bundled `skills/` directory shipped with this daemon.
func resolveSkillsSourceDir() string {
	if env := strings.TrimSpace(os.Getenv("BYSPACE_SKILLS_DIR")); env != "" {
		return env
	}
	if wd, err := os.Getwd(); err == nil {
		candidate := filepath.Join(wd, "skills")
		if info, statErr := os.Stat(candidate); statErr == nil && info.IsDir() {
			return candidate
		}
	}
	if exe, err := os.Executable(); err == nil {
		candidate := filepath.Join(filepath.Dir(exe), "skills")
		if info, statErr := os.Stat(candidate); statErr == nil && info.IsDir() {
			return candidate
		}
	}
	return ""
}

// copySkillDir copies a bundled skill directory into an agent home, mirroring sync.ts.
func copySkillDir(srcDir, dstDir string) error {
	return filepath.WalkDir(srcDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, relErr := filepath.Rel(srcDir, path)
		if relErr != nil {
			return nil
		}
		target := filepath.Join(dstDir, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		f, openErr := os.Open(path)
		if openErr != nil {
			return nil
		}
		defer f.Close()
		data, readErr := io.ReadAll(f)
		if readErr != nil {
			return nil
		}
		return os.WriteFile(target, data, 0o644)
	})
}

// autoUpdateInstalledSkills repairs drift at startup, without destructive operations.
//
// Ported from autoUpdateInstalledSkills. The daemon ships the skills, so after an update every
// installed copy is stale until someone re-saves the selection — and the user has no reason to
// do that. Repairing on boot makes the shipped version the installed version.
//
// Removal is deliberately excluded: a managed directory can contain files the user put there,
// so deleting is an interactive operation that requires them to confirm a plan. Repairing is not.
func (s *Server) autoUpdateInstalledSkills() {
	sourceDir := resolveSkillsSourceDir()
	if sourceDir == "" {
		return
	}
	userHome, err := os.UserHomeDir()
	if err != nil {
		return
	}

	cfg := s.store.LoadDaemonConfig()
	selection := map[string]any{}
	targets := []string{"agents", "claude"}
	if cfg != nil {
		if stored, ok := cfg["skillsSelection"].(map[string]any); ok {
			selection = stored
		}
		if stored, ok := cfg["skillTargets"].([]any); ok && len(stored) > 0 {
			targets = make([]string, 0, len(stored))
			for _, item := range stored {
				if name, isString := item.(string); isString {
					targets = append(targets, name)
				}
			}
		}
	}

	status := getSkillsStatus(sourceDir, userHome, selection, targets)
	if status.State != "drift" {
		return
	}

	// Keep only the non-destructive operations.
	repair := status
	repair.Ops = make([]skillOp, 0, len(status.Ops))
	for _, op := range status.Ops {
		if op.Kind != "delete" {
			repair.Ops = append(repair.Ops, op)
		}
	}
	if len(repair.Ops) == 0 {
		// Drift that is only about removals: leave it for the interactive path rather than
		// reporting success for work that was not done.
		return
	}

	if err := applySkillsStatus(sourceDir, userHome, repair); err != nil {
		fmt.Fprintf(os.Stderr, "skills auto-update failed: %v\n", err)
		return
	}
	fmt.Fprintf(os.Stderr, "skills auto-updated (%d operation(s))\n", len(repair.Ops))
}

// unconfirmedRemovals lists the managed skills a save would delete without the user having agreed to it.
//
// Ported from the controller's confirmation loop. Narrowing the install targets drops the copies in the homes that
// were removed, and those directories can hold files the user put there — so the daemon names what it would destroy
// and waits. Answering with `confirmedRemovals` is the caller saying yes to exactly this list.
//
// Returns the names in a stable order: the client shows them in the question, and a shifting order across two saves
// reads as a different question.
func unconfirmedRemovals(ops []skillOp, confirmed []string) []string {
	if len(ops) == 0 {
		return nil
	}
	agreed := make(map[string]bool, len(confirmed))
	for _, name := range confirmed {
		agreed[name] = true
	}
	removals := make([]string, 0, len(ops))
	for _, op := range ops {
		if op.Kind != "delete" {
			continue
		}
		if agreed[op.Name] {
			continue
		}
		removals = append(removals, op.Name)
	}
	sort.Strings(removals)
	return removals
}

// savedSkillsState is the selection and targets the daemon has committed.
//
// Split out because a save that fails must not change it: the persisted record is what the next status read reports, so
// writing it before the copy succeeds leaves the daemon claiming a selection it never installed. The client shows exactly
// that recording back, which turns a failed save into "the selection changed and nothing happened".
func savedSkillsState(config map[string]any) (map[string]any, []string) {
	selection := map[string]any{"mode": "all"}
	if config != nil {
		if raw, ok := config["skillsSelection"].(map[string]any); ok && len(raw) > 0 {
			selection = raw
		}
	}
	return selection, readSkillTargets(config)
}

// readSkillTargets reads the saved install targets, defaulting to every target the daemon can write.
func readSkillTargets(config map[string]any) []string {
	if config != nil {
		if raw, ok := config["skillTargets"].([]any); ok && len(raw) > 0 {
			out := make([]string, 0, len(raw))
			for _, entry := range raw {
				if text, ok := entry.(string); ok && text != "" {
					out = append(out, text)
				}
			}
			if len(out) > 0 {
				return out
			}
		}
	}
	return append([]string(nil), SkillTargetIDs...)
}
