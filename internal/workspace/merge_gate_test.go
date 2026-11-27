package workspace

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

type mergeGateFixture struct {
	root   string
	target string
	source string
}

func newMergeGateFixture(t *testing.T) mergeGateFixture {
	t.Helper()
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	root := t.TempDir()
	target := filepath.Join(root, "target")
	if err := os.Mkdir(target, 0o755); err != nil {
		t.Fatal(err)
	}
	mergeGateGit(t, target, "init", "-b", "main")
	mergeGateGit(t, target, "config", "user.name", "Merge Gate Test")
	mergeGateGit(t, target, "config", "user.email", "merge-gate@example.com")
	mergeGateWrite(t, target, "shared.txt", "base\n")
	mergeGateGit(t, target, "add", "shared.txt")
	mergeGateGit(t, target, "commit", "-m", "base")
	mergeGateGit(t, target, "branch", "feature")
	source := filepath.Join(root, "source")
	mergeGateGit(t, target, "worktree", "add", source, "feature")
	return mergeGateFixture{root: root, target: target, source: source}
}

func (f mergeGateFixture) options() DryRunOptions {
	return DryRunOptions{
		TargetCwd: f.target,
		TargetRef: "main",
		SourceCwd: f.source,
		SourceRef: "feature",
	}
}

func (f mergeGateFixture) commit(t *testing.T, cwd, name, content, message string) string {
	t.Helper()
	mergeGateWrite(t, cwd, name, content)
	mergeGateGit(t, cwd, "add", name)
	mergeGateGit(t, cwd, "commit", "-m", message)
	return mergeGateHead(t, cwd)
}

func mergeGateGit(t *testing.T, cwd string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = cwd
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=Merge Gate Test",
		"GIT_AUTHOR_EMAIL=merge-gate@example.com",
		"GIT_COMMITTER_NAME=Merge Gate Test",
		"GIT_COMMITTER_EMAIL=merge-gate@example.com",
		"GIT_CONFIG_NOSYSTEM=1",
		"GIT_CONFIG_GLOBAL="+os.DevNull,
		"LC_ALL=C",
	)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, output)
	}
	return strings.TrimSpace(string(output))
}

