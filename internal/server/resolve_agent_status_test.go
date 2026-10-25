package server

import "testing"

// resolveAgentStatus decides what the daemon reports for an agent, given its own recorded status and
// the provider session's live state. The rule under test: "error" is daemon-owned and survives a
// session that has torn the failed turn down and gone idle, but yields to a session that is genuinely
// running (a new turn) or closed (the process is gone).
func TestResolveAgentStatus(t *testing.T) {
	cases := []struct {
		name        string
		lastStatus  string
		sessionStat string
		want        string
		why         string
	}{
		{
			name:        "daemon error survives an idle session",
			lastStatus:  "error",
			sessionStat: "idle",
			want:        "error",
			why:         "the failed turn is over and the session reports idle; the failure must not be erased",
		},
		{
			name:        "daemon error survives an empty session status",
			lastStatus:  "error",
			sessionStat: "",
			want:        "error",
			why:         "a session that has not settled yet must not blank out a recorded failure",
		},
		{
			name:        "a running session clears a stale error",
			lastStatus:  "error",
			sessionStat: "running",
			want:        "running",
			why:         "a new turn has started since the failure; the agent is running, not errored",
		},
		{
			name:        "a closed session outranks a stale error",
			lastStatus:  "error",
			sessionStat: "closed",
			want:        "closed",
			why:         "the process is gone; closed is the stronger, more actionable state",
		},
		{
			name:        "no error stays idle",
			lastStatus:  "idle",
			sessionStat: "idle",
			want:        "idle",
			why:         "the helper must not invent an error where there was none",
		},
		{
			name:        "session running wins over a recorded idle",
			lastStatus:  "idle",
			sessionStat: "running",
			want:        "running",
			why:         "the session is the live source for an in-progress turn",
		},
		{
			name:        "recorded running passes through when session agrees",
			lastStatus:  "running",
			sessionStat: "running",
			want:        "running",
			why:         "steady state during a turn",
		},
		{
			name:        "both empty stays empty for the caller to default",
			lastStatus:  "",
			sessionStat: "",
			want:        "",
			why:         "buildAgentSnapshotPayload maps empty to closed; the helper must not pre-empt that",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolveAgentStatus(tc.lastStatus, tc.sessionStat); got != tc.want {
				t.Fatalf("resolveAgentStatus(%q, %q) = %q, want %q — %s",
					tc.lastStatus, tc.sessionStat, got, tc.want, tc.why)
			}
		})
	}
}
