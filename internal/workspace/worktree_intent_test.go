package workspace

import (
	"context"
	"errors"
	"testing"
)

func defaultMain(context.Context, string) (string, error) { return "main", nil }

// The client says what it wants across three loosely coupled fields; each combination has a
// different meaning, and reading only refName collapses them all into "branch off refName".
func TestResolveWorktreeIntent(t *testing.T) {
	deps := WorktreeIntentDeps{Forge: "github", DefaultBranch: defaultMain}
	five := 5

	cases := []struct {
		name  string
		input WorktreeIntentInput
		want  WorktreeIntent
	}{
		{
			name:  "bare request branches off the default",
			input: WorktreeIntentInput{WorktreeSlug: "feat-x"},
			want:  WorktreeIntent{Kind: IntentBranchOff, BaseBranch: "main", BranchName: "feat-x"},
		},
		{
			name:  "refName becomes the base",
			input: WorktreeIntentInput{WorktreeSlug: "feat-x", RefName: "develop"},
			want:  WorktreeIntent{Kind: IntentBranchOff, BaseBranch: "develop", BranchName: "feat-x"},
		},
		{
			name:  "explicit branch-off wins over refName shape",
			input: WorktreeIntentInput{WorktreeSlug: "feat-x", RefName: "release", Action: "branch-off"},
			want:  WorktreeIntent{Kind: IntentBranchOff, BaseBranch: "release", BranchName: "feat-x"},
		},
		{
			name:  "checkout with refName checks out that branch",
			input: WorktreeIntentInput{RefName: "existing", Action: "checkout"},
			want:  WorktreeIntent{Kind: IntentCheckoutBranch, BranchName: "existing"},
		},
		{
			name:  "legacy githubPrNumber still resolves",
			input: WorktreeIntentInput{GithubPRNumber: &five, RefName: "pr-head"},
			want: WorktreeIntent{
				Kind: IntentCheckoutChangeRequest, Forge: "github", ChangeRequestNumber: 5,
				HeadRef: "pr-head", BaseRefName: "main",
			},
		},
		{
			name: "structured checkoutSource wins over the legacy field",
			input: WorktreeIntentInput{
				CheckoutSource: &CheckoutSource{Kind: "change_request", Number: 9},
				RefName:        "pr-head",
			},
			want: WorktreeIntent{
				Kind: IntentCheckoutChangeRequest, Forge: "github", ChangeRequestNumber: 9,
				HeadRef: "pr-head", BaseRefName: "main",
			},
		},
	}

	for _, tc := range cases {
		got, err := ResolveWorktreeIntent(context.Background(), tc.input, "/repo", deps)
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if got.Kind != tc.want.Kind || got.BaseBranch != tc.want.BaseBranch ||
			got.BranchName != tc.want.BranchName || got.HeadRef != tc.want.HeadRef ||
			got.BaseRefName != tc.want.BaseRefName || got.ChangeRequestNumber != tc.want.ChangeRequestNumber {
			t.Fatalf("%s: got %+v want %+v", tc.name, got, tc.want)
		}
	}
}

// "checkout" with nothing to check out is an error, not a silent branch-off.
func TestResolveWorktreeIntentMissingCheckoutTarget(t *testing.T) {
	deps := WorktreeIntentDeps{Forge: "github", DefaultBranch: defaultMain}
	_, err := ResolveWorktreeIntent(context.Background(),
		WorktreeIntentInput{Action: "checkout"}, "/repo", deps)
	var missing MissingCheckoutTargetError
	if !errors.As(err, &missing) {
		t.Fatalf("expected MissingCheckoutTargetError, got %v", err)
	}
}

// A change request belonging to a different forge cannot be checked out here.
func TestResolveWorktreeIntentForgeMismatch(t *testing.T) {
	deps := WorktreeIntentDeps{Forge: "gitlab", DefaultBranch: defaultMain}
	_, err := ResolveWorktreeIntent(context.Background(), WorktreeIntentInput{
		CheckoutSource: &CheckoutSource{Kind: "change_request", Number: 3, Forge: "github"},
	}, "/repo", deps)
	var mismatch ForgeMismatchError
	if !errors.As(err, &mismatch) {
		t.Fatalf("expected ForgeMismatchError, got %v", err)
	}
	if mismatch.CheckoutSourceForge != "github" || mismatch.WorkspaceForge != "gitlab" {
		t.Fatalf("mismatch fields: %+v", mismatch)
	}
}

// BaseRef is recorded so a later diff uses the same base even if the remote's default branch
// changes. Every branch-off path must set it, not just the explicit action.
func TestResolveWorktreeIntentSetsBaseRefOnEveryBranchOffPath(t *testing.T) {
	deps := WorktreeIntentDeps{Forge: "github", DefaultBranch: defaultMain}
	cases := []WorktreeIntentInput{
		{WorktreeSlug: "a"},                     // default branch
		{WorktreeSlug: "b", RefName: "develop"}, // explicit base
		{WorktreeSlug: "c", Action: "branch-off"},
	}
	for _, input := range cases {
		got, err := ResolveWorktreeIntent(context.Background(), input, "/repo", deps)
		if err != nil {
			t.Fatalf("%+v: %v", input, err)
		}
		if got.Kind != IntentBranchOff {
			continue
		}
		if got.BaseRef == "" {
			t.Fatalf("%+v: BaseRef must be set for every branch-off", input)
		}
	}
}
