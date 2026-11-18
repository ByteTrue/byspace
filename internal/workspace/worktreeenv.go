package workspace

// WorktreeIdentityEnv is the identity overlay every workspace lifecycle process runs with:
// setup, teardown, scripts, and services. It tells a project-authored command which checkout it
// is in, which repository that checkout came from, and which branch it is on — so a setup command
// can copy machine-local state (like .env) from the source checkout without hardcoding a path.
// The contract is documented in byspace-project-setup's byspace-json.md ("Worktree environment").
//
// Values may be empty for a plain directory workspace with no source checkout or branch; the keys
// are still present so a command can test them uniformly rather than branching on existence.
func WorktreeIdentityEnv(sourceCheckoutPath, worktreePath, branch string) map[string]string {
	return map[string]string{
		"BYSPACE_SOURCE_CHECKOUT_PATH": sourceCheckoutPath,
		"BYSPACE_WORKTREE_PATH":        worktreePath,
		"BYSPACE_BRANCH_NAME":          branch,
	}
}
