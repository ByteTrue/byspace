package workspace

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// searchRepo is a git repository whose origin is the given remote, with a stub `gh` on PATH that
// answers `pr list` and `issue list` from the given scripts (shell snippets) and records its args.
func searchRepo(t *testing.T, remote, prList, issueList string) (repo, argsFile string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("stub uses a shell script")
	}
	dir := t.TempDir()
	repo = filepath.Join(dir, "repo")
	if err := os.MkdirAll(repo, 0o755); err != nil {
		t.Fatal(err)
	}
	runGitTest(t, repo, "init", "-q")
	runGitTest(t, repo, "remote", "add", "origin", remote)
	argsFile = filepath.Join(dir, "args")
	script := "#!/bin/sh\necho \"$@\" >> " + argsFile + "\ncase \"$1 $2\" in\n" +
		"  'pr list') " + prList + " ;;\n" +
		"  'issue list') " + issueList + " ;;\n" +
		"esac\n"
	bin := filepath.Join(dir, "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bin, "gh"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	return repo, argsFile
}

// No results is an empty list on the wire. A nil slice marshalled to null, the client rejected
// forge.search.response, and the starting-ref picker on New workspace showed no pull requests.
func TestSearchIssuesAndPullRequestsEmptyIsAList(t *testing.T) {
	repo, _ := searchRepo(t, "https://github.com/acme/repo.git", "echo '[]'", "echo '[]'")
	items, err := SearchIssuesAndPullRequests(t.Context(), repo, "", 20, []string{"change_request"})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(items)
	if string(raw) != "[]" {
		t.Fatalf("items = %s, want []", raw)
	}
}

// As in Node, the two lists are independent: one failing leaves the other's rows, and the search
// fails only when every requested list failed.
func TestSearchIssuesAndPullRequestsPartialResults(t *testing.T) {
	issue := `echo '[{"number":3,"title":"bug","url":"https://github.com/acme/repo/issues/3","state":"OPEN","body":"","labels":[],"updatedAt":"2026-01-01T00:00:00Z"}]'`
	repo, _ := searchRepo(t, "https://github.com/acme/repo.git", "echo boom >&2; exit 1", issue)
	items, err := SearchIssuesAndPullRequests(t.Context(), repo, "", 20, nil)
	if err != nil {
		t.Fatalf("a failed PR list must not hide the issues: %v", err)
	}
	if len(items) != 1 || items[0].Kind != "issue" || items[0].Number != 3 {
		t.Fatalf("items = %+v", items)
	}

	repo, _ = searchRepo(t, "https://github.com/acme/repo.git", "exit 1", "exit 1")
	if _, err := SearchIssuesAndPullRequests(t.Context(), repo, "", 20, nil); err == nil {
		t.Fatal("every list failed: the search fails")
	}
}

// A pasted issue or pull request URL searches for its number, on github.com and on the
// repository's Enterprise host.
func TestSearchNormalizesIssueAndPullRequestURLs(t *testing.T) {
	repo, argsFile := searchRepo(t, "git@github.com:acme/repo.git", "echo '[]'", "echo '[]'")
	if _, err := SearchIssuesAndPullRequests(t.Context(), repo, " https://github.com/acme/repo/pull/16/files ", 20, []string{"change_request"}); err != nil {
		t.Fatal(err)
	}
	args, _ := os.ReadFile(argsFile)
	if !strings.Contains(string(args), "--search 16") {
		t.Fatalf("gh args: %s", args)
	}

	if got := normalizeGitHubSearchQuery("https://ghe.acme.com/team/app/issues/7#x", "ghe.acme.com"); got != "7" {
		t.Fatalf("enterprise URL: %q", got)
	}
	if got := normalizeGitHubSearchQuery("https://ghe.acme.com/team/app/issues/7", ""); got != "https://ghe.acme.com/team/app/issues/7" {
		t.Fatalf("an Enterprise URL for another host stays text: %q", got)
	}
	if got := normalizeGitHubSearchQuery("fix login", ""); got != "fix login" {
		t.Fatalf("plain text: %q", got)
	}
	if host := gitHubEnterpriseHost(t.Context(), repo); host != "" {
		t.Fatalf("github.com is not an Enterprise host: %q", host)
	}
}
