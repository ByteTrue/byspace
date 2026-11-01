package server

import (
	"errors"
	"testing"

	"github.com/ByteTrue/byspace/internal/workspace"
)

// Node's statuses for the repository search: the client shows setup guidance for a missing or
// signed-out gh, and the command's own message for anything else. The port answered every failure
// with an empty success.
func TestGitHubRepositorySearchPayloadStatuses(t *testing.T) {
	ok := githubRepositorySearchPayload("r1", nil, nil)
	if ok["status"] != "success" || ok["available"] != true || ok["error"] != nil {
		t.Fatalf("success payload %+v", ok)
	}
	if rows, _ := ok["repositories"].([]workspace.GitHubRepositorySummary); rows == nil {
		t.Fatalf("success must carry an array, not null: %+v", ok)
	}

	missing := githubRepositorySearchPayload("r2", nil, &workspace.GitHubCLIError{Kind: workspace.GitHubCLIMissing})
	if missing["status"] != "unavailable" || missing["reason"] != "gh_missing" || missing["available"] != false {
		t.Fatalf("missing payload %+v", missing)
	}

	signedOut := githubRepositorySearchPayload("r3", nil, &workspace.GitHubCLIError{Kind: workspace.GitHubCLIUnauthenticated})
	if signedOut["status"] != "unauthenticated" || signedOut["available"] != false {
		t.Fatalf("unauthenticated payload %+v", signedOut)
	}

	failed := githubRepositorySearchPayload("r4", nil, &workspace.GitHubCLIError{Kind: workspace.GitHubCLICommandFailed, Stderr: "  HTTP 422: Validation Failed\n"})
	if failed["status"] != "error" || failed["available"] != true || failed["error"] != "HTTP 422: Validation Failed" {
		t.Fatalf("command failure payload %+v", failed)
	}

	parse := githubRepositorySearchPayload("r5", nil, errors.New("gh did not return valid JSON (3 bytes)"))
	if parse["status"] != "error" || parse["error"] != "gh did not return valid JSON (3 bytes)" {
		t.Fatalf("parse failure payload %+v", parse)
	}
}