func mergeGateWrite(t *testing.T, cwd, name, content string) {
	t.Helper()
	path := filepath.Join(cwd, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func mergeGateHead(t *testing.T, cwd string) string {
	t.Helper()
	return mergeGateGit(t, cwd, "rev-parse", "HEAD")
}

func mergeGateStatus(t *testing.T, cwd string) string {
	t.Helper()
	return mergeGateGit(t, cwd, "status", "--porcelain=v1", "--untracked-files=all")
}

func TestDryRunMergeCleanReportsMergeWithoutMutatingRepository(t *testing.T) {
	f := newMergeGateFixture(t)
	f.commit(t, f.source, "shared.txt", "source\n", "source one")
	sourceSha := f.commit(t, f.source, "second.txt", "second\n", "source two")
	targetSha := mergeGateHead(t, f.target)
	before := time.Now()

	result, err := DryRunMerge(context.Background(), f.options())
	if err != nil {
		t.Fatalf("DryRunMerge: %v", err)
	}

	if !result.Clean || result.DirtyWorktree {
		t.Fatalf("expected clean checkout and merge, got %+v", result)
	}
	if result.TargetRef != "main" || result.SourceRef != "feature" {
		t.Errorf("refs not preserved: %+v", result)
	}
	if result.TargetSha != targetSha || result.SourceSha != sourceSha {
		t.Errorf("SHAs = target %q source %q, want %q and %q", result.TargetSha, result.SourceSha, targetSha, sourceSha)
	}
	if result.AheadCount != 2 {
		t.Errorf("AheadCount = %d, want 2", result.AheadCount)
	}
	if result.MergeTreeSha == "" {
		t.Fatal("MergeTreeSha is empty")
	}
	if got := mergeGateGit(t, f.target, "show", result.MergeTreeSha+":shared.txt"); got != "source" {
		t.Errorf("merged tree shared.txt = %q, want source", got)
	}
	if len(result.ConflictingFiles) != 0 {
		t.Errorf("ConflictingFiles = %v, want none", result.ConflictingFiles)
	}
	if result.CheckedAt.Before(before) || time.Since(result.CheckedAt) > time.Minute {
		t.Errorf("CheckedAt = %v, not a fresh timestamp", result.CheckedAt)
	}
	if got := mergeGateHead(t, f.target); got != targetSha {
		t.Errorf("target moved to %s", got)
	}
	if got := mergeGateHead(t, f.source); got != sourceSha {
		t.Errorf("source moved to %s", got)
	}
	if got := mergeGateStatus(t, f.target); got != "" {
		t.Errorf("target status after dry run = %q", got)
	}
	if got := mergeGateStatus(t, f.source); got != "" {
		t.Errorf("source status after dry run = %q", got)
	}
}

func TestDryRunMergeConflictReportsStructuredPathsWithoutMutation(t *testing.T) {
	f := newMergeGateFixture(t)
	targetSha := f.commit(t, f.target, "shared.txt", "target\n", "target change")
	sourceSha := f.commit(t, f.source, "shared.txt", "source\n", "source change")

	result, err := DryRunMerge(context.Background(), f.options())
	if err != nil {
		t.Fatalf("DryRunMerge: %v", err)
	}
	if result.Clean {
		t.Fatalf("conflicted merge reported clean: %+v", result)
	}
	if result.DirtyWorktree {
		t.Errorf("conflict must not be reported as a dirty checkout: %+v", result)
	}
	if !reflect.DeepEqual(result.ConflictingFiles, []string{"shared.txt"}) {
		t.Errorf("ConflictingFiles = %v, want [shared.txt]", result.ConflictingFiles)
	}
	if result.MergeTreeSha == "" {
		t.Error("conflicted merge-tree did not report its tree SHA")
	}
	if mergeGateHead(t, f.target) != targetSha || mergeGateHead(t, f.source) != sourceSha {
		t.Error("dry run moved a branch")
	}
	if mergeGateStatus(t, f.target) != "" || mergeGateStatus(t, f.source) != "" {
		t.Error("dry run dirtied a checkout")
	}
}

func TestDryRunMergeReportsEitherDirtyCheckout(t *testing.T) {
	for _, tc := range []struct {
		name string
		cwd  func(mergeGateFixture) string
	}{
		{name: "target", cwd: func(f mergeGateFixture) string { return f.target }},
		{name: "source", cwd: func(f mergeGateFixture) string { return f.source }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newMergeGateFixture(t)
			f.commit(t, f.source, "source.txt", "source\n", "source change")
			mergeGateWrite(t, tc.cwd(f), "untracked.txt", "dirty\n")

			result, err := DryRunMerge(context.Background(), f.options())
			if err != nil {
				t.Fatalf("DryRunMerge: %v", err)
			}
			if !result.DirtyWorktree || result.Clean {
				t.Fatalf("dirty checkout must not be landable: %+v", result)
			}
		})
	}
}

func TestDryRunMergeRejectsWrongBranchAndCrossRepository(t *testing.T) {
	t.Run("target branch", func(t *testing.T) {
		f := newMergeGateFixture(t)
		opts := f.options()
		opts.TargetRef = "feature"
		if _, err := DryRunMerge(context.Background(), opts); err == nil {
			t.Fatal("expected attached target branch mismatch to fail")
		}
	})

	t.Run("source branch", func(t *testing.T) {
		f := newMergeGateFixture(t)
		opts := f.options()
		opts.SourceRef = "main"
		if _, err := DryRunMerge(context.Background(), opts); err == nil {
			t.Fatal("expected attached source branch mismatch to fail")
		}
	})

	t.Run("cross repository", func(t *testing.T) {
		f := newMergeGateFixture(t)
		other := filepath.Join(f.root, "other")
		if err := os.Mkdir(other, 0o755); err != nil {
			t.Fatal(err)
		}
		mergeGateGit(t, other, "init", "-b", "main")
		mergeGateWrite(t, other, "other.txt", "other\n")
		mergeGateGit(t, other, "add", "other.txt")
		mergeGateGit(t, other, "commit", "-m", "other")
		opts := f.options()
		opts.SourceCwd = other
		opts.SourceRef = "main"
		if _, err := DryRunMerge(context.Background(), opts); err == nil {
			t.Fatal("expected cross-repository dry run to fail")
		}
	})
}

func TestDryRunMergeLegacyGitFallback(t *testing.T) {
	for _, tc := range []struct {
		name     string
		conflict bool
	}{
		{name: "clean"},
		{name: "conflict", conflict: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newMergeGateFixture(t)
			if tc.conflict {
				f.commit(t, f.target, "shared.txt", "target\n", "target change")
			}
			f.commit(t, f.source, "shared.txt", "source\n", "source change")
			targetSha := mergeGateHead(t, f.target)
			sourceSha := mergeGateHead(t, f.source)
			beforeWorktrees := mergeGateGit(t, f.target, "worktree", "list", "--porcelain")
			temporaryRoot := filepath.Join(f.root, "tmp")
			if err := os.Mkdir(temporaryRoot, 0o755); err != nil {
				t.Fatal(err)
			}
			t.Setenv("TMP", temporaryRoot)
			t.Setenv("TEMP", temporaryRoot)
			mergeGateForceLegacyGit(t)

			result, err := DryRunMerge(context.Background(), f.options())
			if err != nil {
				t.Fatalf("DryRunMerge with legacy Git: %v", err)
			}
			if result.Clean == tc.conflict {
				t.Errorf("Clean = %v for conflict=%v", result.Clean, tc.conflict)
			}
			if tc.conflict && !reflect.DeepEqual(result.ConflictingFiles, []string{"shared.txt"}) {
				t.Errorf("ConflictingFiles = %v, want [shared.txt]", result.ConflictingFiles)
			}
			if !tc.conflict && result.MergeTreeSha == "" {
				t.Error("clean fallback returned no tree SHA")
			}
			if mergeGateHead(t, f.target) != targetSha || mergeGateHead(t, f.source) != sourceSha {
				t.Error("fallback moved a branch")
			}
			if mergeGateStatus(t, f.target) != "" || mergeGateStatus(t, f.source) != "" {
				t.Error("fallback dirtied a checkout")
			}
			if after := mergeGateGit(t, f.target, "worktree", "list", "--porcelain"); after != beforeWorktrees {
				t.Errorf("worktrees leaked:\nbefore:\n%s\nafter:\n%s", beforeWorktrees, after)
			}
			entries, err := os.ReadDir(temporaryRoot)
			if err != nil {
				t.Fatal(err)
			}
			if len(entries) != 0 {
				names := make([]string, 0, len(entries))
				for _, entry := range entries {
					names = append(names, entry.Name())
				}
				t.Errorf("temporary fallback paths leaked: %v", names)
			}
		})
	}
}

