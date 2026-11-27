package workspace

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/proc"
)

type DryRunOptions struct {
	TargetCwd string
	TargetRef string
	SourceCwd string
	SourceRef string
}

type MergeDryRunResult struct {
	Clean            bool
	TargetRef        string
	TargetSha        string
	SourceRef        string
	SourceSha        string
	MergeTreeSha     string
	ConflictingFiles []string
	DirtyWorktree    bool
	AheadCount       int
	CheckedAt        time.Time
}

var mergeGateRepositoryLocks sync.Map

func DryRunMerge(ctx context.Context, opts DryRunOptions) (MergeDryRunResult, error) {
	result := MergeDryRunResult{TargetRef: opts.TargetRef, SourceRef: opts.SourceRef}
	commonDir, err := resolveMergeGateRepository(ctx, opts.TargetCwd, opts.TargetRef, opts.SourceCwd, opts.SourceRef)
	if err != nil {
		return result, err
	}
	release, err := lockMergeGateRepository(ctx, commonDir)
	if err != nil {
		return result, err
	}
	defer release()
	return dryRunMergeLocked(ctx, opts)
}

type LandOptions struct {
	TargetCwd     string
	TargetBranch  string
	SourceCwd     string
	SourceBranch  string
	Strategy      string
	CommitMessage string
}

type LandResult struct {
	TargetSha string
	SourceSha string
}

func LandBranch(ctx context.Context, opts LandOptions) (LandResult, error) {
	switch opts.Strategy {
	case "merge", "squash", "rebase":
	default:
		return LandResult{}, fmt.Errorf("unsupported landing strategy %q", opts.Strategy)
	}
	commonDir, err := resolveMergeGateRepository(ctx, opts.TargetCwd, opts.TargetBranch, opts.SourceCwd, opts.SourceBranch)
	if err != nil {
		return LandResult{}, err
	}
	release, err := lockMergeGateRepository(ctx, commonDir)
	if err != nil {
		return LandResult{}, err
	}
	defer release()

	dryRun, err := dryRunMergeLocked(ctx, DryRunOptions{
		TargetCwd: opts.TargetCwd,
		TargetRef: opts.TargetBranch,
		SourceCwd: opts.SourceCwd,
		SourceRef: opts.SourceBranch,
	})
	if err != nil {
		return LandResult{}, fmt.Errorf("pre-landing dry run: %w", err)
	}
	result := LandResult{TargetSha: dryRun.TargetSha, SourceSha: dryRun.SourceSha}
	if dryRun.DirtyWorktree {
		return result, fmt.Errorf("landing requires clean target and source checkouts")
	}
	if !dryRun.Clean {
		return result, fmt.Errorf("landing has merge conflicts: %s", strings.Join(dryRun.ConflictingFiles, ", "))
	}

	targetSHA, err := mergeGateHeadSHA(ctx, opts.TargetCwd, opts.TargetBranch)
	if err != nil {
		return result, fmt.Errorf("re-resolve target branch before landing: %w", err)
	}
	if targetSHA != dryRun.TargetSha {
		return result, fmt.Errorf("target branch moved during landing: dry run verified %s, now %s", dryRun.TargetSha, targetSHA)
	}
	sourceSHA, err := mergeGateHeadSHA(ctx, opts.SourceCwd, opts.SourceBranch)
	if err != nil {
		return result, fmt.Errorf("re-resolve source branch before landing: %w", err)
	}
	if sourceSHA != dryRun.SourceSha {
		return result, fmt.Errorf("source branch moved during landing: dry run verified %s, now %s", dryRun.SourceSha, sourceSHA)
	}

	switch opts.Strategy {
	case "merge", "squash":
		return landMergeGateCommit(ctx, opts, dryRun, result)
	case "rebase":
		return landMergeGateRebase(ctx, opts, dryRun, result)
	}
	panic("unreachable landing strategy")
}

