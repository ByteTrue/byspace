package workspace

import (
	"context"
	"errors"
	"github.com/ByteTrue/byspace/internal/proc"
	"os/exec"
	"strings"
	"time"
)

// ForgeProbeTimeout bounds an auth probe.
//
// The CLI reaches the network; without a real deadline a slow forge makes the whole PR status request wait.
// Node uses the same value for CLI_AUTH_PROBE_TIMEOUT_MS.
const ForgeProbeTimeout = 10 * time.Second

// ForgeAuthState explains why a forge's features are (un)available.
//
// Ported from forge-service.ts. The five values replace a single boolean so the UI can offer the exact next
// step — install the CLI, or sign in — instead of one generic dead end.
//
// The distinction the boolean could not express: `cli_missing` means the tool is not installed, and telling
// that user to "sign in" sends them to a command that does not exist.
type ForgeAuthState string

// The five states.
const (
	ForgeAuthAuthenticated   ForgeAuthState = "authenticated"
	ForgeAuthUnauthenticated ForgeAuthState = "unauthenticated"
	// ForgeAuthCLIMissing is the forge's CLI not being installed.
	ForgeAuthCLIMissing ForgeAuthState = "cli_missing"
	// ForgeAuthNoRemote covers everything the feature does not apply to: no resolvable forge remote, or no
	// branch to look up. Not an error, and not something the user can sign in to fix.
	ForgeAuthNoRemote ForgeAuthState = "no_remote"
	// ForgeAuthError is a non-auth failure: the UI shows the actual error instead of setup guidance.
	ForgeAuthError ForgeAuthState = "error"
)

// ClassifyForgeAuth turns one probe into a state.
//
// The order is what makes the guidance correct: a missing binary is reported before anything that needs the
// binary to answer, and a run that fails for a reason other than auth is an error rather than "sign in".
func ClassifyForgeAuth(hasRemote bool, cliPath string, probeErr error, authenticated bool) ForgeAuthState {
	if !hasRemote {
		// Nothing to authenticate against. Reporting `unauthenticated` here sends the user to sign in to a
		// forge that is not involved.
		return ForgeAuthNoRemote
	}
	if strings.TrimSpace(cliPath) == "" {
		return ForgeAuthCLIMissing
	}
	if probeErr != nil {
		// A missing binary surfaces as an exec error too; LookPath is checked above so what remains is a
		// real failure.
		var execErr *exec.Error
		if errors.As(probeErr, &execErr) {
			return ForgeAuthCLIMissing
		}
		return ForgeAuthError
	}
	if !authenticated {
		return ForgeAuthUnauthenticated
	}
	return ForgeAuthAuthenticated
}

// ProbeForgeAuth determines a workspace's auth state.
//
// The binary is looked up before it is run: a missing CLI has to come back as `cli_missing`, and running it
// would produce an exec error that reads like any other failure.
func ProbeForgeAuth(cwd string, forge string) ForgeAuthState {
	binary, ok := forgeBinaryName(forge)
	if !ok {
		// An unknown forge has nothing to authenticate against, which is the same situation as no remote.
		return ForgeAuthNoRemote
	}
	// The remote is what a forge would be authenticated against; without one the feature does not apply.
	remoteURL := OriginRemoteURL(context.Background(), cwd)
	hasRemote := remoteURL != ""
	path, err := exec.LookPath(binary)
	if err != nil {
		path = ""
	}
	if !hasRemote {
		return ClassifyForgeAuth(false, path, nil, false)
	}
	if path == "" {
		return ClassifyForgeAuth(true, "", nil, false)
	}

	out, runErr := runForgeProbe(cwd, binary)
	if runErr != nil {
		return ClassifyForgeAuth(true, path, runErr, false)
	}
	return ClassifyForgeAuth(true, path, nil, out)
}

// forgeProbeDeadline is the deadline the probe actually uses. A variable so a test can shrink it rather than
// waiting out the real one.
var forgeProbeDeadline = ForgeProbeTimeout

// forgeBinaryName maps a forge to its CLI.
func forgeBinaryName(forge string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(forge)) {
	case "github":
		return "gh", true
	case "gitlab":
		return "glab", true
	case "gitea", "forgejo", "codeberg":
		return "tea", true
	case "":
		// No forge detected: nothing to authenticate against.
		return "", false
	}
	return "", false
}

// runForgeProbe asks the forge CLI whether it is signed in.
//
// The answer is the exit status rather than the output: `gh auth status` exits non-zero when signed out, and
// parsing its prose would break on an output change.
func runForgeProbe(cwd, binary string) (bool, error) {
	args := []string{"auth", "status"}
	if binary == "tea" {
		// tea has no `auth status`; `login list` exits non-zero when there is no stored login.
		args = []string{"login", "list"}
	}
	// A deadline, not just WaitDelay: WaitDelay only begins once the context is done or the process has
	// exited, so on its own it does not bound a command that never answers.
	ctx, cancel := context.WithTimeout(context.Background(), forgeProbeDeadline)
	defer cancel()

	cmd := proc.CommandContext(ctx, binary, args...)
	cmd.Dir = cwd
	// Covers the case the deadline cannot: the process exits but a child keeps its pipes open.
	cmd.WaitDelay = 2 * time.Second
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return false, ctx.Err()
		}
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			// A non-zero exit is "not signed in", which is a state, not a failure.
			return false, nil
		}
		return false, err
	}
	return true, nil
}