func mergeGateForceLegacyGit(t *testing.T) {
	t.Helper()
	realGit, err := exec.LookPath("git")
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("MERGE_GATE_REAL_GIT", realGit)
	bin := t.TempDir()
	var path string
	if os.PathSeparator == '\\' {
		path = filepath.Join(bin, "git.cmd")
		script := "@echo off\r\nif /I \"%~1\"==\"merge-tree\" exit /b 129\r\n\"%MERGE_GATE_REAL_GIT%\" %*\r\nexit /b %ERRORLEVEL%\r\n"
		if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
			t.Fatal(err)
		}
	} else {
		path = filepath.Join(bin, "git")
		script := "#!/bin/sh\nif [ \"$1\" = \"merge-tree\" ]; then exit 129; fi\nexec \"$MERGE_GATE_REAL_GIT\" \"$@\"\n"
		if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
}

func (f mergeGateFixture) landOptions(strategy string) LandOptions {
	return LandOptions{
		TargetCwd:     f.target,
		TargetBranch:  "main",
		SourceCwd:     f.source,
		SourceBranch:  "feature",
		Strategy:      strategy,
		CommitMessage: "land source",
	}
}

func TestLandBranchStrategies(t *testing.T) {
	t.Run("merge creates a two-parent commit", func(t *testing.T) {
		f := newMergeGateFixture(t)
		sourceSha := f.commit(t, f.source, "source.txt", "source\n", "source change")
		targetSha := mergeGateHead(t, f.target)

		result, err := LandBranch(context.Background(), f.landOptions("merge"))
		if err != nil {
			t.Fatalf("LandBranch: %v", err)
		}
		if result.SourceSha != sourceSha || mergeGateHead(t, f.source) != sourceSha {
			t.Errorf("merge changed source: result %+v", result)
		}
		if result.TargetSha == targetSha || mergeGateHead(t, f.target) != result.TargetSha {
			t.Errorf("target did not advance to returned SHA: %+v", result)
		}
		parents := strings.Fields(mergeGateGit(t, f.target, "rev-list", "--parents", "-n", "1", "HEAD"))
		if len(parents) != 3 || parents[1] != targetSha || parents[2] != sourceSha {
			t.Errorf("merge parents = %v, want target %s and source %s", parents, targetSha, sourceSha)
		}
		mergeGateAssertClean(t, f)
	})

	t.Run("squash creates one parent with requested message", func(t *testing.T) {
		f := newMergeGateFixture(t)
		sourceSha := f.commit(t, f.source, "source.txt", "source\n", "source change")
		targetSha := mergeGateHead(t, f.target)
		opts := f.landOptions("squash")
		opts.CommitMessage = "requested squash message"

		result, err := LandBranch(context.Background(), opts)
		if err != nil {
			t.Fatalf("LandBranch: %v", err)
		}
		if result.SourceSha != sourceSha || mergeGateHead(t, f.source) != sourceSha {
			t.Errorf("squash changed source: result %+v", result)
		}
		if result.TargetSha == targetSha || mergeGateHead(t, f.target) != result.TargetSha {
			t.Errorf("target did not advance to returned SHA: %+v", result)
		}
		parents := strings.Fields(mergeGateGit(t, f.target, "rev-list", "--parents", "-n", "1", "HEAD"))
		if len(parents) != 2 || parents[1] != targetSha {
			t.Errorf("squash parents = %v, want only target %s", parents, targetSha)
		}
		if message := mergeGateGit(t, f.target, "log", "-1", "--format=%B"); message != opts.CommitMessage {
			t.Errorf("squash message = %q, want %q", message, opts.CommitMessage)
		}
		mergeGateAssertClean(t, f)
	})

	t.Run("rebase rewrites source then fast-forwards target", func(t *testing.T) {
		f := newMergeGateFixture(t)
		targetSha := f.commit(t, f.target, "target.txt", "target\n", "target change")
		oldSourceSha := f.commit(t, f.source, "source.txt", "source\n", "source change")

		result, err := LandBranch(context.Background(), f.landOptions("rebase"))
		if err != nil {
			t.Fatalf("LandBranch: %v", err)
		}
		if result.SourceSha == oldSourceSha {
			t.Error("rebase did not rewrite source")
		}
		if result.TargetSha != result.SourceSha {
			t.Errorf("target SHA %s != rebased source SHA %s", result.TargetSha, result.SourceSha)
		}
		if mergeGateHead(t, f.target) != result.TargetSha || mergeGateHead(t, f.source) != result.SourceSha {
			t.Errorf("landed heads do not match result: %+v", result)
		}
		mergeGateGit(t, f.target, "merge-base", "--is-ancestor", targetSha, result.SourceSha)
		mergeGateAssertClean(t, f)
	})
}