func landMergeGateCommit(ctx context.Context, opts LandOptions, dryRun MergeDryRunResult, result LandResult) (LandResult, error) {
	worktree, cleanup, err := newMergeGateLandingWorktree(ctx, opts.TargetCwd, dryRun.TargetSha)
	if err != nil {
		return result, err
	}
	defer func() { _ = cleanup() }()

	if opts.Strategy == "merge" {
		_, err = runMergeGateGit(ctx, worktree, "merge", "--no-ff", "--no-edit", dryRun.SourceSha)
	} else {
		_, err = runMergeGateGit(ctx, worktree, "merge", "--squash", dryRun.SourceSha)
		if err == nil {
			_, err = runMergeGateGit(ctx, worktree, "commit", "-m", opts.CommitMessage)
		}
	}
	if err != nil {
		cleanupArgs := []string{"merge", "--abort"}
		if opts.Strategy == "squash" {
			cleanupArgs = []string{"reset", "--merge"}
		}
		cleanupErr := errors.Join(runMergeGateCleanup(ctx, worktree, cleanupArgs...), cleanup())
		return result, mergeGateLandError(fmt.Errorf("%s immutable source revision: %w", opts.Strategy, err), cleanupErr)
	}
	newTargetSHA, err := mergeGateHeadSHA(context.WithoutCancel(ctx), worktree, "HEAD")
	if err != nil {
		return result, mergeGateLandError(fmt.Errorf("resolve constructed landing commit: %w", err), cleanup())
	}
	if err := cleanup(); err != nil {
		return result, fmt.Errorf("clean up landing worktree before ref update: %w", err)
	}
	if err := compareAndSwapMergeGateRef(ctx, opts.TargetCwd, opts.TargetBranch, newTargetSHA, dryRun.TargetSha); err != nil {
		return result, fmt.Errorf("compare-and-swap target branch: %w", err)
	}

	// The ref is authoritative now. Never turn a checkout sync failure into a
	// retryable landing error after the CAS; later merge checks report dirtiness.
	_ = syncMergeGateCheckout(context.WithoutCancel(ctx), opts.TargetCwd, dryRun.TargetSha, newTargetSHA)
	result.TargetSha = newTargetSHA
	return result, nil
}

func landMergeGateRebase(ctx context.Context, opts LandOptions, dryRun MergeDryRunResult, result LandResult) (LandResult, error) {
	worktree, cleanup, err := newMergeGateLandingWorktree(ctx, opts.TargetCwd, dryRun.SourceSha)
	if err != nil {
		return result, err
	}
	defer func() { _ = cleanup() }()

	if _, err := runMergeGateGit(ctx, worktree, "rebase", dryRun.TargetSha); err != nil {
		cleanupErr := errors.Join(runMergeGateCleanup(ctx, worktree, "rebase", "--abort"), cleanup())
		return result, mergeGateLandError(fmt.Errorf("rebase immutable source revision: %w", err), cleanupErr)
	}
	rebasedSourceSHA, err := mergeGateHeadSHA(context.WithoutCancel(ctx), worktree, "HEAD")
	if err != nil {
		return result, mergeGateLandError(fmt.Errorf("resolve rebased source revision: %w", err), cleanup())
	}
	if err := cleanup(); err != nil {
		return result, fmt.Errorf("clean up rebase worktree before ref update: %w", err)
	}

	if err := compareAndSwapMergeGateRef(ctx, opts.SourceCwd, opts.SourceBranch, rebasedSourceSHA, dryRun.SourceSha); err != nil {
		return result, fmt.Errorf("compare-and-swap rebased source branch: %w", err)
	}
	if err := syncMergeGateCheckout(context.WithoutCancel(ctx), opts.SourceCwd, dryRun.SourceSha, rebasedSourceSHA); err != nil {
		restoreErr := restoreMergeGateSource(ctx, opts.SourceCwd, opts.SourceBranch, rebasedSourceSHA, dryRun.SourceSha)
		return result, mergeGateLandError(fmt.Errorf("sync rebased source checkout: %w", err), restoreErr)
	}
	if err := compareAndSwapMergeGateRef(ctx, opts.TargetCwd, opts.TargetBranch, rebasedSourceSHA, dryRun.TargetSha); err != nil {
		restoreErr := restoreMergeGateSource(ctx, opts.SourceCwd, opts.SourceBranch, rebasedSourceSHA, dryRun.SourceSha)
		return result, mergeGateLandError(fmt.Errorf("compare-and-swap target branch: %w", err), restoreErr)
	}

	// As above, the landed refs and returned SHAs remain authoritative even if
	// an external process makes the target checkout impossible to synchronize.
	_ = syncMergeGateCheckout(context.WithoutCancel(ctx), opts.TargetCwd, dryRun.TargetSha, rebasedSourceSHA)
	result.TargetSha = rebasedSourceSHA
	result.SourceSha = rebasedSourceSHA
	return result, nil
}

