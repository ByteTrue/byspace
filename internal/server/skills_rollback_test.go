package server

import (
	"os"
	"path/filepath"
	"testing"
)

// A copy that fails partway must leave the skill directories exactly as they were. Without a
// rollback the first target keeps the new skill and the rest do not, and the reported status no
// longer describes the disk.
func TestApplySkillsStatusRollsBackOnFailure(t *testing.T) {
	tmp := t.TempDir()
	source := filepath.Join(tmp, "source")
	userHome := filepath.Join(tmp, "home")

	// Two targets; the second destination is made unwritable by putting a file where the
	// directory must go.
	first := filepath.Join(userHome, ".agents", "skills")
	second := filepath.Join(userHome, ".claude", "skills")
	for _, dir := range []string{first, second} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(filepath.Join(source, "demo"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "demo", "SKILL.md"), []byte("v1"), 0o644); err != nil {
		t.Fatal(err)
	}
	// The first target already has an older version, which must survive a failed run intact.
	if err := os.MkdirAll(filepath.Join(first, "demo"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(first, "demo", "SKILL.md"), []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Block the second target's parent: a plain file where `.claude` must be a directory, so
	// creating `.claude/skills/demo` fails inside the second target only.
	if err := os.RemoveAll(filepath.Dir(second)); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Dir(second), []byte("blocker"), 0o644); err != nil {
		t.Fatal(err)
	}

	status := skillsStatus{
		Ops: []skillOp{
			{Kind: "install", Name: "demo", Targets: []string{"agents", "claude"}},
		},
	}

	if err := applySkillsStatus(source, userHome, status); err == nil {
		t.Fatal("expected the install to fail on the blocked target")
	}

	// The first target must still hold the old content, not the new one.
	body, err := os.ReadFile(filepath.Join(first, "demo", "SKILL.md"))
	if err != nil {
		t.Fatalf("first target lost its skill: %v", err)
	}
	if string(body) != "old" {
		t.Fatalf("rollback did not restore the previous content: %q", string(body))
	}
	// And no rollback backups may be left behind.
	entries, _ := os.ReadDir(first)
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) == ".byspace-rollback" {
			t.Fatalf("leftover backup: %s", entry.Name())
		}
	}
}

// A name left over from an older bundle (the skill was renamed or removed) must be dropped from
// the desired set. Keeping it means a "desired" skill with no source to copy from, which fails
// the whole reconcile instead of dropping one entry — and the user cannot see or fix that
// selection from the UI.
func TestResolveDesiredSkillsDropsStaleNames(t *testing.T) {
	selection := map[string]any{
		"mode":   "custom",
		"skills": []any{"present", "removed-in-a-later-bundle"},
	}
	desired := resolveDesiredSkills(selection, []string{"present", "other"})
	if !desired["present"] {
		t.Fatal("a shipped skill must stay desired")
	}
	if desired["removed-in-a-later-bundle"] {
		t.Fatal("a stale name must be dropped")
	}
	if desired["other"] {
		t.Fatal("custom mode must not add skills the user did not select")
	}

	// "all" mode still takes every available skill.
	all := resolveDesiredSkills(map[string]any{"mode": "all"}, []string{"a", "b"})
	if !all["a"] || !all["b"] || len(all) != 2 {
		t.Fatalf("all mode: %v", all)
	}
}
