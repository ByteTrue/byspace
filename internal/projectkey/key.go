// Package projectkey ports packages/protocol/src/git-remote.ts (parse only) and
// archive/packages/server/src/server/project-key.ts.
//
// The key is the persisted identity the sidebar groups on: two checkouts of the same remote on
// two different hosts must derive the same key so they collapse into one project group. Deriving
// it from the local path instead makes cross-host grouping impossible.
package projectkey

import (
	"net/url"
	"path/filepath"
	"strings"
)

// Remote is a parsed git remote location.
type Remote struct {
	Transport string // scp | ssh | http | https
	Host      string
	Port      string
	Path      string
}

var githubHosts = map[string]bool{
	"github.com":     true,
	"www.github.com": true,
	"ssh.github.com": true,
}

var transportByScheme = map[string]string{
	"https": "https",
	"http":  "http",
	"ssh":   "ssh",
}

var defaultPortByScheme = map[string]string{
	"https": "443",
	"http":  "80",
	"ssh":   "22",
}

// IsGitHubHost reports whether host belongs to GitHub's cloud.
func IsGitHubHost(host string) bool {
	return githubHosts[strings.ToLower(host)]
}

// ParseRemote parses a git remote URL in scp-like or URL form.
//
// The scp form is tested first when there is no "://": testing it after would let
// `[^@]+` swallow `ssh://git` and fold the port into the path.
func ParseRemote(remoteURL string) (Remote, bool) {
	trimmed := strings.TrimSpace(remoteURL)
	if trimmed == "" {
		return Remote{}, false
	}

	if !strings.Contains(trimmed, "://") {
		at := strings.Index(trimmed, "@")
		if at > 0 {
			rest := trimmed[at+1:]
			if colon := strings.Index(rest, ":"); colon > 0 {
				host := normalizeHost(rest[:colon])
				path := normalizeRemotePath(rest[colon+1:])
				if validRemoteHost(host) && path != "" {
					return Remote{Transport: "scp", Host: host, Path: path}, true
				}
			}
		}
	}

	parsed, err := url.Parse(trimmed)
	if err != nil {
		return Remote{}, false
	}
	scheme := strings.ToLower(strings.TrimSuffix(parsed.Scheme, ":"))
	transport, ok := transportByScheme[scheme]
	if !ok {
		return Remote{}, false
	}
	host := normalizeHost(parsed.Hostname())
	path := normalizeRemotePath(parsed.Path)
	if !validRemoteHost(host) || path == "" {
		return Remote{}, false
	}
	port := parsed.Port()
	if port == defaultPortByScheme[scheme] {
		port = ""
	}
	return Remote{Transport: transport, Host: host, Port: port, Path: path}, true
}

func normalizeHost(host string) string {
	h := strings.ToLower(strings.TrimSpace(host))
	h = strings.TrimPrefix(h, "[")
	h = strings.TrimSuffix(h, "]")
	return h
}

func normalizeRemotePath(path string) string {
	trimmed := strings.TrimSpace(path)
	trimmed = strings.ReplaceAll(trimmed, "\\", "/")
	for strings.HasPrefix(trimmed, "/") {
		trimmed = trimmed[1:]
	}
	trimmed = strings.TrimSuffix(trimmed, "/")
	trimmed = strings.TrimSuffix(trimmed, ".git")
	return trimmed
}

func validRemoteHost(host string) bool {
	if host == "" {
		return false
	}
	return !strings.ContainsAny(host, " \t/")
}

// Derive builds the persisted opaque key used to join the same remote across hosts.
func Derive(rootPath, remoteURL, worktreeRoot, mainRepoRoot, serverID string) string {
	var remote Remote
	hasRemote := false
	if strings.TrimSpace(remoteURL) != "" {
		remote, hasRemote = ParseRemote(remoteURL)
	}

	// The two paths arrive from different sources (a caller-supplied project path and
	// `git rev-parse --show-toplevel`), so one may be symlink-resolved and the other not.
	// Comparing them unresolved makes /tmp/x/sub look unrelated to /private/tmp/x.
	resolvedRoot := resolveSymlinks(rootPath)
	resolvedRepo := resolveSymlinks(worktreeRoot)
	var selectedPath string
	if resolvedRepo != "" && isInside(resolvedRepo, resolvedRoot) {
		rel, err := filepath.Rel(resolvedRepo, resolvedRoot)
		if err == nil && rel != "." && !strings.HasPrefix(rel, "..") {
			selectedPath = rel
		}
	}

	if hasRemote {
		host := remote.Host
		if remote.Port != "" {
			host = host + ":" + remote.Port
		}
		path := remote.Path
		if IsGitHubHost(remote.Host) {
			path = strings.ToLower(path)
		}
		remoteKey := "remote:" + host + "/" + path
		if selectedPath != "" {
			return remoteKey + "#subdir:" + strings.ReplaceAll(selectedPath, "\\", "/")
		}
		return remoteKey
	}

	base := rootPath
	if selectedPath != "" && mainRepoRoot != "" {
		base = filepath.Join(mainRepoRoot, selectedPath)
	}
	normalized := normalizePathForIdentity(base)
	if serverID != "" {
		return "host:" + serverID + ":" + normalized
	}
	return normalized
}

// GroupingDisplayName is the label shown for a grouped project.
func GroupingDisplayName(rootPath, remoteURL, worktreeRoot string) string {
	if worktreeRoot != "" && isInside(worktreeRoot, rootPath) {
		return lastSegment(rootPath)
	}
	remote, ok := ParseRemote(remoteURL)
	if !ok {
		return lastSegment(rootPath)
	}
	segments := nonEmpty(strings.Split(remote.Path, "/"))
	if len(segments) == 0 {
		return rootPath
	}
	if len(segments) > 2 {
		segments = segments[len(segments)-2:]
	}
	return strings.Join(segments, "/")
}

func isInside(root, candidate string) bool {
	rel, err := filepath.Rel(root, candidate)
	if err != nil {
		return false
	}
	return rel == "." || (!strings.HasPrefix(rel, ".."+string(filepath.Separator)) && rel != "..")
}

func normalizePathForIdentity(path string) string {
	cleaned := filepath.ToSlash(filepath.Clean(path))
	return strings.ToLower(cleaned)
}

func lastSegment(path string) string {
	segments := nonEmpty(strings.FieldsFunc(path, func(r rune) bool { return r == '/' || r == '\\' }))
	if len(segments) == 0 {
		return path
	}
	return segments[len(segments)-1]
}

func nonEmpty(parts []string) []string {
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

// resolveSymlinks returns the canonical path, or "" when it cannot be resolved.
func resolveSymlinks(path string) string {
	if path == "" {
		return ""
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return path
	}
	return resolved
}