func newMergeGateLandingWorktree(ctx context.Context, repositoryCwd, baseSHA string) (string, func() error, error) {
	root, err := os.MkdirTemp("", "byspace-landing-")
	if err != nil {
		return "", nil, fmt.Errorf("create landing worktree parent: %w", err)
	}
	worktree := filepath.Join(root, "worktree")
	if _, err := runMergeGateGit(ctx, repositoryCwd, "worktree", "add", "--detach", worktree, baseSHA); err != nil {
		_ = os.RemoveAll(root)
		return "", nil, fmt.Errorf("create detached landing worktree: %w", err)
	}
	var once sync.Once
	var cleanupErr error
	cleanup := func() error {
		once.Do(func() {
			cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), gitLocalTimeout)
			defer cancel()
			_, removeErr := runMergeGateGit(cleanupCtx, repositoryCwd, "worktree", "remove", "--force", worktree)
			cleanupErr = errors.Join(removeErr, os.RemoveAll(root))
		})
		return cleanupErr
	}
	return worktree, cleanup, nil
}

func compareAndSwapMergeGateRef(ctx context.Context, cwd, branch, newSHA, expectedSHA string) error {
	_, err := runMergeGateGit(ctx, cwd, "update-ref", "refs/heads/"+branch, newSHA, expectedSHA)
	return err
}

func syncMergeGateCheckout(ctx context.Context, cwd, oldSHA, newSHA string) error {
	_, err := runMergeGateGit(ctx, cwd, "read-tree", "-m", "-u", oldSHA, newSHA)
	return err
}

func resolveMergeGateRepository(ctx context.Context, targetCwd, targetRef, sourceCwd, sourceRef string) (string, error) {
	if err := AssertSafeGitRef(targetRef, "target ref"); err != nil {
		return "", err
	}
	if err := AssertSafeGitRef(sourceRef, "source ref"); err != nil {
		return "", err
	}
	_, targetCommonDir, err := ResolveGitDirs(ctx, targetCwd)
	if err != nil {
		return "", fmt.Errorf("resolve target repository: %w", err)
	}
	_, sourceCommonDir, err := ResolveGitDirs(ctx, sourceCwd)
	if err != nil {
		return "", fmt.Errorf("resolve source repository: %w", err)
	}
	if !sameMergeGatePath(targetCommonDir, sourceCommonDir) {
		return "", fmt.Errorf("target and source must belong to the same repository")
	}
	return targetCommonDir, nil
}

func runMergeGateCleanup(ctx context.Context, cwd string, args ...string) error {
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), gitLocalTimeout)
	defer cancel()
	_, err := runMergeGateGit(cleanupCtx, cwd, args...)
	return err
}

func mergeGateLandError(cause, cleanupErr error) error {
	if cleanupErr != nil {
		return errors.Join(cause, fmt.Errorf("clean up failed landing: %w", cleanupErr))
	}
	return cause
}

func restoreMergeGateSource(ctx context.Context, cwd, branch, rebasedSHA, originalSHA string) error {
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*gitLocalTimeout)
	defer cancel()
	currentSHA, err := mergeGateHeadSHA(cleanupCtx, cwd, "HEAD")
	if err != nil {
		return fmt.Errorf("check source after failed target update: %w", err)
	}
	status, err := runMergeGateGit(cleanupCtx, cwd, "status", "--porcelain=v1", "--untracked-files=all")
	if err != nil {
		return fmt.Errorf("check source edits after failed target update: %w", err)
	}
	if currentSHA != rebasedSHA || status != "" {
		return fmt.Errorf("source changed externally after rebase; leaving it at %s without discarding edits", rebasedSHA)
	}
	if err := compareAndSwapMergeGateRef(cleanupCtx, cwd, branch, originalSHA, rebasedSHA); err != nil {
		return fmt.Errorf("restore original source branch with compare-and-swap: %w", err)
	}
	if err := syncMergeGateCheckout(cleanupCtx, cwd, rebasedSHA, originalSHA); err != nil {
		return fmt.Errorf("restore original source checkout: %w", err)
	}
	return nil
}

