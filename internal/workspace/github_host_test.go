package workspace

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
)

func TestParseRemoteLocation(t *testing.T) {
	cases := map[string]remoteLocation{
		"git@github.com:org/repo.git":            {transport: "scp", host: "github.com", path: "org/repo"},
		"git@Work-Alias:org/repo":                {transport: "scp", host: "work-alias", path: "org/repo"},
		"ssh://git@ghe.acme.com:2222/org/repo":   {transport: "ssh", host: "ghe.acme.com", path: "org/repo"},
		"https://GHE.acme.com./org/repo.git":     {transport: "https", host: "ghe.acme.com", path: "org/repo"},
		"http://user:pw@git.example.com/a/b":     {transport: "http", host: "git.example.com", path: "a/b"},
		"https://github.com/ByteTrue/byspace/":   {transport: "https", host: "github.com", path: "ByteTrue/byspace"},
		"ssh://git@github-work/ByteTrue/byspace": {transport: "ssh", host: "github-work", path: "ByteTrue/byspace"},
	}
	for remote, want := range cases {
		got, ok := parseRemoteLocation(remote)
		if !ok || got != want {
			t.Fatalf("parseRemoteLocation(%q) = %+v %v, want %+v", remote, got, ok, want)
		}
	}
	for _, remote := range []string{"", "/srv/repo.git", "host:path", "git://host/repo", "file:///srv/repo", "git@host:"} {
		if got, ok := parseRemoteLocation(remote); ok {
			t.Fatalf("parseRemoteLocation(%q) = %+v, want no forge host", remote, got)
		}
	}
}

func TestParseSSHHostname(t *testing.T) {
	output := "user git\nhostname GHE.Acme.com\nport 22\n"
	if got := parseSSHHostname(output); got != "ghe.acme.com" {
		t.Fatalf("parseSSHHostname = %q", got)
	}
	if got := parseSSHHostname("user git\n"); got != "" {
		t.Fatalf("no hostname line = %q", got)
	}
}

// stubForgeLookups replaces ssh -G and the gh auth probe for one test.
func stubForgeLookups(t *testing.T, aliases map[string]string, authed map[string]bool) *[]string {
	t.Helper()
	var mu sync.Mutex
	probed := []string{}
	prevLookup, prevProbe := lookupSSHHostname, probeGitHubHostAuth
	lookupSSHHostname = func(_ context.Context, host string) string {
		if resolved, ok := aliases[host]; ok {
			return resolved
		}
		return host
	}
	probeGitHubHostAuth = func(_ context.Context, host string) (bool, error) {
		mu.Lock()
		probed = append(probed, host)
		mu.Unlock()
		return authed[host], nil
	}
	sshHostnames.Range(func(key, _ any) bool { sshHostnames.Delete(key); return true })
	repoHosts.Range(func(key, _ any) bool { repoHosts.Delete(key); return true })
	t.Cleanup(func() {
		lookupSSHHostname, probeGitHubHostAuth = prevLookup, prevProbe
		sshHostnames.Range(func(key, _ any) bool { sshHostnames.Delete(key); return true })
		repoHosts.Range(func(key, _ any) bool { repoHosts.Delete(key); return true })
	})
	return &probed
}

func gitRepoWithOrigin(t *testing.T, origin string) string {
	t.Helper()
	dir := t.TempDir()
	for _, args := range [][]string{{"init", "-q"}, {"remote", "add", "origin", origin}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
	return dir
}

// gh is routed to the checkout's Enterprise host, through an SSH alias when there is one; github.com
// needs no GH_HOST; a host gh is not signed in to is an authentication error, never github.com.
func TestGitHubRoutingHost(t *testing.T) {
	probed := stubForgeLookups(t,
		map[string]string{"github-work": "ghe.acme.com", "github-personal": "github.com"},
		map[string]bool{"ghe.acme.com": true},
	)
	ctx := context.Background()

	for origin, want := range map[string]string{
		"git@github.com:org/repo.git":       "",
		"git@github-personal:org/repo.git":  "",
		"https://ghe.acme.com/org/repo.git": "ghe.acme.com",
		"git@github-work:org/repo.git":      "ghe.acme.com",
		"ssh://git@github-work:22/org/repo": "ghe.acme.com",
		"/srv/mirrors/repo.git":             "",
	} {
		host, err := gitHubRoutingHost(ctx, gitRepoWithOrigin(t, origin))
		if err != nil || host != want {
			t.Fatalf("origin %s: host %q err %v, want %q", origin, host, err, want)
		}
	}

	_, err := gitHubRoutingHost(ctx, gitRepoWithOrigin(t, "https://other.acme.com/org/repo"))
	var unauthenticated errGitHubHostUnauthenticated
	if !errors.As(err, &unauthenticated) || !isGitHubAuthFailureText(err.Error()) && !strings.Contains(err.Error(), "not authenticated for host other.acme.com") {
		t.Fatalf("unauthenticated host err = %v", err)
	}

	// A found host is cached per checkout: no second probe.
	repo := gitRepoWithOrigin(t, "https://ghe.acme.com/org/other.git")
	before := len(*probed)
	for i := 0; i < 3; i++ {
		if host, _ := gitHubRoutingHost(ctx, repo); host != "ghe.acme.com" {
			t.Fatalf("cached host = %q", host)
		}
	}
	if len(*probed) != before+1 {
		t.Fatalf("probes = %d, want one more than %d", len(*probed), before)
	}
}

// An SSH alias to a self-hosted forge is classified by its real host.
func TestDetectForgeResolvesSSHAliases(t *testing.T) {
	stubForgeLookups(t, map[string]string{"work": "gitlab.example.com", "personal": "github.com"}, nil)
	ctx := context.Background()
	for origin, want := range map[string]string{
		"git@work:org/repo.git":                "gitlab",
		"git@personal:org/repo.git":            "github",
		"git@codeberg.org:org/repo.git":        "gitea",
		"https://gitlab.com/org/repo.git":      "gitlab",
		"https://git.unknown.example/org/repo": "github",
	} {
		if got := DetectForge(ctx, gitRepoWithOrigin(t, origin)); got != want {
			t.Fatalf("DetectForge(%s) = %q, want %q", origin, got, want)
		}
	}
}

// gh runs with GH_HOST set to the checkout's Enterprise host.
func TestRunGHCarriesGHHost(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses a shell script as gh")
	}
	stubForgeLookups(t, nil, map[string]bool{"ghe.acme.com": true})
	bin := t.TempDir()
	script := "#!/bin/sh\necho \"GH_HOST=${GH_HOST:-none}\"\n"
	if err := os.WriteFile(filepath.Join(bin, "gh"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	ctx := context.Background()

	out, err := runGH(ctx, gitRepoWithOrigin(t, "https://ghe.acme.com/org/repo.git"), "api", "graphql")
	if err != nil || out != "GH_HOST=ghe.acme.com" {
		t.Fatalf("Enterprise checkout: %q %v", out, err)
	}
	out, err = runGH(ctx, gitRepoWithOrigin(t, "git@github.com:org/repo.git"), "api", "graphql")
	if err != nil || out != "GH_HOST=none" {
		t.Fatalf("github.com checkout: %q %v", out, err)
	}
}
