package server

import (
	"testing"

	"github.com/ByteTrue/byspace/internal/store"
)

func titlePtr(s string) *string { return &s }

// Every token must match, and tokens may land on different fields: "stripe main" finds the
// Stripe workspace on the main branch. A plain substring test over one field cannot do that,
// which is what this replaced.
func TestHistorySearchMatchesAcrossFields(t *testing.T) {
	rec := store.AgentRecord{ID: "a1", Title: titlePtr("review PR")}
	placement := map[string]any{
		"workspaceName": "stripe",
		"projectName":   "payments",
		"checkout":      map[string]any{"currentBranch": "main"},
	}

	if _, ok := scoreAgentHistoryCandidate("stripe main", rec, placement); !ok {
		t.Fatal("expected workspace+branch to match across fields")
	}
	if _, ok := scoreAgentHistoryCandidate("stripe nope", rec, placement); ok {
		t.Fatal("a token that matches nothing must reject the candidate")
	}
}

// Ranking is tier-first, then field order, then offset. A workspace exact match beats a
// project substring match.
func TestHistorySearchRanksWorkspaceAboveProject(t *testing.T) {
	rec := store.AgentRecord{ID: "a1", Title: titlePtr("x")}
	workspaceHit := map[string]any{"workspaceName": "stripe", "projectName": "other"}
	projectHit := map[string]any{"workspaceName": "other", "projectName": "stripe"}

	wsScore, ok := scoreAgentHistoryCandidate("stripe", rec, workspaceHit)
	if !ok {
		t.Fatal("workspace match expected")
	}
	projScore, ok := scoreAgentHistoryCandidate("stripe", rec, projectHit)
	if !ok {
		t.Fatal("project match expected")
	}
	if wsScore >= projScore {
		t.Fatalf("workspace match (%d) should rank better than project match (%d)", wsScore, projScore)
	}
}

// A typo the policy forgives must still match, using the same tiers as path search.
func TestHistorySearchForgivesTypo(t *testing.T) {
	rec := store.AgentRecord{ID: "a1", Title: titlePtr("deploy pipeline")}
	placement := map[string]any{"workspaceName": "", "projectName": ""}
	if _, ok := scoreAgentHistoryCandidate("deplyo", rec, placement); !ok {
		t.Fatal("a transposition in a long token should still match")
	}
}

// Empty query matches nothing here; the caller decides not to filter at all.
func TestHistorySearchEmptyQuery(t *testing.T) {
	rec := store.AgentRecord{ID: "a1"}
	if _, ok := scoreAgentHistoryCandidate("   ", rec, map[string]any{}); ok {
		t.Fatal("blank query must not produce a score")
	}
}