func dryRunMergeLocked(ctx context.Context, opts DryRunOptions) (MergeDryRunResult, error) {
	result := MergeDryRunResult{TargetRef: opts.TargetRef, SourceRef: opts.SourceRef}
	for _, checkout := range []struct {
		name string
		cwd  string
		ref  string
	}{
		{name: "target", cwd: opts.TargetCwd, ref: opts.TargetRef},
		{name: "source", cwd: opts.SourceCwd, ref: opts.SourceRef},
	} {
		branch, err := runMergeGateGit(ctx, checkout.cwd, "symbolic-ref", "--quiet", "--short", "HEAD")
		if err != nil {
			return result, fmt.Errorf("%s checkout must have an attached branch: %w", checkout.name, err)
		}
		if strings.TrimSpace(branch) != checkout.ref {
			return result, fmt.Errorf("%s checkout is on %q, expected %q", checkout.name, strings.TrimSpace(branch), checkout.ref)
		}
	}

	var err error
	result.TargetSha, err = mergeGateHeadSHA(ctx, opts.TargetCwd, opts.TargetRef)
	if err != nil {
		return result, fmt.Errorf("resolve target ref: %w", err)
	}
	result.SourceSha, err = mergeGateHeadSHA(ctx, opts.SourceCwd, opts.SourceRef)
	if err != nil {
		return result, fmt.Errorf("resolve source ref: %w", err)
	}
	for _, checkout := range []struct{ cwd string }{
		{cwd: opts.TargetCwd},
		{cwd: opts.SourceCwd},
	} {
		status, statusErr := runMergeGateGit(ctx, checkout.cwd, "status", "--porcelain=v1", "--untracked-files=all")
		if statusErr != nil {
			return result, fmt.Errorf("check checkout cleanliness: %w", statusErr)
		}
		result.DirtyWorktree = result.DirtyWorktree || status != ""
	}

	ahead, err := runMergeGateGit(ctx, opts.TargetCwd, "rev-list", "--count", result.TargetSha+".."+result.SourceSha)
	if err != nil {
		return result, fmt.Errorf("count source commits: %w", err)
	}
	result.AheadCount, err = strconv.Atoi(strings.TrimSpace(ahead))
	if err != nil {
		return result, fmt.Errorf("parse source ahead count %q: %w", ahead, err)
	}
	if result.DirtyWorktree {
		result.CheckedAt = time.Now()
		return result, nil
	}

	output, mergeErr := runMergeGateGit(ctx, opts.TargetCwd, "merge-tree", "--write-tree", "--no-messages", "--name-only", "-z", result.TargetSha, result.SourceSha)
	if mergeErr == nil {
		result.Clean = true
		result.MergeTreeSha = mergeGateTreeSHA(output)
		result.CheckedAt = time.Now()
		return result, nil
	}
	var exitErr *exec.ExitError
	if errors.As(mergeErr, &exitErr) {
		switch exitErr.ExitCode() {
		case 1:
			result.MergeTreeSha, result.ConflictingFiles = parseMergeGateConflicts(output)
			result.CheckedAt = time.Now()
			return result, nil
		case 129: // Git < 2.38 has no merge-tree --write-tree mode.
			return dryRunMergeFallback(ctx, opts, result)
		}
	}
	return result, fmt.Errorf("dry-run merge: %w", mergeErr)
}

