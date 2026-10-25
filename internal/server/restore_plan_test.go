package server

import "testing"

type restoreIn = struct {
	Mode            string `json:"mode"`
	Resume          *bool  `json:"resume"`
	ScrollbackLines *int   `json:"scrollbackLines"`
	Size            *struct {
		Rows int `json:"rows"`
		Cols int `json:"cols"`
	} `json:"size"`
}

func intPtr(v int) *int { return &v }

// The three modes exist because catching up is a trade: replaying bytes is exact but unbounded,
// a snapshot is bounded but loses scrollback fidelity. Without the distinction every reconnect
// received both.
func TestPlanTerminalRestoreModes(t *testing.T) {
	cases := []struct {
		name string
		in   *restoreIn
		want terminalRestorePlan
	}{
		{
			name: "no restore keeps the historical snapshot+replay",
			in:   nil,
			want: terminalRestorePlan{sendSnapshot: true, sendReplay: true},
		},
		{
			name: "live replays only",
			in:   &restoreIn{Mode: "live"},
			want: terminalRestorePlan{sendReplay: true},
		},
		{
			name: "visible-snapshot bounds scrollback",
			in:   &restoreIn{Mode: "visible-snapshot", ScrollbackLines: intPtr(50)},
			want: terminalRestorePlan{sendSnapshot: true, scrollbackLines: 50, sendReplay: true},
		},
		{
			name: "visible-snapshot defaults to 200 lines",
			in:   &restoreIn{Mode: "visible-snapshot"},
			want: terminalRestorePlan{sendSnapshot: true, scrollbackLines: 200, sendReplay: true},
		},
		{
			name: "visible-snapshot clamps to 1000",
			in:   &restoreIn{Mode: "visible-snapshot", ScrollbackLines: intPtr(99999)},
			want: terminalRestorePlan{sendSnapshot: true, scrollbackLines: 1000, sendReplay: true},
		},
		{
			name: "full-snapshot is unbounded",
			in:   &restoreIn{Mode: "full-snapshot"},
			want: terminalRestorePlan{sendSnapshot: true, sendReplay: true},
		},
	}
	for _, tc := range cases {
		got := planTerminalRestore(tc.in)
		if got != tc.want {
			t.Fatalf("%s: got %+v, want %+v", tc.name, got, tc.want)
		}
	}
}
