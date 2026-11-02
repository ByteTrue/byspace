package workspace

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/proc"
)

// GitHub Enterprise routing, ported from the archived Node daemon's github-service.ts
// (resolveGitHubEnterpriseHost, resolveRepoHostCached and run) and utils/ssh-hostname.ts.
//
// `gh pr` commands find the host from the repository's remotes, but `gh api` and `gh api graphql`
// always talk to github.com unless GH_HOST says otherwise. On a GitHub Enterprise checkout that
// silently queried the wrong server. Every gh call made for a checkout therefore carries GH_HOST
// when the checkout's origin is an Enterprise host, and an SSH alias (Host github-work → HostName
// ghe.acme.com) is resolved first so gh is pointed at the real host, not the alias.

// remoteLocation is a parsed origin remote: Node's parseGitRemoteLocation.
type remoteLocation struct {
	transport string // "scp" | "ssh" | "http" | "https"
	host      string
	path      string // without surrounding slashes or a trailing .git
}

// normalizeRemotePath is Node's: surrounding slashes and a trailing .git go.
func normalizeRemotePath(path string) string {
	normalized := strings.Trim(strings.TrimSpace(path), "/")
	normalized = strings.TrimSuffix(normalized, ".git")
	return normalized
}

var (
	scpRemotePattern = regexp.MustCompile(`^[^@]+@([^:]+):(.+)$`)
	validHostPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$`)
)

func normalizeRemoteHost(host string) string {
	return strings.ToLower(strings.TrimRight(strings.TrimSpace(host), "."))
}

// parseRemoteLocation reads `user@host:path` (scp) or an http(s)/ssh URL. Anything else (a local
// path, `host:path` without a user, git://) has no forge host.
func parseRemoteLocation(remote string) (remoteLocation, bool) {
	trimmed := strings.TrimSpace(remote)
	if trimmed == "" {
		return remoteLocation{}, false
	}
	if !strings.Contains(trimmed, "://") {
		match := scpRemotePattern.FindStringSubmatch(trimmed)
		if match == nil {
			return remoteLocation{}, false
		}
		host := normalizeRemoteHost(match[1])
		path := normalizeRemotePath(match[2])
		if !validHostPattern.MatchString(host) || path == "" {
			return remoteLocation{}, false
		}
		return remoteLocation{transport: "scp", host: host, path: path}, true
	}
	scheme, rest, _ := strings.Cut(trimmed, "://")
	transport := strings.ToLower(scheme)
	if transport != "https" && transport != "http" && transport != "ssh" {
		return remoteLocation{}, false
	}
	authority, rawPath, _ := strings.Cut(rest, "/")
	if at := strings.LastIndex(authority, "@"); at >= 0 {
		authority = authority[at+1:]
	}
	if colon := strings.LastIndex(authority, ":"); colon >= 0 {
		authority = authority[:colon]
	}
	host := normalizeRemoteHost(authority)
	if !validHostPattern.MatchString(host) {
		return remoteLocation{}, false
	}
	rawPath, _, _ = strings.Cut(rawPath, "?")
	rawPath, _, _ = strings.Cut(rawPath, "#")
	return remoteLocation{transport: transport, host: host, path: normalizeRemotePath(rawPath)}, true
}

func isGitHubCloudHost(host string) bool {
	return forgeCloudHosts[host] == "github"
}

// sshHostnames caches resolved aliases for the daemon's lifetime, failures included, as Node does.
var sshHostnames sync.Map // host → resolved host ("" when it did not resolve)

// lookupSSHHostname is `ssh -G`; a variable so tests can stand in for ssh.
var lookupSSHHostname = func(ctx context.Context, host string) string {
	sshPath, err := exec.LookPath("ssh")
	if err != nil {
		return ""
	}
	cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := proc.CommandContext(cctx, sshPath, "-G", host)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return parseSSHHostname(string(out))
}

// parseSSHHostname reads the `hostname` line of `ssh -G` output.
func parseSSHHostname(output string) string {
	for _, line := range strings.Split(output, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 || !strings.EqualFold(fields[0], "hostname") {
			continue
		}
		if host := normalizeRemoteHost(fields[1]); host != "" {
			return host
		}
	}
	return ""
}

// resolveSSHHostname resolves an SSH host alias to its configured HostName. A host that is not an
// alias resolves to itself; "" means ssh could not answer.
func resolveSSHHostname(ctx context.Context, host string) string {
	host = normalizeRemoteHost(host)
	if host == "" {
		return ""
	}
	if cached, ok := sshHostnames.Load(host); ok {
		return cached.(string)
	}
	resolved := lookupSSHHostname(ctx, host)
	sshHostnames.Store(host, resolved)
	return resolved
}

// resolvedRemoteHost is the origin's host with an SSH alias resolved.
func resolvedRemoteHost(ctx context.Context, location remoteLocation) string {
	host := location.host
	if !isGitHubCloudHost(host) && (location.transport == "scp" || location.transport == "ssh") {
		if resolved := resolveSSHHostname(ctx, host); resolved != "" {
			host = resolved
		}
	}
	return host
}

// errGitHubHostUnauthenticated reports an Enterprise host gh is not signed in to. It must not fall
// back to "no host": gh would then default to github.com and query the wrong server.
type errGitHubHostUnauthenticated struct{ host string }

func (e errGitHubHostUnauthenticated) Error() string {
	return "GitHub CLI is not authenticated for host " + e.host
}

// probeGitHubHostAuth is `gh auth status --hostname <host>`; a variable so tests can stand in for gh.
var probeGitHubHostAuth = func(ctx context.Context, host string) (bool, error) {
	_, stderr, err := runForgeCommand(ctx, ForgeProbeTimeout, "gh", "", ghProbeEnv(), "auth", "status", "--hostname", host)
	if err == nil {
		return true, nil
	}
	if isGitHubAuthFailureText(stderr) || isGitHubAuthFailureText(err.Error()) || strings.Contains(strings.ToLower(stderr), "not logged in") {
		return false, nil
	}
	var notFound *exec.Error
	if errors.As(err, &notFound) {
		return false, &GitHubCLIError{Kind: GitHubCLIMissing, message: "GitHub CLI (gh) is not installed or not in PATH"}
	}
	return false, err
}

// gitHubEnterpriseHostForRemote is the host gh must be routed to for a checkout with this origin:
// "" for github.com (gh defaults there) or a remote with no forge host.
func gitHubEnterpriseHostForRemote(ctx context.Context, remote string) (string, error) {
	location, ok := parseRemoteLocation(remote)
	if !ok {
		return "", nil
	}
	host := resolvedRemoteHost(ctx, location)
	if isGitHubCloudHost(host) {
		return "", nil
	}
	authenticated, err := probeGitHubHostAuth(ctx, host)
	if err != nil {
		return "", err
	}
	if !authenticated {
		return "", errGitHubHostUnauthenticated{host: host}
	}
	return host, nil
}

type repoHostEntry struct {
	host      string
	expiresAt time.Time // zero: kept until the origin changes
}

// repoHosts caches the routing host per checkout and origin URL, so a remote changed from a
// terminal is picked up on the next call. A found host is kept; "no host" is re-checked after a
// minute (Node's REPO_HOST_NULL_TTL_MS), so a gh login made later takes effect; errors are not kept.
var repoHosts sync.Map // cwd + "\x00" + origin → repoHostEntry

const repoHostNullTTL = time.Minute

// gitHubRoutingHost is the GH_HOST a gh call made for cwd needs, or "".
func gitHubRoutingHost(ctx context.Context, cwd string) (string, error) {
	remote := OriginRemoteURL(ctx, cwd)
	if remote == "" {
		return "", nil
	}
	key := cwd + "\x00" + remote
	if cached, ok := repoHosts.Load(key); ok {
		entry := cached.(repoHostEntry)
		if entry.expiresAt.IsZero() || time.Now().Before(entry.expiresAt) {
			return entry.host, nil
		}
	}
	host, err := gitHubEnterpriseHostForRemote(ctx, remote)
	if err != nil {
		repoHosts.Delete(key)
		return "", err
	}
	entry := repoHostEntry{host: host}
	if host == "" {
		entry.expiresAt = time.Now().Add(repoHostNullTTL)
	}
	repoHosts.Store(key, entry)
	return host, nil
}

// ghProbeEnv keeps gh from prompting while it answers a probe.
func ghProbeEnv() []string {
	return append(os.Environ(), "GH_PROMPT_DISABLED=1")
}
