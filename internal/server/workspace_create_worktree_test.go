package server

import (
	"context"
	"testing"

	"github.com/ByteTrue/byspace/internal/workspace"
)

// The starting-ref picker sends `action: "branch-off"` with the picked branch in `refName`. Reading
// only `branchName`/`baseBranch` dropped it, so every worktree came off the default branch even
// though the trigger showed the picked one.
func TestWorktreeSourceIntentInputKeepsPickedRef(t *testing.T) {
	intent, err := workspace.ResolveWorktreeIntent(
		context.Background(),
		worktreeSourceIntentInput("branch-off", "dev", "", "", "feat-x", nil, nil),
		"",
		workspace.WorktreeIntentDeps{Forge: "github", DefaultBranch: defaultBranchRef},
	)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if intent.Kind != workspace.IntentBranchOff {
		t.Fatalf("kind = %q, want branch-off", intent.Kind)
	}
	if intent.BaseBranch != "dev" {
		t.Fatalf("base = %q, want the picked ref dev", intent.BaseBranch)
	}
	if intent.BranchName != "feat-x" {
		t.Fatalf("branch = %q, want the generated slug", intent.BranchName)
	}
}

// A branch-off with no picked ref uses the base the client resolved, not a fresh git lookup: the
// picker may show a pinned or remote base that git's default branch does not name.
func TestWorktreeSourceIntentInputFallsBackToResolvedBase(t *testing.T) {
	intent, err := workspace.ResolveWorktreeIntent(
		context.Background(),
		worktreeSourceIntentInput("branch-off", "", "origin/main", "", "feat-x", nil, nil),
		"",
		// A default branch that would be wrong if the base were ignored.
		workspace.WorktreeIntentDeps{Forge: "github", DefaultBranch: defaultBranchRef},
	)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if intent.BaseBranch != "origin/main" {
		t.Fatalf("base = %q, want the client-resolved base", intent.BaseBranch)
	}
}

// checkout with a refName checks that branch out instead of branching off it.
func TestWorktreeSourceIntentInputCheckoutBranch(t *testing.T) {
	intent, err := workspace.ResolveWorktreeIntent(
		context.Background(),
		worktreeSourceIntentInput("checkout", "release", "", "", "wt-1", nil, nil),
		"",
		workspace.WorktreeIntentDeps{Forge: "github", DefaultBranch: defaultBranchRef},
	)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if intent.Kind != workspace.IntentCheckoutBranch {
		t.Fatalf("kind = %q, want checkout-branch", intent.Kind)
	}
	if intent.BranchName != "release" {
		t.Fatalf("branch = %q, want release", intent.BranchName)
	}
}

// The legacy githubPrNumber still resolves to a change-request checkout; dropping it would silently
// create a branch off the default instead of checking out the PR head.
func TestWorktreeSourceIntentInputLegacyPrNumber(t *testing.T) {
	number := 42
	intent, err := workspace.ResolveWorktreeIntent(
		context.Background(),
		worktreeSourceIntentInput("checkout", "pr-head", "", "", "wt-pr", nil, &number),
		"",
		workspace.WorktreeIntentDeps{
			Forge:               "github",
			DefaultBranch:       defaultBranchRef,
			ChangeRequestTarget: stubChangeRequestTarget{head: "pr-head", base: "main"}.resolve,
		},
	)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if intent.Kind != workspace.IntentCheckoutChangeRequest {
		t.Fatalf("kind = %q, want checkout-change-request", intent.Kind)
	}
	if intent.ChangeRequestNumber != 42 || intent.Forge != "github" {
		t.Fatalf("intent = %+v, want PR 42 on github", intent)
	}
}

// checkoutSource takes precedence over a bare refName for change-request checkouts.
//
// The head ref comes from a stub: the real resolver shells out to `gh`, which CI does not have.
// This test is about how the structure field becomes an intent, not about PR lookup.
func TestWorktreeSourceIntentInputCheckoutSource(t *testing.T) {
	intent, err := workspace.ResolveWorktreeIntent(
		context.Background(),
		worktreeSourceIntentInput("checkout", "", "", "", "wt-pr", &sourceCheckoutSource{Number: 7, Forge: "github"}, nil),
		"",
		workspace.WorktreeIntentDeps{
			Forge:               "github",
			DefaultBranch:       defaultBranchRef,
			ChangeRequestTarget: stubChangeRequestTarget{head: "pr-7-head", base: "main"}.resolve,
		},
	)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if intent.Kind != workspace.IntentCheckoutChangeRequest || intent.ChangeRequestNumber != 7 {
		t.Fatalf("intent = %+v, want checkout of PR 7", intent)
	}
	if intent.HeadRef != "pr-7-head" {
		t.Fatalf("head = %q, want the resolved PR head", intent.HeadRef)
	}
}

// stubChangeRequestTarget stands in for the forge CLI.
type stubChangeRequestTarget struct{ head, base string }

func (s stubChangeRequestTarget) resolve(context.Context, string, string, int) (workspace.ChangeRequestCheckoutTarget, error) {
	return workspace.ChangeRequestCheckoutTarget{HeadRef: s.head, BaseRefName: s.base}, nil
}

func defaultBranchRef(context.Context, string) (string, error) { return "main", nil }