func TestLandBranchRejectsRefMovementAfterDryRun(t *testing.T) {
	for _, movedRef := range []string{"source", "target"} {
		t.Run(movedRef, func(t *testing.T) {
			f := newMergeGateFixture(t)
			sourceSha := f.commit(t, f.source, "reviewed.txt", "reviewed\n", "reviewed source change")
			targetSha := mergeGateHead(t, f.target)
			started, release := mergeGatePauseMergeTree(t)
			defer os.WriteFile(release, []byte("release"), 0o644)

			var result LandResult
			done := make(chan error, 1)
			go func() {
				var err error
				result, err = LandBranch(context.Background(), f.landOptions("merge"))
				done <- err
			}()
			mergeGateWaitForFile(t, started)

			wantTargetSha, wantSourceSha := targetSha, sourceSha
			forbiddenTargetPath := "reviewed.txt"
			if movedRef == "source" {
				wantSourceSha = f.commit(t, f.source, "unreviewed.txt", "unreviewed\n", "unreviewed source change")
				forbiddenTargetPath = "unreviewed.txt"
			} else {
				wantTargetSha = f.commit(t, f.target, "external-target.txt", "external\n", "external target change")
			}
			if err := os.WriteFile(release, []byte("release"), 0o644); err != nil {
				t.Fatal(err)
			}

			select {
			case err := <-done:
				if err == nil {
					t.Errorf("LandBranch succeeded after %s moved: %+v", movedRef, result)
				} else if !strings.Contains(err.Error(), movedRef+" branch moved during landing") {
					t.Errorf("LandBranch error = %v, want %s movement rejection", err, movedRef)
				}
			case <-time.After(10 * time.Second):
				t.Fatal("LandBranch did not finish after merge-tree release")
			}
			if result != (LandResult{TargetSha: targetSha, SourceSha: sourceSha}) {
				t.Errorf("result = %+v, want dry-run SHAs target %s source %s", result, targetSha, sourceSha)
			}
			if got := mergeGateHead(t, f.target); got != wantTargetSha {
				t.Errorf("target HEAD = %s, want %s", got, wantTargetSha)
			}
			if got := mergeGateHead(t, f.source); got != wantSourceSha {
				t.Errorf("source HEAD = %s, want %s", got, wantSourceSha)
			}
			if _, err := os.Stat(filepath.Join(f.target, forbiddenTargetPath)); !os.IsNotExist(err) {
				t.Errorf("unreviewed content %s landed in target (stat error %v)", forbiddenTargetPath, err)
			}
			mergeGateAssertClean(t, f)
			mergeGateAssertNoState(t, f.target, "MERGE_HEAD")
		})
	}
}