func dryRunMergeFallback(ctx context.Context, opts DryRunOptions, result MergeDryRunResult) (resultOut MergeDryRunResult, err error) {
	temporaryRoot, err := os.MkdirTemp("", "byspace-merge-gate-")
	if err != nil {
		return result, fmt.Errorf("create dry-run worktree parent: %w", err)
	}
	worktreePath := filepath.Join(temporaryRoot, "worktree")
	defer func() {
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*gitLocalTimeout)
		defer cancel()
		_, _ = runMergeGateGit(cleanupCtx, worktreePath, "merge", "--abort")
		_, removeErr := runMergeGateGit(cleanupCtx, opts.TargetCwd, "worktree", "remove", "--force", worktreePath)
		removeRootErr := os.RemoveAll(temporaryRoot)
		if cleanupErr := errors.Join(removeErr, removeRootErr); cleanupErr != nil {
			resultOut.Clean = false
			if err == nil {
				err = fmt.Errorf("clean up dry-run worktree: %w", cleanupErr)
			} else {
				err = errors.Join(err, fmt.Errorf("clean up dry-run worktree: %w", cleanupErr))
			}
		}
	}()

	if _, err = runMergeGateGit(ctx, opts.TargetCwd, "worktree", "add", "--detach", worktreePath, result.TargetSha); err != nil {
		return result, fmt.Errorf("create detached dry-run worktree: %w", err)
	}
	_, mergeErr := runMergeGateGit(ctx, worktreePath, "merge", "--no-commit", "--no-ff", result.SourceSha)
	if mergeErr == nil {
		treeSHA, writeErr := runMergeGateGit(ctx, worktreePath, "write-tree")
		if writeErr != nil {
			return result, fmt.Errorf("write fallback merge tree: %w", writeErr)
		}
		result.Clean = true
		result.MergeTreeSha = strings.TrimSpace(treeSHA)
		result.CheckedAt = time.Now()
		return result, nil
	}
	var exitErr *exec.ExitError
	if errors.As(mergeErr, &exitErr) && exitErr.ExitCode() == 1 {
		pathsOutput, diffErr := runMergeGateGit(ctx, worktreePath, "diff", "--name-only", "--diff-filter=U", "-z")
		if diffErr != nil {
			return result, fmt.Errorf("list fallback merge conflicts: %w", diffErr)
		}
		paths := parseMergeGateNULPaths(pathsOutput)
		if len(paths) == 0 {
			return result, fmt.Errorf("fallback merge failed without conflicts: %w", mergeErr)
		}
		result.ConflictingFiles = paths
		result.CheckedAt = time.Now()
		return result, nil
	}
	return result, fmt.Errorf("fallback dry-run merge: %w", mergeErr)
}

func parseMergeGateNULPaths(output string) []string {
	var paths []string
	for _, path := range strings.Split(output, "\x00") {
		if path != "" {
			paths = append(paths, path)
		}
	}
	sort.Strings(paths)
	return paths
}

func mergeGateHeadSHA(ctx context.Context, cwd, ref string) (string, error) {
	sha, err := runMergeGateGit(ctx, cwd, "rev-parse", "--verify", ref+"^{commit}")
	return strings.TrimSpace(sha), err
}

func mergeGateTreeSHA(output string) string {
	if end := strings.IndexByte(output, 0); end >= 0 {
		output = output[:end]
	}
	if end := strings.IndexByte(output, '\n'); end >= 0 {
		output = output[:end]
	}
	return strings.TrimSpace(output)
}

func parseMergeGateConflicts(output string) (string, []string) {
	parts := strings.Split(output, "\x00")
	treeSHA := mergeGateTreeSHA(output)
	if len(parts) == 1 {
		return treeSHA, nil
	}
	paths := make([]string, 0, len(parts)-1)
	for _, path := range parts[1:] {
		if path != "" {
			paths = append(paths, path)
		}
	}
	sort.Strings(paths)
	return treeSHA, paths
}

func sameMergeGatePath(a, b string) bool {
	a = filepath.Clean(a)
	b = filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

func lockMergeGateRepository(ctx context.Context, commonDir string) (func(), error) {
	key := commonDir
	if runtime.GOOS == "windows" {
		key = strings.ToLower(filepath.Clean(key))
	}
	value, _ := mergeGateRepositoryLocks.LoadOrStore(key, make(chan struct{}, 1))
	lock := value.(chan struct{})
	select {
	case lock <- struct{}{}:
		return func() { <-lock }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func runMergeGateGit(ctx context.Context, cwd string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, gitLocalTimeout)
	defer cancel()
	release, err := acquireGitSlot(ctx)
	if err != nil {
		return "", err
	}
	defer release()
	cmd := proc.CommandContext(ctx, "git", args...)
	cmd.Dir = cwd
	cmd.Env = gitEnv(cmd.Environ())
	output, err := cmd.CombinedOutput()
	if err != nil {
		if ctx.Err() != nil {
			return string(output), ctx.Err()
		}
		message := bytes.TrimSpace(output)
		if len(message) > 0 {
			return string(output), fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, message)
		}
		return string(output), fmt.Errorf("git %s: %w", strings.Join(args, " "), err)
	}
	return string(output), nil
}
