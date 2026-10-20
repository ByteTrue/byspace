package server

import (
	"crypto/sha256"
	"encoding/hex"
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
		raw, _ := selection["skills"].([]any)
		for _, item := range raw {
			if name, ok := item.(string); ok {
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
func applySkillsStatus(sourceDir, userHome string, status skillsStatus) {
	dirs := make(map[string]string, len(SkillTargetIDs))
	for _, home := range skillHomes(userHome) {
		dirs[home.ID] = home.Dir
	}
	for _, op := range status.Ops {
		if op.Kind == "delete" {
			continue
		}
		for _, target := range op.Targets {
			if dir, ok := dirs[target]; ok {
				_ = copySkillDir(filepath.Join(sourceDir, op.Name), filepath.Join(dir, op.Name))
			}
		}
	}
	for _, op := range status.Ops {
		if op.Kind != "delete" {
			continue
		}
		for _, target := range op.Targets {
			if dir, ok := dirs[target]; ok {
				_ = os.RemoveAll(filepath.Join(dir, op.Name))
			}
		}
	}
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
