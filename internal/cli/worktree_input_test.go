package cli

import "testing"

// The mode is required rather than defaulted: "start a new branch" and "check out this existing branch" produce
// different worktrees from the same slug.
func TestBuildWorktreeCreateRequestRequiresMode(t *testing.T) {
	if _, err := buildWorktreeCreateRequest(worktreeCreateOptions{Slug: "feat"}, "/repo"); err == nil {
		t.Fatal("a missing mode must be refused")
	}
	if _, err := buildWorktreeCreateRequest(worktreeCreateOptions{Mode: "nope", Slug: "feat"}, "/repo"); err == nil {
		t.Fatal("an unknown mode must be refused")
	}
}

func TestBuildWorktreeCreateBranchOff(t *testing.T) {
	request, err := buildWorktreeCreateRequest(worktreeCreateOptions{
		Mode: "branch-off", Slug: "feat", NewBranch: "feat/login", Base: "origin/main",
	}, "/repo")
	if err != nil {
		t.Fatal(err)
	}
	if request["worktreeSlug"] != "feat" || request["action"] != "branch-off" {
		t.Fatalf("request = %+v", request)
	}
	if request["branchName"] != "feat/login" || request["baseRef"] != "origin/main" {
		t.Fatalf("request = %+v", request)
	}

	// A slug is required: without one the server has nothing to name the directory after.
	if _, err := buildWorktreeCreateRequest(worktreeCreateOptions{Mode: "branch-off"}, "/repo"); err == nil {
		t.Fatal("branch-off without a slug must be refused")
	}
}

// "Check out this branch" must not be sent as "start a new one": the directory would look right with the wrong
// history.
func TestBuildWorktreeCreateCheckoutBranch(t *testing.T) {
	request, err := buildWorktreeCreateRequest(worktreeCreateOptions{
		Mode: "checkout-branch", Branch: "release/1.2",
	}, "/repo")
	if err != nil {
		t.Fatal(err)
	}
	if request["action"] != "checkout" || request["refName"] != "release/1.2" {
		t.Fatalf("request = %+v", request)
	}
	if _, has := request["worktreeSlug"]; has {
		t.Fatal("an empty slug must not be sent")
	}

	if _, err := buildWorktreeCreateRequest(worktreeCreateOptions{Mode: "checkout-branch"}, "/repo"); err == nil {
		t.Fatal("checkout-branch without --branch must be refused")
	}
}

func TestBuildWorktreeCreateCheckoutPR(t *testing.T) {
	request, err := buildWorktreeCreateRequest(worktreeCreateOptions{
		Mode: "checkout-pr", PRNumber: "#42",
	}, "/repo")
	if err != nil {
		t.Fatal(err)
	}
	if request["githubPrNumber"] != 42 {
		t.Fatalf("request = %+v", request)
	}

	for _, raw := range []string{"", "abc", "0", "-3"} {
		if _, err := buildWorktreeCreateRequest(worktreeCreateOptions{Mode: "checkout-pr", PRNumber: raw}, "/repo"); err == nil {
			t.Fatalf("%q should be refused", raw)
		}
	}
}

// The alias `--pr-number` must reach the same field as `--pr`.
func TestWorktreePRNumberAlias(t *testing.T) {
	options := worktreeCreateOptions{Mode: "checkout-pr", PRNumber: "7"}
	request, err := buildWorktreeCreateRequest(options, "/repo")
	if err != nil {
		t.Fatal(err)
	}
	if request["githubPrNumber"] != 7 {
		t.Fatalf("request = %+v", request)
	}
}
