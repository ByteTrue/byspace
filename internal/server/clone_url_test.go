package server

import "testing"

// `owner/repo` has no scheme; without the protocol it cannot become a URL, and the shorthand
// used to be passed to git verbatim (which cannot clone it).
func TestResolveCloneURL(t *testing.T) {
	https, err := resolveCloneURL("ByteTrue/BySpace", "https")
	if err != nil || https != "https://github.com/ByteTrue/BySpace.git" {
		t.Fatalf("https: %q %v", https, err)
	}
	ssh, err := resolveCloneURL("ByteTrue/BySpace.git", "ssh")
	if err != nil || ssh != "git@github.com:ByteTrue/BySpace.git" {
		t.Fatalf("ssh: %q %v", ssh, err)
	}
	// A full URL is already complete: the protocol must not rewrite it.
	full, err := resolveCloneURL("https://gitlab.com/team/repo.git", "ssh")
	if err != nil || full != "https://gitlab.com/team/repo.git" {
		t.Fatalf("full url: %q %v", full, err)
	}
}

// The value is interpolated into a URL handed to git, so the segments are validated.
func TestResolveCloneURLRejectsBadInput(t *testing.T) {
	bad := []struct{ repo, protocol string }{
		{"", "https"},
		{"owner", "https"},
		{"a/b/c", "https"},
		{"ow ner/repo", "https"},
		{"owner/re po", "https"},
		{"owner/repo", ""}, // shorthand without a protocol is ambiguous
	}
	for _, tc := range bad {
		if _, err := resolveCloneURL(tc.repo, tc.protocol); err == nil {
			t.Fatalf("resolveCloneURL(%q, %q) should have failed", tc.repo, tc.protocol)
		}
	}
}