func TestLandBranchMutationUsesVerifiedRevisionsAndCAS(t *testing.T) {
	for _, tc := range []struct {
		name       string
		strategy   string
		movedRef   string
		command    string
		ref        string
		altCommand string
		altRef     string
	}{
		{name: "merge source moves during merge", strategy: "merge", movedRef: "source", command: "merge"},
		{name: "merge target moves before CAS", strategy: "merge", movedRef: "target", command: "merge"},
		{name: "squash source moves during merge", strategy: "squash", movedRef: "source", command: "merge"},
		{name: "squash target moves before CAS", strategy: "squash", movedRef: "target", command: "merge"},
		{name: "rebase source moves during rebase", strategy: "rebase", movedRef: "source", command: "update-ref", ref: "refs/heads/feature", altCommand: "rebase"},
		{name: "rebase target moves before CAS", strategy: "rebase", movedRef: "target", command: "update-ref", ref: "refs/heads/main", altCommand: "merge", altRef: "--ff-only"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newMergeGateFixture(t)
			reviewedSourceSha := f.commit(t, f.source, "reviewed.txt", "reviewed\n", "reviewed source change")
			if tc.strategy == "rebase" {
				f.commit(t, f.target, "target-base.txt", "target\n", "target base change")
			}
			reviewedTargetSha := mergeGateHead(t, f.target)
			started, release := mergeGatePauseMutation(t, tc.command, tc.ref, tc.altCommand, tc.altRef)
			defer os.WriteFile(release, []byte("release"), 0o644)

			var result LandResult
			done := make(chan error, 1)
			go func() {
				var err error
				result, err = LandBranch(context.Background(), f.landOptions(tc.strategy))
				done <- err
			}()
			mergeGateWaitForFile(t, started)

			wantTargetSha, wantSourceSha := reviewedTargetSha, reviewedSourceSha
			if tc.movedRef == "source" {
				wantSourceSha = f.commit(t, f.source, "unreviewed.txt", "unreviewed\n", "unreviewed source change")
			} else {
				wantTargetSha = f.commit(t, f.target, "external-target.txt", "external\n", "external target change")
			}
			if err := os.WriteFile(release, []byte("release"), 0o644); err != nil {
				t.Fatal(err)
			}

			var landErr error
			select {
			case landErr = <-done:
			case <-time.After(10 * time.Second):
				t.Fatal("LandBranch did not finish after mutation release")
			}
			immutableSourceSuccess := tc.movedRef == "source" && tc.strategy != "rebase"
			if immutableSourceSuccess {
				if landErr != nil {
					t.Fatalf("LandBranch with immutable reviewed source: %v", landErr)
				}
				if result.SourceSha != reviewedSourceSha {
					t.Errorf("result source SHA = %s, want reviewed %s", result.SourceSha, reviewedSourceSha)
				}
				if result.TargetSha == reviewedTargetSha || mergeGateHead(t, f.target) != result.TargetSha {
					t.Errorf("target did not advance to returned reviewed merge: %+v", result)
				}
			} else {
				if landErr == nil {
					t.Errorf("LandBranch succeeded after %s moved before CAS: %+v", tc.movedRef, result)
				}
				if result != (LandResult{TargetSha: reviewedTargetSha, SourceSha: reviewedSourceSha}) {
					t.Errorf("failed landing result = %+v, want reviewed pre-landing SHAs", result)
				}
				if got := mergeGateHead(t, f.target); got != wantTargetSha {
					t.Errorf("target HEAD = %s, want externally preserved %s", got, wantTargetSha)
				}
			}
			if got := mergeGateHead(t, f.source); got != wantSourceSha {
				t.Errorf("source HEAD = %s, want externally preserved %s", got, wantSourceSha)
			}
			if immutableSourceSuccess {
				content, err := os.ReadFile(filepath.Join(f.target, "reviewed.txt"))
				if err != nil || string(content) != "reviewed\n" {
					t.Errorf("reviewed target content = %q, %v", content, err)
				}
			}
			if _, err := os.Stat(filepath.Join(f.target, "unreviewed.txt")); !os.IsNotExist(err) {
				t.Errorf("unreviewed source content landed (stat error %v)", err)
			}
			if tc.movedRef == "target" {
				content, err := os.ReadFile(filepath.Join(f.target, "external-target.txt"))
				if err != nil || string(content) != "external\n" {
					t.Errorf("external target content = %q, %v", content, err)
				}
			}
			mergeGateAssertClean(t, f)
			mergeGateAssertNoState(t, f.target, "MERGE_HEAD")
			mergeGateAssertNoState(t, f.source, "REBASE_HEAD", "rebase-merge", "rebase-apply")
		})
	}
}

