package server

import "testing"

// The window semantics are what make the panel usable for a long subagent: `tail` shows the most
// recent N with hasOlder set, `head` the first N with hasNewer set. Returning everything ignores
// both the limit and the direction.
func TestSubagentTimelineWindow(t *testing.T) {
	rows := []int{1, 2, 3, 4, 5}

	window := func(direction string, limit *int) (kept []int, older, newer bool) {
		out := append([]int{}, rows...)
		total := len(out)
		hasOlder, hasNewer := false, false
		if limit != nil && *limit > 0 && *limit < total {
			if direction == "after" {
				out = out[:*limit]
				hasNewer = true
			} else {
				out = out[total-*limit:]
				hasOlder = true
			}
		}
		return out, hasOlder, hasNewer
	}

	two := 2
	kept, older, newer := window("tail", &two)
	if len(kept) != 2 || kept[0] != 4 || kept[1] != 5 {
		t.Fatalf("tail kept %v", kept)
	}
	if !older || newer {
		t.Fatalf("tail flags: older=%v newer=%v", older, newer)
	}

	kept, older, newer = window("after", &two)
	if len(kept) != 2 || kept[0] != 1 || kept[1] != 2 {
		t.Fatalf("after kept %v", kept)
	}
	if older || !newer {
		t.Fatalf("after flags: older=%v newer=%v", older, newer)
	}

	// No limit means everything, and neither flag is set.
	kept, older, newer = window("tail", nil)
	if len(kept) != 5 || older || newer {
		t.Fatalf("no limit: %v older=%v newer=%v", kept, older, newer)
	}

	// A limit larger than the row count changes nothing.
	ten := 10
	kept, older, newer = window("tail", &ten)
	if len(kept) != 5 || older || newer {
		t.Fatalf("oversized limit: %v", kept)
	}
}
