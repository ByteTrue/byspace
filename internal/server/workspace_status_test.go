package server

import (
	"testing"

	"github.com/ByteTrue/byspace/internal/store"
)

func strPtr(value string) *string { return &value }

func TestMergeLabelPatchKeepsUnmentionedKeys(t *testing.T) {
	current := map[string]string{
		ParentAgentIDLabel:              "agt_parent",
		"byspace.open-agent-tab.client": "true",
		"team":                          "infra",
	}
	got := mergeLabelPatch(current, map[string]string{"team": "platform"})
	if got[ParentAgentIDLabel] != "agt_parent" {
		t.Fatalf("the parent link was dropped: %+v", got)
	}
	if got["byspace.open-agent-tab.client"] != "true" {
		t.Fatalf("the open-tab marker was dropped: %+v", got)
	}
	if got["team"] != "platform" {
		t.Fatalf("the patch did not win: %+v", got)
	}
	if len(current) != 3 || current["team"] != "infra" {
		t.Fatalf("the source map was mutated: %+v", current)
	}
}

func TestMergeLabelPatchDeletesWithEmptyValue(t *testing.T) {
	got := mergeLabelPatch(
		map[string]string{ParentAgentIDLabel: "agt_parent", "team": "infra"},
		map[string]string{ParentAgentIDLabel: ""},
	)
	if _, present := got[ParentAgentIDLabel]; present {
		t.Fatalf("an empty value did not delete the key: %+v", got)
	}
	if got["team"] != "infra" {
		t.Fatalf("an unrelated key was dropped: %+v", got)
	}
}

func TestDeriveAgentStateBucketFollowsPriority(t *testing.T) {
	cases := []struct {
		name    string
		record  store.AgentRecord
		pending int
		want    string
	}{
		{"running", store.AgentRecord{LastStatus: "running"}, 0, bucketRunning},
		{"permission wins over running", store.AgentRecord{LastStatus: "running"}, 1, bucketNeedsInput},
		{"permission reason", store.AgentRecord{LastStatus: "idle", AttentionReason: strPtr("permission")}, 0, bucketNeedsInput},
		{"error", store.AgentRecord{LastStatus: "error"}, 0, bucketFailed},
		{"error reason", store.AgentRecord{LastStatus: "idle", AttentionReason: strPtr("error")}, 0, bucketFailed},
		{"attention", store.AgentRecord{LastStatus: "idle", RequiresAttention: true, AttentionReason: strPtr("finished")}, 0, bucketAttention},
		{"idle", store.AgentRecord{LastStatus: "idle"}, 0, bucketDone},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := deriveAgentStateBucket(testCase.record, testCase.pending); got != testCase.want {
				t.Fatalf("bucket = %q, want %q", got, testCase.want)
			}
		})
	}
}

func TestWorkspaceStateBucketPriorityOrdersAsTheSidebarDoes(t *testing.T) {
	order := []string{bucketNeedsInput, bucketFailed, bucketRunning, bucketAttention, bucketDone}
	for i := 1; i < len(order); i++ {
		if workspaceStateBucketPriority(order[i-1]) >= workspaceStateBucketPriority(order[i]) {
			t.Fatalf("%q is not prioritised over %q", order[i-1], order[i])
		}
	}
	if got := workspaceStateBucketPriority("nonsense"); got != workspaceStateBucketPriority(bucketDone) {
		t.Fatalf("an unknown bucket ranked %d; it must sit with done", got)
	}
}
