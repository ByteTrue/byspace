package server

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSkillsInstallAndUninstallRemovesAllManagedSkillDirs(t *testing.T) {
	sourceDir := resolveSkillsSourceDir()
	if sourceDir == "" {
		t.Fatal("expected non-empty bundled skills sourceDir")
	}
	userHome := t.TempDir()
	sel := map[string]any{"mode": "all"}
	targets := []string{"agents", "claude"}

	// 1. Initially not-installed.
	st0 := getSkillsStatus(sourceDir, userHome, sel, targets)
	if st0.State != "not-installed" || len(st0.Installed) != 0 {
		t.Fatalf("expected initial state not-installed, got %+v", st0)
	}

	// 2. Reconcile installs bundled skills into both ~/.agents/skills and ~/.claude/skills.
	if err := applySkillsStatus(sourceDir, userHome, st0); err != nil {
		t.Fatalf("applySkillsStatus install: %v", err)
	}
	st1 := getSkillsStatus(sourceDir, userHome, sel, targets)
	if st1.State != "up-to-date" || len(st1.Installed) == 0 {
		t.Fatalf("expected up-to-date after install, got %+v", st1)
	}
	for _, dir := range []string{
		filepath.Join(userHome, ".agents", "skills", "byspace"),
		filepath.Join(userHome, ".claude", "skills", "byspace"),
	} {
		if _, err := os.Stat(dir); err != nil {
			t.Fatalf("expected %s to exist after install: %v", dir, err)
		}
	}

	// 3. Uninstall removes all managed skill directories and transitions back to not-installed.
	st2, err := uninstallSkills(sourceDir, userHome, sel, targets)
	if err != nil {
		t.Fatalf("uninstallSkills: %v", err)
	}
	if st2.State != "not-installed" || len(st2.Installed) != 0 {
		t.Fatalf("expected not-installed and 0 installed skills after uninstall, got %+v", st2)
	}
	for _, dir := range []string{
		filepath.Join(userHome, ".agents", "skills", "byspace"),
		filepath.Join(userHome, ".claude", "skills", "byspace"),
	} {
		if _, err := os.Stat(dir); !os.IsNotExist(err) {
			t.Fatalf("expected %s to be removed after uninstall, stat err=%v", dir, err)
		}
	}
}
