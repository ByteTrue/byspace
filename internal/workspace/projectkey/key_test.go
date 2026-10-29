package projectkey

import "testing"

// The key exists so two checkouts of one remote on different hosts collapse into one group.
// Deriving it from the local path made that impossible — the sidebar showed two projects.
func TestDeriveJoinsSameRemoteAcrossHosts(t *testing.T) {
	a := Derive("/home/alice/src/byspace", "git@github.com:ByteTrue/BySpace.git", "", "", "srv_a")
	b := Derive("/Users/bob/work/byspace", "https://github.com/bytetrue/byspace", "", "", "srv_b")
	if a != b {
		t.Fatalf("same remote derived different keys:\n  %q\n  %q", a, b)
	}
	if a != "remote:github.com/bytetrue/byspace" {
		t.Fatalf("unexpected remote key %q", a)
	}
}

// GitHub paths are case-insensitive, so casing must not split a group.
func TestDeriveLowercasesGitHubPaths(t *testing.T) {
	got := Derive("/x", "https://github.com/ByteTrue/Scary-Dragonfly", "", "", "")
	if got != "remote:github.com/bytetrue/scary-dragonfly" {
		t.Fatalf("expected lowercased GitHub path, got %q", got)
	}
}

// A self-hosted forge keeps its case: two repos differing only by case are different repos.
func TestDerivePreservesCaseOnSelfHosted(t *testing.T) {
	got := Derive("/x", "https://git.example.com/Team/Repo", "", "", "")
	if got != "remote:git.example.com/Team/Repo" {
		t.Fatalf("expected case preserved, got %q", got)
	}
}

// A non-default port is part of the identity; the default one is not.
func TestDeriveKeepsOnlyNonDefaultPorts(t *testing.T) {
	withPort := Derive("/x", "https://git.example.com:60443/team/repo", "", "", "")
	if withPort != "remote:git.example.com:60443/team/repo" {
		t.Fatalf("expected port in key, got %q", withPort)
	}
	withoutPort := Derive("/x", "https://git.example.com/team/repo", "", "", "")
	if withoutPort != "remote:git.example.com/team/repo" {
		t.Fatalf("default port must not appear, got %q", withoutPort)
	}
}

// A subdirectory selection of the same remote is a different project.
func TestDeriveAddsSubdirSuffix(t *testing.T) {
	got := Derive("/x/workspace/packages/app", "https://github.com/o/r", "/x/workspace", "", "")
	if got != "remote:github.com/o/r#subdir:packages/app" {
		t.Fatalf("expected subdir suffix, got %q", got)
	}
}

// Without a remote the key falls back to the local path, scoped by host so two machines' local
// projects never collide.
func TestDeriveFallsBackToHostScopedPath(t *testing.T) {
	got := Derive("/home/alice/work/thing", "", "", "", "srv_a")
	want := "host:srv_a:/home/alice/work/thing"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestParseRemoteForms(t *testing.T) {
	cases := map[string]Remote{
		"git@github.com:owner/repo.git":           {Transport: "scp", Host: "github.com", Path: "owner/repo"},
		"https://github.com/owner/repo.git":       {Transport: "https", Host: "github.com", Path: "owner/repo"},
		"ssh://git@github.com/owner/repo.git":     {Transport: "ssh", Host: "github.com", Path: "owner/repo"},
		"https://git.example.com:60443/team/repo": {Transport: "https", Host: "git.example.com", Port: "60443", Path: "team/repo"},
		"https://git.example.com:443/team/repo":   {Transport: "https", Host: "git.example.com", Path: "team/repo"},
	}
	for input, want := range cases {
		got, ok := ParseRemote(input)
		if !ok {
			t.Fatalf("%q did not parse", input)
		}
		if got != want {
			t.Fatalf("%q -> %+v, want %+v", input, got, want)
		}
	}
	for _, bad := range []string{"", "not a url", "ftp://x/y", "owner/repo"} {
		if _, ok := ParseRemote(bad); ok {
			t.Fatalf("%q should not parse as a remote", bad)
		}
	}
}

func TestGroupingDisplayName(t *testing.T) {
	// The display name is for humans, so it keeps the remote's own casing.
	if got := GroupingDisplayName("/x", "git@github.com:ByteTrue/BySpace.git", ""); got != "ByteTrue/BySpace" {
		t.Fatalf("got %q", got)
	}
	if got := GroupingDisplayName("/x/thing", "", ""); got != "thing" {
		t.Fatalf("got %q", got)
	}
}
