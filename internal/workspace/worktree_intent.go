package workspace

import (
	"context"
	"fmt"
	"strings"
)

// Worktree creation intent, ported from resolve-worktree-creation-intent.ts.
//
// The client says *what* it wants in three loosely coupled fields (`action`, `refName`,
// `checkoutSource`), and the combinations mean different things:
//
//	action=branch-off            new branch from refName (or the default branch)
//	action=checkout + refName    check out that existing branch
//	action=checkout + PR number  check out a change request
//	action omitted + PR number   the same, for clients that predate `action`
//
// Resolving that once, up front, keeps the git layer from growing a matrix of cases.

// IntentKind is what the caller asked for.
type IntentKind string

const (
	// IntentBranchOff creates a new branch from a base.
	IntentBranchOff IntentKind = "branch-off"
	// IntentCheckoutBranch checks out an existing branch.
	IntentCheckoutBranch IntentKind = "checkout-branch"
	// IntentCheckoutChangeRequest checks out a pull/merge request's head.
	IntentCheckoutChangeRequest IntentKind = "checkout-change-request"
)

// WorktreeIntent is the resolved plan.
type WorktreeIntent struct {
	Kind       IntentKind
	BaseBranch string // branch-off: where the new branch starts
	BranchName string // branch-off/checkout-branch: the local branch
	// ChangeRequest fields are set for IntentCheckoutChangeRequest.
	Forge               string
	ChangeRequestNumber int
	HeadRef             string
	BaseRefName         string
	IsCrossRepository   bool
	HeadRepository      string
}

// MissingCheckoutTargetError mirrors the node error of the same name.
type MissingCheckoutTargetError struct{}

func (MissingCheckoutTargetError) Error() string {
	return `action "checkout" requires refName or checkoutSource`
}

// ForgeMismatchError reports a checkout source that belongs to a different forge.
type ForgeMismatchError struct {
	CheckoutSourceForge string
	WorkspaceForge      string
}

func (e ForgeMismatchError) Error() string {
	return fmt.Sprintf("checkout source is for %s, but this workspace resolved to %s",
		e.CheckoutSourceForge, e.WorkspaceForge)
}

// CheckoutSource is the structured change-request reference from the protocol.
type CheckoutSource struct {
	// Kind is `change_request`; carried for protocol fidelity and future kind values.
	Kind        string `json:"kind,omitempty"`
	Number      int    `json:"number"`
	Forge       string `json:"forge,omitempty"`
	ProjectPath string `json:"projectPath,omitempty"`
}

// WorktreeIntentInput is the subset of the request the resolver needs.
type WorktreeIntentInput struct {
	WorktreeSlug   string
	BranchName     string
	RefName        string
	Action         string // "branch-off" | "checkout" | ""
	CheckoutSource *CheckoutSource
	// GithubPRNumber is the legacy field the protocol still accepts.
	GithubPRNumber *int
}

// WorktreeIntentDeps is what the resolver needs from the environment.
type WorktreeIntentDeps struct {
	// Forge is the repository's resolved forge id ("github", "gitlab", "gitea").
	Forge string
	// DefaultBranch resolves the repository's default branch.
	DefaultBranch func(ctx context.Context, repoRoot string) (string, error)
}

