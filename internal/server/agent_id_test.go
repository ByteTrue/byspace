package server

import (
	"regexp"
	"testing"
)

// The schedule protocol validates agent ids as GUIDs (ScheduleRunSchema.agentId and the agent
// target in packages/protocol/src/schedule/types.ts), as Node's randomUUID ids always were.
var guidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func TestNewAgentIDIsUUIDv4(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 1000; i++ {
		id := newAgentID()
		if !guidPattern.MatchString(id) {
			t.Fatalf("newAgentID() = %q, want a version 4 UUID", id)
		}
		if seen[id] {
			t.Fatalf("newAgentID() repeated %q", id)
		}
		seen[id] = true
	}
}