func mergeGatePauseMutation(t *testing.T, command, ref, altCommand, altRef string) (started, release string) {
	t.Helper()
	realGit, err := exec.LookPath("git")
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("MERGE_GATE_REAL_GIT", realGit)
	root := t.TempDir()
	started = filepath.Join(root, "mutation-started")
	release = filepath.Join(root, "mutation-release")
	t.Setenv("MERGE_GATE_MUTATION_STARTED", started)
	t.Setenv("MERGE_GATE_MUTATION_RELEASE", release)
	t.Setenv("MERGE_GATE_PAUSE_COMMAND", command)
	t.Setenv("MERGE_GATE_PAUSE_REF", ref)
	t.Setenv("MERGE_GATE_PAUSE_ALT_COMMAND", altCommand)
	t.Setenv("MERGE_GATE_PAUSE_ALT_REF", altRef)
	bin := t.TempDir()
	if os.PathSeparator == '\\' {
		script := "@echo off\r\nset pause=\r\ncall :match \"%~1\" \"%MERGE_GATE_PAUSE_COMMAND%\" \"%MERGE_GATE_PAUSE_REF%\"\r\ncall :match \"%~1\" \"%MERGE_GATE_PAUSE_ALT_COMMAND%\" \"%MERGE_GATE_PAUSE_ALT_REF%\"\r\nif not defined pause goto run\r\necho started>\"%MERGE_GATE_MUTATION_STARTED%\"\r\n:wait_mutation_release\r\nif not exist \"%MERGE_GATE_MUTATION_RELEASE%\" goto wait_mutation_release\r\ngoto run\r\n:match\r\nif \"%~2\"==\"\" exit /b 0\r\nif /I not \"%~1\"==\"%~2\" exit /b 0\r\nif \"%~3\"==\"\" set pause=1&exit /b 0\r\necho %*| findstr /C:\"%~3\" >nul\r\nif not errorlevel 1 set pause=1\r\nexit /b 0\r\n:run\r\n\"%MERGE_GATE_REAL_GIT%\" %*\r\nexit /b %ERRORLEVEL%\r\n"
		if err := os.WriteFile(filepath.Join(bin, "git.cmd"), []byte(script), 0o755); err != nil {
			t.Fatal(err)
		}
	} else {
		script := "#!/bin/sh\nmatch() {\n[ -n \"$2\" ] || return 0\n[ \"$1\" = \"$2\" ] || return 0\nif [ -z \"$3\" ]; then pause=1; return 0; fi\ncase \"$4\" in *\"$3\"*) pause=1;; esac\n}\nmatch \"$1\" \"$MERGE_GATE_PAUSE_COMMAND\" \"$MERGE_GATE_PAUSE_REF\" \"$*\"\nmatch \"$1\" \"$MERGE_GATE_PAUSE_ALT_COMMAND\" \"$MERGE_GATE_PAUSE_ALT_REF\" \"$*\"\nif [ -n \"$pause\" ]; then\nprintf started > \"$MERGE_GATE_MUTATION_STARTED\"\nwhile [ ! -f \"$MERGE_GATE_MUTATION_RELEASE\" ]; do sleep 0.01; done\nfi\nexec \"$MERGE_GATE_REAL_GIT\" \"$@\"\n"
		if err := os.WriteFile(filepath.Join(bin, "git"), []byte(script), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	return started, release
}

func mergeGatePauseMergeTree(t *testing.T) (started, release string) {
	t.Helper()
	realGit, err := exec.LookPath("git")
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("MERGE_GATE_REAL_GIT", realGit)
	root := t.TempDir()
	started = filepath.Join(root, "merge-tree-started")
	release = filepath.Join(root, "merge-tree-release")
	t.Setenv("MERGE_GATE_MERGE_TREE_STARTED", started)
	t.Setenv("MERGE_GATE_MERGE_TREE_RELEASE", release)
	bin := t.TempDir()
	if os.PathSeparator == '\\' {
		script := "@echo off\r\nif /I \"%~1\"==\"merge-tree\" goto pause_merge_tree\r\ngoto run\r\n:pause_merge_tree\r\necho started>\"%MERGE_GATE_MERGE_TREE_STARTED%\"\r\n:wait_merge_tree_release\r\nif not exist \"%MERGE_GATE_MERGE_TREE_RELEASE%\" goto wait_merge_tree_release\r\n:run\r\n\"%MERGE_GATE_REAL_GIT%\" %*\r\nexit /b %ERRORLEVEL%\r\n"
		if err := os.WriteFile(filepath.Join(bin, "git.cmd"), []byte(script), 0o755); err != nil {
			t.Fatal(err)
		}
	} else {
		script := "#!/bin/sh\nif [ \"$1\" = \"merge-tree\" ]; then\nprintf started > \"$MERGE_GATE_MERGE_TREE_STARTED\"\nwhile [ ! -f \"$MERGE_GATE_MERGE_TREE_RELEASE\" ]; do sleep 0.01; done\nfi\nexec \"$MERGE_GATE_REAL_GIT\" \"$@\"\n"
		if err := os.WriteFile(filepath.Join(bin, "git"), []byte(script), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	return started, release
}

func TestLandBranchRejectsUncleanInputsWithoutMutation(t *testing.T) {
	t.Run("conflict", func(t *testing.T) {
		f := newMergeGateFixture(t)
		targetSha := f.commit(t, f.target, "shared.txt", "target\n", "target change")
		sourceSha := f.commit(t, f.source, "shared.txt", "source\n", "source change")
		if _, err := LandBranch(context.Background(), f.landOptions("merge")); err == nil {
			t.Fatal("expected conflicted landing to fail")
		}
		mergeGateAssertUnchanged(t, f, targetSha, sourceSha)
	})

	t.Run("dirty source is preserved", func(t *testing.T) {
		f := newMergeGateFixture(t)
		targetSha := mergeGateHead(t, f.target)
		sourceSha := f.commit(t, f.source, "source.txt", "source\n", "source change")
		mergeGateWrite(t, f.source, "untracked.txt", "keep me\n")
		if _, err := LandBranch(context.Background(), f.landOptions("squash")); err == nil {
			t.Fatal("expected dirty source landing to fail")
		}
		if mergeGateHead(t, f.target) != targetSha || mergeGateHead(t, f.source) != sourceSha {
			t.Error("rejected landing moved a branch")
		}
		content, err := os.ReadFile(filepath.Join(f.source, "untracked.txt"))
		if err != nil || string(content) != "keep me\n" {
			t.Errorf("dirty source file was not preserved: %q, %v", content, err)
		}
		if mergeGateStatus(t, f.target) != "" {
			t.Error("rejected landing dirtied target")
		}
	})
}

func TestLandBranchHookFailureCleansMergeState(t *testing.T) {
	for _, strategy := range []string{"merge", "squash"} {
		t.Run(strategy, func(t *testing.T) {
			f := newMergeGateFixture(t)
			sourceSha := f.commit(t, f.source, "source.txt", "source\n", "source change")
			targetSha := mergeGateHead(t, f.target)
			mergeGateInstallHook(t, f.target, "commit-msg", "#!/bin/sh\nexit 1\n")

			if _, err := LandBranch(context.Background(), f.landOptions(strategy)); err == nil {
				t.Fatal("expected commit-msg hook to fail landing")
			}
			mergeGateAssertUnchanged(t, f, targetSha, sourceSha)
			mergeGateAssertNoState(t, f.target, "MERGE_HEAD")
		})
	}
}

func TestLandBranchRebaseConflictRestoresSource(t *testing.T) {
	f := newMergeGateFixture(t)
	targetSha := f.commit(t, f.target, "shared.txt", "target\n", "target change")
	f.commit(t, f.source, "shared.txt", "source\n", "intermediate conflict")
	sourceSha := f.commit(t, f.source, "shared.txt", "target\n", "resolve final tree")
	dryRun, err := DryRunMerge(context.Background(), f.options())
	if err != nil || !dryRun.Clean {
		t.Fatalf("fixture needs a clean final-tree dry run: %+v, %v", dryRun, err)
	}

	if _, err := LandBranch(context.Background(), f.landOptions("rebase")); err == nil {
		t.Fatal("expected replaying the intermediate commit to conflict")
	}
	mergeGateAssertUnchanged(t, f, targetSha, sourceSha)
	mergeGateAssertNoState(t, f.source, "REBASE_HEAD", "rebase-merge", "rebase-apply")
}

func mergeGateAssertClean(t *testing.T, f mergeGateFixture) {
	t.Helper()
	if status := mergeGateStatus(t, f.target); status != "" {
		t.Errorf("target is dirty: %q", status)
	}
	if status := mergeGateStatus(t, f.source); status != "" {
		t.Errorf("source is dirty: %q", status)
	}
}

func mergeGateAssertUnchanged(t *testing.T, f mergeGateFixture, targetSha, sourceSha string) {
	t.Helper()
	if got := mergeGateHead(t, f.target); got != targetSha {
		t.Errorf("target HEAD = %s, want %s", got, targetSha)
	}
	if got := mergeGateHead(t, f.source); got != sourceSha {
		t.Errorf("source HEAD = %s, want %s", got, sourceSha)
	}
	mergeGateAssertClean(t, f)
}

func mergeGateInstallHook(t *testing.T, cwd, name, script string) {
	t.Helper()
	gitDir := mergeGateGit(t, cwd, "rev-parse", "--absolute-git-dir")
	hooksDir := filepath.Join(gitDir, "hooks")
	if err := os.MkdirAll(hooksDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(hooksDir, name), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
}

func mergeGateAssertNoState(t *testing.T, cwd string, names ...string) {
	t.Helper()
	for _, name := range names {
		path := mergeGateGit(t, cwd, "rev-parse", "--git-path", name)
		if !filepath.IsAbs(path) {
			path = filepath.Join(cwd, path)
		}
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Errorf("Git state %s remains at %s (stat error %v)", name, path, err)
		}
	}
}

func TestLandBranchCancellationCleansMergeState(t *testing.T) {
	f := newMergeGateFixture(t)
	sourceSha := f.commit(t, f.source, "source.txt", "source\n", "source change")
	targetSha := mergeGateHead(t, f.target)
	started := filepath.Join(f.root, "hook-started")
	release := filepath.Join(f.root, "hook-release")
	t.Setenv("MERGE_GATE_HOOK_STARTED", started)
	t.Setenv("MERGE_GATE_HOOK_RELEASE", release)
	mergeGateInstallHook(t, f.target, "commit-msg", "#!/bin/sh\nprintf started > \"$MERGE_GATE_HOOK_STARTED\"\nwhile [ ! -f \"$MERGE_GATE_HOOK_RELEASE\" ]; do sleep 0.05; done\n")
	defer os.WriteFile(release, []byte("release"), 0o644)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := LandBranch(ctx, f.landOptions("merge"))
		done <- err
	}()
	mergeGateWaitForFile(t, started)
	cancel()

	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Errorf("LandBranch error = %v, want context.Canceled", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("canceled landing did not finish cleanup")
	}
	mergeGateAssertUnchanged(t, f, targetSha, sourceSha)
	mergeGateAssertNoState(t, f.target, "MERGE_HEAD")
}

func TestLandBranchRestoresRebasedSourceWhenTargetUpdateFails(t *testing.T) {
	for _, externalEdit := range []bool{false, true} {
		name := "no external edits"
		if externalEdit {
			name = "external edit is preserved"
		}
		t.Run(name, func(t *testing.T) {
			f := newMergeGateFixture(t)
			targetSha := f.commit(t, f.target, "target.txt", "target\n", "target change")
			oldSourceSha := f.commit(t, f.source, "source.txt", "source\n", "source change")
			externalPath := filepath.Join(f.source, "external.txt")
			if externalEdit {
				t.Setenv("MERGE_GATE_EXTERNAL_EDIT", externalPath)
			}
			mergeGateFailTargetUpdate(t)

			_, landErr := LandBranch(context.Background(), f.landOptions("rebase"))
			if landErr == nil {
				t.Fatal("expected forced target update failure")
			}
			if !strings.Contains(landErr.Error(), "compare-and-swap target branch") {
				t.Fatalf("landing failed before the forced target update: %v", landErr)
			}
			if externalEdit && !strings.Contains(landErr.Error(), "source changed externally after rebase") {
				t.Fatalf("landing did not preserve the external edit: %v", landErr)
			}
			if got := mergeGateHead(t, f.target); got != targetSha {
				t.Errorf("target moved to %s", got)
			}
			if externalEdit {
				if got := mergeGateHead(t, f.source); got == oldSourceSha {
					t.Error("source with external edits was reset instead of preserving the rebase")
				}
				content, err := os.ReadFile(externalPath)
				if err != nil || !strings.Contains(string(content), "external") {
					t.Errorf("external edit was lost: %q, %v", content, err)
				}
			} else {
				mergeGateAssertUnchanged(t, f, targetSha, oldSourceSha)
			}
		})
	}
}

func TestMergeGateSerializesSameRepository(t *testing.T) {
	f := newMergeGateFixture(t)
	f.commit(t, f.source, "source.txt", "source\n", "source change")
	started := filepath.Join(f.root, "hook-started")
	release := filepath.Join(f.root, "hook-release")
	t.Setenv("MERGE_GATE_HOOK_STARTED", started)
	t.Setenv("MERGE_GATE_HOOK_RELEASE", release)
	mergeGateInstallHook(t, f.target, "commit-msg", "#!/bin/sh\nprintf started > \"$MERGE_GATE_HOOK_STARTED\"\nwhile [ ! -f \"$MERGE_GATE_HOOK_RELEASE\" ]; do sleep 0.05; done\n")
	defer os.WriteFile(release, []byte("release"), 0o644)

	firstDone := make(chan error, 1)
	go func() {
		_, err := LandBranch(context.Background(), f.landOptions("merge"))
		firstDone <- err
	}()
	mergeGateWaitForFile(t, started)

	secondCtx, cancelSecond := context.WithTimeout(context.Background(), time.Second)
	_, secondErr := DryRunMerge(secondCtx, f.options())
	cancelSecond()
	if err := os.WriteFile(release, []byte("release"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !errors.Is(secondErr, context.DeadlineExceeded) {
		t.Errorf("second operation error = %v, want repository-lock wait to reach deadline", secondErr)
	}
	select {
	case err := <-firstDone:
		if err != nil {
			t.Errorf("first landing failed after release: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("first landing did not finish after hook release")
	}
	mergeGateAssertClean(t, f)
}

func mergeGateWaitForFile(t *testing.T, path string) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		if _, err := os.Stat(path); err == nil {
			return
		} else if !os.IsNotExist(err) {
			t.Fatal(err)
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", path)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func mergeGateFailTargetUpdate(t *testing.T) {
	t.Helper()
	realGit, err := exec.LookPath("git")
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("MERGE_GATE_REAL_GIT", realGit)
	bin := t.TempDir()
	if os.PathSeparator == '\\' {
		script := "@echo off\r\nif \"%~1\"==\"update-ref\" if \"%~2\"==\"refs/heads/main\" (\r\nif not \"%MERGE_GATE_EXTERNAL_EDIT%\"==\"\" echo external>\"%MERGE_GATE_EXTERNAL_EDIT%\"\r\nexit /b 1\r\n)\r\n\"%MERGE_GATE_REAL_GIT%\" %*\r\nexit /b %ERRORLEVEL%\r\n"
		if err := os.WriteFile(filepath.Join(bin, "git.cmd"), []byte(script), 0o755); err != nil {
			t.Fatal(err)
		}
	} else {
		script := "#!/bin/sh\nif [ \"$1\" = \"update-ref\" ] && [ \"$2\" = \"refs/heads/main\" ]; then\nif [ -n \"$MERGE_GATE_EXTERNAL_EDIT\" ]; then printf external > \"$MERGE_GATE_EXTERNAL_EDIT\"; fi\nexit 1\nfi\nexec \"$MERGE_GATE_REAL_GIT\" \"$@\"\n"
		if err := os.WriteFile(filepath.Join(bin, "git"), []byte(script), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
}
