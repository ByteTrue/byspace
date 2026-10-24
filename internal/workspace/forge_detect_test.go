package workspace

import "testing"

// Matching on substrings means a GitHub repository called `gitlab-mirror` is detected as GitLab,
// and every gh call for it is then run through glab.
func TestForgeForRemoteUsesExactHosts(t *testing.T) {
	cases := map[string]string{
		"https://github.com/acme/gitlab-mirror.git": "github",
		"https://github.com/acme/gitea-tools":       "github",
		"git@github.com:acme/repo.git":              "github",
		"ssh://git@github.com:22/acme/repo.git":     "github",
		"https://gitlab.com/acme/github-sync.git":   "gitlab",
		"git@gitlab.com:acme/repo.git":              "gitlab",
		"https://codeberg.org/acme/repo.git":        "gitea",
		"https://gitea.com/acme/repo.git":           "gitea",
		"https://ssh.github.com/acme/repo.git":      "github",
	}
	for remote, want := range cases {
		if got := ForgeForRemote(remote); got != want {
			t.Fatalf("ForgeForRemote(%q) = %q, want %q", remote, got, want)
		}
	}
}

// Self-hosted hosts have no fixed list; the common naming is checked on the host only.
func TestForgeForRemoteSelfHosted(t *testing.T) {
	cases := map[string]string{
		"https://gitlab.mycompany.com/team/repo.git": "gitlab",
		"git@git.internal.corp:team/repo.git":        "github", // no hint: defaults to github
		"https://gitea.internal/team/repo.git":       "gitea",
		"https://forgejo.example.org/team/repo.git":  "gitea",
	}
	for remote, want := range cases {
		if got := ForgeForRemote(remote); got != want {
			t.Fatalf("ForgeForRemote(%q) = %q, want %q", remote, got, want)
		}
	}
}

func TestRemoteHost(t *testing.T) {
	cases := map[string]string{
		"https://github.com/a/b":            "github.com",
		"https://user:pass@Host.COM:8443/x": "host.com",
		"ssh://git@gitlab.com:2222/a/b":     "gitlab.com",
		"git@github.com:acme/repo.git":      "github.com",
		"gitlab.com:acme/repo":              "gitlab.com",
		"/local/path/repo":                  "",
		"./relative/repo":                   "",
		"C:\\repo":                          "",
		"":                                  "",
	}
	for remote, want := range cases {
		if got := remoteHost(remote); got != want {
			t.Fatalf("remoteHost(%q) = %q, want %q", remote, got, want)
		}
	}
}