// ResolveWorktreeIntent turns the request fields into one intent.
func ResolveWorktreeIntent(ctx context.Context, input WorktreeIntentInput, repoRoot string, deps WorktreeIntentDeps) (WorktreeIntent, error) {
	branchName := strings.TrimSpace(input.BranchName)
	if branchName == "" {
		branchName = strings.TrimSpace(input.WorktreeSlug)
	}
	if branchName == "" {
		branchName = "worktree"
	}
	refName := strings.TrimSpace(input.RefName)

	if input.Action == "branch-off" {
		base := refName
		if base == "" {
			resolved, err := deps.DefaultBranch(ctx, repoRoot)
			if err != nil {
				return WorktreeIntent{}, err
			}
			base = resolved
		}
		return WorktreeIntent{Kind: IntentBranchOff, BaseBranch: base, BranchName: branchName}, nil
	}

	changeRequest, err := resolveInputChangeRequest(input, deps.Forge)
	if err != nil {
		return WorktreeIntent{}, err
	}

	if input.Action == "checkout" {
		if changeRequest != nil {
			return resolveChangeRequestIntent(ctx, refName, *changeRequest, repoRoot, deps)
		}
		if refName == "" {
			return WorktreeIntent{}, MissingCheckoutTargetError{}
		}
		return WorktreeIntent{Kind: IntentCheckoutBranch, BranchName: refName}, nil
	}

	// No action: a change request still wins, then a plain ref, then the default branch.
	if changeRequest != nil {
		return resolveChangeRequestIntent(ctx, refName, *changeRequest, repoRoot, deps)
	}
	if refName != "" {
		return WorktreeIntent{Kind: IntentBranchOff, BaseBranch: refName, BranchName: branchName}, nil
	}
	resolved, err := deps.DefaultBranch(ctx, repoRoot)
	if err != nil {
		return WorktreeIntent{}, err
	}
	return WorktreeIntent{Kind: IntentBranchOff, BaseBranch: resolved, BranchName: branchName}, nil
}

// resolveInputChangeRequest picks the change-request reference, preferring the structured field.
//
// `githubPrNumber` is the legacy shape; the protocol keeps accepting it, so it is read here
// rather than at the call site.
func resolveInputChangeRequest(input WorktreeIntentInput, workspaceForge string) (*CheckoutSource, error) {
	source := input.CheckoutSource
	if source == nil && input.GithubPRNumber != nil {
		source = &CheckoutSource{Number: *input.GithubPRNumber}
	}
	if source == nil || source.Number <= 0 {
		return nil, nil
	}
	if source.Forge != "" && workspaceForge != "" && source.Forge != workspaceForge {
		return nil, ForgeMismatchError{CheckoutSourceForge: source.Forge, WorkspaceForge: workspaceForge}
	}
	return source, nil
}

// resolveChangeRequestIntent resolves the head ref for a change request.
func resolveChangeRequestIntent(ctx context.Context, refName string, source CheckoutSource, repoRoot string, deps WorktreeIntentDeps) (WorktreeIntent, error) {
	headRef := refName
	isCrossRepository := false
	headRepository := ""
	if headRef == "" {
		target, err := ResolveChangeRequestCheckoutTarget(ctx, deps.Forge, repoRoot, source.Number)
		if err != nil {
			return WorktreeIntent{}, err
		}
		headRef = target.HeadRef
		isCrossRepository = target.IsCrossRepository
		headRepository = target.HeadRepository
	}

	baseRefName := ""
	if target, err := ResolveChangeRequestCheckoutTarget(ctx, deps.Forge, repoRoot, source.Number); err == nil {
		baseRefName = target.BaseRefName
	}
	if baseRefName == "" {
		if resolved, err := deps.DefaultBranch(ctx, repoRoot); err == nil {
			baseRefName = resolved
		}
	}

	return WorktreeIntent{
		Kind:                IntentCheckoutChangeRequest,
		Forge:               deps.Forge,
		ChangeRequestNumber: source.Number,
		HeadRef:             headRef,
		BaseRefName:         baseRefName,
		IsCrossRepository:   isCrossRepository,
		HeadRepository:      headRepository,
	}, nil
}

// ChangeRequestCheckoutTarget is the forge-independent view of a PR/MR.
type ChangeRequestCheckoutTarget struct {
	HeadRef           string
	BaseRefName       string
	IsCrossRepository bool
	HeadRepository    string
}

// CreateWorktreeFromIntent materialises a worktree for the resolved intent.
func CreateWorktreeFromIntent(ctx context.Context, repoCwd, worktreesBaseDir string, intent WorktreeIntent, slug string) (string, string, error) {
	switch intent.Kind {
	case IntentCheckoutBranch:
		return checkoutExistingBranch(ctx, repoCwd, worktreesBaseDir, slug, intent.BranchName)
	case IntentCheckoutChangeRequest:
		return checkoutChangeRequest(ctx, repoCwd, worktreesBaseDir, slug, intent)
	default:
		return CreateWorktree(ctx, repoCwd, worktreesBaseDir, slug, intent.BaseBranch)
	}
}
