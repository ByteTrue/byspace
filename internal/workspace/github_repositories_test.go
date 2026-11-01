package workspace

import "testing"

// The rows must be GithubRepositorySchema's, or the client drops the whole search response.
func TestParseGitHubRepositoriesBuildsWireRows(t *testing.T) {
	list := `[{"id":"R_kgDOA1","name":"byspace","nameWithOwner":"ByteTrue/byspace","description":null,"isPrivate":true,"updatedAt":"2026-11-01T00:00:00Z","sshUrl":"git@github.com:ByteTrue/byspace.git","url":"https://github.com/ByteTrue/byspace"}]`
	rows, err := parseGitHubRepositories(list, true, "https")
	if err != nil {
		t.Fatal(err)
	}
	got := rows[0]
	if got.ID != "R_kgDOA1" || got.NameWithOwner != "ByteTrue/byspace" || got.Visibility != "private" ||
		got.Description != nil || got.CloneURL != "https://github.com/ByteTrue/byspace" {
		t.Fatalf("list row %+v", got)
	}
	rows, _ = parseGitHubRepositories(list, true, "ssh")
	if rows[0].CloneURL != "git@github.com:ByteTrue/byspace.git" {
		t.Fatalf("ssh list clone url %q", rows[0].CloneURL)
	}

	search := `[{"id":123,"name":"cli","fullName":"cli/cli","description":"GitHub's CLI","isPrivate":false,"updatedAt":"2026-10-01T00:00:00Z","url":"https://github.com/cli/cli"}]`
	rows, err = parseGitHubRepositories(search, false, "ssh")
	if err != nil {
		t.Fatal(err)
	}
	got = rows[0]
	if got.ID != "123" || got.NameWithOwner != "cli/cli" || got.Visibility != "public" ||
		got.Description == nil || *got.Description != "GitHub's CLI" || got.CloneURL != "git@github.com:cli/cli.git" {
		t.Fatalf("search row %+v", got)
	}

	if rows, err := parseGitHubRepositories("", true, "https"); err != nil || len(rows) != 0 {
		t.Fatalf("empty output should be no rows: %v %v", rows, err)
	}
	if _, err := parseGitHubRepositories(`[{"id":"R_1","name":"x","fullName":"x","isPrivate":false,"updatedAt":"","url":"u"}]`, false, "https"); err == nil {
		t.Fatal("a repository without an owner should fail the search, as in Node")
	}
	if _, err := parseGitHubRepositories(`not json`, true, "https"); err == nil {
		t.Fatal("invalid JSON should fail the search")
	}
}

func TestGitHubAuthFailureText(t *testing.T) {
	for _, text := range []string{
		"To get started with GitHub CLI, please run:  gh auth login",
		"You are not logged into any GitHub hosts.",
		"HTTP 401: Bad credentials (https://api.github.com/graphql)",
	} {
		if !isGitHubAuthFailureText(text) {
			t.Fatalf("expected an auth failure: %q", text)
		}
	}
	if isGitHubAuthFailureText("HTTP 422: Validation Failed") {
		t.Fatal("a validation error is not an auth failure")
	}
}
