package cli

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// worktreeCreateOptions is what the `worktree create` flags resolve to.
type worktreeCreateOptions struct {
	Mode      string
	Slug      string
	NewBranch string
	Base      string
	Branch    string
	PRNumber  string
}

// Worktree create modes.
const (
	worktreeModeBranchOff      = "branch-off"
	worktreeModeCheckoutBranch = "checkout-branch"
	worktreeModeCheckoutPR     = "checkout-pr"
)

// buildWorktreeCreateRequest turns the flags into a create request.
//
// Ported from worktree/create-input.ts. The mode is required rather than defaulted: "start a new branch" and "check
// out this existing branch" produce different worktrees from the same slug, and guessing wrong gives the user a
// correct-looking directory with the wrong history.
func buildWorktreeCreateRequest(options worktreeCreateOptions, cwd string) (map[string]any, error) {
	mode := strings.TrimSpace(options.Mode)
	if mode == "" {
		return nil, errors.New("--mode is required: expected one of branch-off, checkout-branch, checkout-pr")
	}

	switch mode {
	case worktreeModeBranchOff:
		slug := strings.TrimSpace(options.Slug)
		if slug == "" {
			return nil, errors.New("usage: byspace worktree create --mode branch-off [options] <slug>")
		}
		request := map[string]any{
			"cwd":          cwd,
			"worktreeSlug": slug,
			// An explicit action rather than the server's default: the same request shape carries three
			// different intents, and leaving it implicit is how "check out this branch" became "start a new one".
			"action": "branch-off",
		}
		if branch := strings.TrimSpace(options.NewBranch); branch != "" {
			request["branchName"] = branch
		}
		if base := strings.TrimSpace(options.Base); base != "" {
			request["baseRef"] = base
		}
		return request, nil

	case worktreeModeCheckoutBranch:
		branch := strings.TrimSpace(options.Branch)
		if branch == "" {
			return nil, errors.New("--branch is required for --mode checkout-branch")
		}
		request := map[string]any{
			"cwd":     cwd,
			"action":  "checkout",
			"refName": branch,
		}
		if slug := strings.TrimSpace(options.Slug); slug != "" {
			request["worktreeSlug"] = slug
		}
		return request, nil

	case worktreeModeCheckoutPR:
		raw := strings.TrimSpace(options.PRNumber)
		raw = strings.TrimPrefix(raw, "#")
		if raw == "" {
			return nil, errors.New("--pr is required for --mode checkout-pr")
		}
		number, err := strconv.Atoi(raw)
		if err != nil || number <= 0 {
			return nil, fmt.Errorf("invalid --pr: %q, expected a positive integer", options.PRNumber)
		}
		request := map[string]any{
			"cwd":            cwd,
			"action":         "checkout",
			"githubPrNumber": number,
		}
		if slug := strings.TrimSpace(options.Slug); slug != "" {
			request["worktreeSlug"] = slug
		}
		return request, nil
	}

	return nil, fmt.Errorf("invalid --mode: %q, expected one of branch-off, checkout-branch, checkout-pr", options.Mode)
}
