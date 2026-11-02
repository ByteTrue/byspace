package workspace

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// How a checkout finds its pull request, ported from PullRequestStatusLookupTarget and
// getCheckoutSnapshotFacts in the archived Node daemon's utils/checkout-git.ts.
//
// The local branch name is not always the PR's head branch: a PR checked out from a fork tracks
// `<fork>/<branch>`, a branch can push to a differently named remote branch, and a BySpace worktree
// created from a PR records which PR it is. The head commit decides whether a merged or closed PR
// still describes the checkout: once the branch moves past the PR's head, that PR is history.

// PRLookupTarget names the pull request a checkout belongs to.
type PRLookupTarget struct {
	HeadRef             string
	HeadSha             string
	HeadRepositoryOwner string
}

// ResolvePRLookupTarget reads a checkout's lookup target. nil means the checkout is not on a
// branch (detached HEAD outside a rebase, or not a repository).
func ResolvePRLookupTarget(ctx context.Context, cwd string) *PRLookupTarget {
	branch := currentBranchForPRLookup(ctx, cwd)
	if branch == "" {
		return nil
	}
	target := prLookupTargetFromMetadata(ctx, cwd, branch)
	if target == nil {
		origin := OriginRemoteURL(ctx, cwd)
		baseRef := ResolveDiffBaseRef(ctx, cwd)
		remoteName := gitConfigValue(ctx, cwd, "branch."+branch+".remote")
		var mergeRef, remoteURL string
		if remoteName != "" {
			mergeRef = gitConfigValue(ctx, cwd, "branch."+branch+".merge")
			if remoteName == "origin" {
				remoteURL = origin
			} else {
				remoteURL = gitConfigValue(ctx, cwd, "remote."+remoteName+".url")
			}
		}
		fromBranch := prLookupTargetFromBranchConfig(branch, remoteName, mergeRef, remoteURL, origin, baseRef)
		target = &fromBranch
		if target.HeadRef == branch && target.HeadRepositoryOwner == "" {
			if pushed := prLookupTargetFromPushConfig(ctx, cwd, branch, origin, baseRef); pushed != nil {
				target = pushed
			}
		}
	}
	if sha, err := runGit(ctx, cwd, "rev-parse", "HEAD"); err == nil {
		target.HeadSha = strings.TrimSpace(sha)
	}
	return target
}

// currentBranchForPRLookup is the checked-out branch, or the branch being rebased: mid-rebase HEAD
// is detached, and the PR is still the one for the branch under rebase.
func currentBranchForPRLookup(ctx context.Context, cwd string) string {
	if branch, err := runGit(ctx, cwd, "symbolic-ref", "--quiet", "--short", "HEAD"); err == nil && strings.TrimSpace(branch) != "" {
		return strings.TrimSpace(branch)
	}
	for _, path := range []string{"rebase-merge/head-name", "rebase-apply/head-name"} {
		gitPath, err := runGit(ctx, cwd, "rev-parse", "--git-path", path)
		if err != nil || strings.TrimSpace(gitPath) == "" {
			continue
		}
		resolved := strings.TrimSpace(gitPath)
		if !filepath.IsAbs(resolved) {
			resolved = filepath.Join(cwd, resolved)
		}
		raw, err := os.ReadFile(resolved)
		if err != nil {
			continue
		}
		headName := strings.TrimSpace(string(raw))
		if name, ok := strings.CutPrefix(headName, "refs/heads/"); ok {
			headName = name
		}
		if headName != "" {
			return headName
		}
	}
	return ""
}

func gitConfigValue(ctx context.Context, cwd, key string) string {
	out, err := runGit(ctx, cwd, "config", "--get", key)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(out)
}

// prLookupTargetFromMetadata is the PR a BySpace worktree was created from, while the worktree is
// still on the branch it was created with.
func prLookupTargetFromMetadata(ctx context.Context, cwd, branch string) *PRLookupTarget {
	root, err := runGit(ctx, cwd, "rev-parse", "--show-toplevel")
	if err != nil || strings.TrimSpace(root) == "" {
		return nil
	}
	meta := ReadWorktreeMetadata(strings.TrimSpace(root))
	if meta == nil || meta.ChangeRequestLookupTarget == nil {
		return nil
	}
	hint := meta.ChangeRequestLookupTarget
	if !changeRequestHintMatchesBranch(*hint, branch) {
		return nil
	}
	return &PRLookupTarget{HeadRef: hint.HeadRef, HeadRepositoryOwner: hint.HeadRepositoryOwner}
}

var legacyGitHubOwnerPattern = regexp.MustCompile(`^[a-z0-9-]+$`)

// changeRequestHintMatchesBranch is Node's getBySpaceWorktreeChangeRequestHintForBranch.
func changeRequestHintMatchesBranch(hint ChangeRequestLookupTarget, branch string) bool {
	if hint.LocalBranchName != "" {
		return hint.LocalBranchName == branch
	}
	// Metadata written before the local branch was recorded: the branch is the head ref, or
	// <owner>/<head ref> for a fork's PR.
	if hint.HeadRepositoryOwner == "" {
		return branch == hint.HeadRef
	}
	if branch == hint.HeadRepositoryOwner+"/"+hint.HeadRef {
		return true
	}
	owner := strings.ToLower(strings.TrimSpace(hint.HeadRepositoryOwner))
	return legacyGitHubOwnerPattern.MatchString(owner) && branch == owner+"/"+hint.HeadRef
}

