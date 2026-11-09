package server

import (
	"os"
	"path/filepath"
	"testing"
)

// sandboxUserHome redirects os.UserHomeDir() at a temp dir.
//
// The skills code writes under the user's home, and running the suite must not install into the
// machine it runs on. Both variables matter: Go reads HOME on unix and USERPROFILE on Windows.
func sandboxUserHome(t *testing.T) string {
	t.Helper()
	userHome := t.TempDir()
	t.Setenv("HOME", userHome)
	t.Setenv("USERPROFILE", userHome)
	return userHome
}

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

// A home that never chose a selection gets the reference skill, and nothing else.
//
// The reference skill is where an agent learns that `byspace` exists; without it a fresh host has
// no orchestration surface at all. The workflow skills stay opt-in, so a first boot must not drag
// the whole bundle in.
func TestBootRepairInstallsOnlyTheReferenceSkillWithoutAStoredSelection(t *testing.T) {
	userHome := sandboxUserHome(t)

	srv, err := New(Options{HomeDir: filepath.Join(t.TempDir(), "home"), Version: "0.0.0-test"})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	for _, home := range []string{".agents", ".claude"} {
		installed := filepath.Join(userHome, home, "skills", "byspace", "SKILL.md")
		if _, err := os.Stat(installed); err != nil {
			t.Fatalf("startup did not install the reference skill at %s: %v", installed, err)
		}
		optional := filepath.Join(userHome, home, "skills", "byspace-advisor")
		if _, err := os.Stat(optional); !os.IsNotExist(err) {
			t.Fatalf("startup installed the optional skill %s without a selection", optional)
		}
	}
}
