package server

import (
	"os"
	"path/filepath"
	"testing"
)

func writeSkill(t *testing.T, root, name, file, content string) {
	t.Helper()
	dir := filepath.Join(root, name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, file), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// The state must be computed from disk, not hardcoded. Node's getSkillsStatus returns
// "not-installed" when no home holds any managed skill, "up-to-date" when the ops list is
// empty, and "drift" otherwise.
func TestGetSkillsStatusThreeStates(t *testing.T) {
	tmp := t.TempDir()
	source := filepath.Join(tmp, "skills")
	userHome := filepath.Join(tmp, "home")
	writeSkill(t, source, "alpha", "SKILL.md", "alpha body")

	// 1. Nothing installed anywhere.
	status := getSkillsStatus(source, userHome, map[string]any{"mode": "all"}, nil)
	if status.State != "not-installed" {
		t.Fatalf("expected not-installed, got %q (ops=%+v)", status.State, status.Ops)
	}
	if len(status.Ops) == 0 {
		t.Fatal("expected an add op for the missing skill")
	}

	// 2. Converge, then it must be up-to-date.
	applySkillsStatus(source, userHome, status)
	status = getSkillsStatus(source, userHome, map[string]any{"mode": "all"}, nil)
	if status.State != "up-to-date" {
		t.Fatalf("expected up-to-date after apply, got %q (ops=%+v)", status.State, status.Ops)
	}
	if len(status.Ops) != 0 {
		t.Fatalf("expected no ops when converged, got %+v", status.Ops)
	}

	// 3. Change the bundle bytes -> drift with an update op targeting the affected homes.
	writeSkill(t, source, "alpha", "SKILL.md", "alpha body v2")
	status = getSkillsStatus(source, userHome, map[string]any{"mode": "all"}, nil)
	if status.State != "drift" {
		t.Fatalf("expected drift after bundle change, got %q (ops=%+v)", status.State, status.Ops)
	}
	if len(status.Ops) != 1 || status.Ops[0].Kind != "update" {
		t.Fatalf("expected one update op, got %+v", status.Ops)
	}

	// 4. Narrowing targets must delete the copy in the home that is no longer selected.
	status = getSkillsStatus(source, userHome, map[string]any{"mode": "all"}, []string{"agents"})
	foundDelete := false
	for _, op := range status.Ops {
		if op.Kind == "delete" && len(op.Targets) == 1 && op.Targets[0] == "claude" {
			foundDelete = true
		}
	}
	if !foundDelete {
		t.Fatalf("expected a delete op for the deselected claude home, got %+v", status.Ops)
	}
}