// prLookupTargetFromBranchConfig is Node's buildPullRequestLookupTargetFromBranchConfig: a branch
// that tracks `refs/heads/<x>` on a remote is looking for the PR whose head is <x>, owned by that
// remote's owner when it is another repository.
func prLookupTargetFromBranchConfig(branch, remoteName, mergeRef, remoteURL, originURL, baseRef string) PRLookupTarget {
	trackedHeadRef := branchMergeHeadRef(mergeRef)
	if remoteName == "" || trackedHeadRef == "" {
		return PRLookupTarget{HeadRef: branch}
	}
	remoteRepo := remoteRepositoryIdentity(remoteURL)
	originRepo := remoteRepositoryIdentity(originURL)
	sameRepo := remoteRepo != "" && originRepo != "" && strings.EqualFold(remoteRepo, originRepo)
	headOwner := ""
	if remoteRepo != "" && !sameRepo {
		headOwner, _, _ = strings.Cut(remoteRepo, "/")
	}
	// A branch that merely tracks the base branch (a new branch cut from origin/main) is not
	// looking for main's PR.
	if baseRef != "" && trackedHeadRef == BranchNameFromRef(baseRef) &&
		!localBranchIdentifiesTrackedHead(branch, trackedHeadRef, headOwner) {
		return PRLookupTarget{HeadRef: branch}
	}
	if sameRepo {
		return PRLookupTarget{HeadRef: trackedHeadRef}
	}
	return PRLookupTarget{HeadRef: trackedHeadRef, HeadRepositoryOwner: headOwner}
}

func localBranchIdentifiesTrackedHead(branch, trackedHeadRef, headOwner string) bool {
	if branch == trackedHeadRef {
		return true
	}
	if headOwner == "" {
		return false
	}
	return branch == headOwner+"/"+trackedHeadRef || branch == strings.ToLower(headOwner)+"/"+trackedHeadRef
}

// prLookupTargetFromPushConfig is Node's resolvePullRequestLookupTargetFromPushConfig: a branch with
// a push remote whose refspec pushes HEAD to another branch name.
func prLookupTargetFromPushConfig(ctx context.Context, cwd, branch, originURL, baseRef string) *PRLookupTarget {
	pushRemote := gitConfigValue(ctx, cwd, "branch."+branch+".pushRemote")
	if pushRemote == "" {
		return nil
	}
	pushedHeadRef := headPushRefspecTarget(gitConfigValue(ctx, cwd, "remote."+pushRemote+".push"))
	if pushedHeadRef == "" || pushedHeadRef == branch {
		return nil
	}
	remoteRepo := gitHubRepoFromRemote(gitConfigValue(ctx, cwd, "remote."+pushRemote+".url"))
	originRepo := gitHubRepoFromRemote(originURL)
	sameRepo := remoteRepo != "" && originRepo != "" && strings.EqualFold(remoteRepo, originRepo)
	headOwner := ""
	if remoteRepo != "" && !sameRepo {
		headOwner, _, _ = strings.Cut(remoteRepo, "/")
	}
	if baseRef != "" && pushedHeadRef == BranchNameFromRef(baseRef) && headOwner == "" {
		return nil
	}
	return &PRLookupTarget{HeadRef: pushedHeadRef, HeadRepositoryOwner: headOwner}
}

func branchMergeHeadRef(mergeRef string) string {
	headRef, ok := strings.CutPrefix(mergeRef, "refs/heads/")
	if !ok {
		return ""
	}
	return strings.TrimSpace(headRef)
}

func headPushRefspecTarget(refspec string) string {
	normalized := strings.TrimPrefix(strings.TrimSpace(refspec), "+")
	headRef, ok := strings.CutPrefix(normalized, "HEAD:refs/heads/")
	if !ok {
		return ""
	}
	return strings.TrimSpace(headRef)
}

// remoteRepositoryIdentity is "owner/name" from any forge remote with a two-segment path.
func remoteRepositoryIdentity(remote string) string {
	location, ok := parseRemoteLocation(remote)
	if !ok {
		return ""
	}
	return twoSegmentRepoPath(location.path)
}

// gitHubRepoFromRemote is "owner/name" from a github.com remote, "" for any other host.
func gitHubRepoFromRemote(remote string) string {
	location, ok := parseRemoteLocation(remote)
	if !ok || !isGitHubCloudHost(location.host) {
		return ""
	}
	return twoSegmentRepoPath(location.path)
}

func twoSegmentRepoPath(path string) string {
	var segments []string
	for _, segment := range strings.Split(path, "/") {
		if segment != "" {
			segments = append(segments, segment)
		}
	}
	if len(segments) != 2 {
		return ""
	}
	return segments[0] + "/" + segments[1]
}
