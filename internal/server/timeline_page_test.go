package server

import (
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/pi"
	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// pageOf builds a timeline of `count` discrete entries at seq 1..count.
func pageOf(count int) []pi.TimelineEntry {
	out := make([]pi.TimelineEntry, 0, count)
	for seq := 1; seq <= count; seq++ {
		out = append(out, pi.TimelineEntry{
			Seq:    seq,
			SeqEnd: seq,
			Item:   sdk.TimelineItem{Type: "assistant_message", Text: "m"},
		})
	}
	return out
}

func seqs(entries []pi.TimelineEntry) []int {
	out := make([]int, 0, len(entries))
	for _, e := range entries {
		out = append(out, e.Seq)
	}
	return out
}

func eq(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// The tail keeps the newest page and reports that older history exists — the flag a client reads to
// offer "load more" at the top. It was hardcoded false, so a long conversation never paged.
func TestSelectTimelinePageTail(t *testing.T) {
	all := pageOf(100)
	page := selectTimelinePage(all, "tail", 0, 40, 1, 100)
	if len(page.entries) != 40 {
		t.Fatalf("tail entries = %v, want the newest 40", seqs(page.entries))
	}
	if first := page.entries[0].Seq; first != 61 {
		t.Fatalf("tail starts at %d, want 61", first)
	}
	if last := page.entries[len(page.entries)-1].Seq; last != 100 {
		t.Fatalf("tail ends at %d, want 100", last)
	}
	if !page.hasOlder {
		t.Fatal("tail of a longer timeline must report hasOlder")
	}
	if page.hasNewer {
		t.Fatal("tail always reaches the newest entry, so hasNewer is false")
	}

	// A limit larger than the timeline returns everything and reports no older history.
	short := pageOf(10)
	page = selectTimelinePage(short, "tail", 0, 40, 1, 10)
	if len(page.entries) != 10 || page.hasOlder {
		t.Fatalf("tail over a short timeline = %v hasOlder=%v", seqs(page.entries), page.hasOlder)
	}
}

// `before` walks backward from the cursor and reports what remains above and below the page.
func TestSelectTimelinePageBefore(t *testing.T) {
	all := pageOf(100)
	// Ask for the 40 entries before seq 101: that is seqs 61..100, with 60 older still.
	page := selectTimelinePage(all, "before", 101, 40, 1, 100)
	if first := page.entries[0].Seq; first != 61 {
		t.Fatalf("before starts at %d, want 61", first)
	}
	if last := page.entries[len(page.entries)-1].Seq; last != 100 {
		t.Fatalf("before ends at %d, want 100", last)
	}
	if !page.hasOlder {
		t.Fatal("before over a longer timeline must report hasOlder")
	}
	if page.hasNewer {
		t.Fatal("before at the top of the timeline has nothing newer")
	}

	// The next page back: before seq 61 gives seqs 21..60, still 20 older, and now 40 newer.
	page = selectTimelinePage(all, "before", 61, 40, 1, 100)
	if first := page.entries[0].Seq; first != 21 {
		t.Fatalf("second before page starts at %d, want 21", first)
	}
	if last := page.entries[len(page.entries)-1].Seq; last != 60 {
		t.Fatalf("second before page ends at %d, want 60", last)
	}
	if !page.hasOlder || !page.hasNewer {
		t.Fatalf("middle page flags: hasOlder=%v hasNewer=%v, want both true", page.hasOlder, page.hasNewer)
	}

	// The oldest page: before seq 21 gives seqs 1..20, nothing older, 80 newer.
	page = selectTimelinePage(all, "before", 21, 40, 1, 100)
	if len(page.entries) != 20 {
		t.Fatalf("oldest page = %v, want seqs 1..20", seqs(page.entries))
	}
	if page.entries[0].Seq != 1 || page.entries[len(page.entries)-1].Seq != 20 {
		t.Fatalf("oldest page range = %v", seqs(page.entries))
	}
	if page.hasOlder {
		t.Fatal("the oldest page has nothing before it")
	}
	if !page.hasNewer {
		t.Fatal("the oldest page of a longer timeline has newer history")
	}
}

// `after` walks forward from the cursor, oldest first, so a reconnecting client catches up in order.
func TestSelectTimelinePageAfter(t *testing.T) {
	all := pageOf(100)
	page := selectTimelinePage(all, "after", 0, 40, 1, 100)
	if first := page.entries[0].Seq; first != 1 {
		t.Fatalf("after from the start begins at %d, want 1", first)
	}
	if last := page.entries[len(page.entries)-1].Seq; last != 40 {
		t.Fatalf("after from the start ends at %d, want 40 (oldest page, not the tail)", last)
	}
	if !page.hasNewer {
		t.Fatal("after from the start of a longer timeline must report hasNewer")
	}

	// Catching up from seq 90: seqs 91..100, nothing newer beyond.
	page = selectTimelinePage(all, "after", 90, 40, 1, 100)
	if !eq(seqs(page.entries), []int{91, 92, 93, 94, 95, 96, 97, 98, 99, 100}) {
		t.Fatalf("after 90 = %v", seqs(page.entries))
	}
	if page.hasNewer {
		t.Fatal("after reaching the newest entry has nothing newer")
	}
}

// A streamed message spans seq..seqEnd; a page boundary must not split it. `before` selects by
// seqStart so a wide entry stays whole on exactly one backward page.
func TestSelectTimelinePageKeepsSpannedEntriesWhole(t *testing.T) {
	all := []pi.TimelineEntry{
		{Seq: 1, SeqEnd: 1, Item: sdk.TimelineItem{Type: "user_message"}},
		// One streamed assistant message spanning seqs 2..30.
		{Seq: 2, SeqEnd: 30, Item: sdk.TimelineItem{Type: "assistant_message"}},
		{Seq: 31, SeqEnd: 31, Item: sdk.TimelineItem{Type: "user_message"}},
	}
	// A page of 2 taken before seq 32 must not cut the spanned message: it selects by seqStart, so
	// the spanned entry (seqStart 2) lands whole with the following user_message (seqStart 31).
	page := selectTimelinePage(all, "before", 32, 2, 1, 31)
	if len(page.entries) != 2 {
		t.Fatalf("entries = %d, want 2", len(page.entries))
	}
	if page.entries[0].Seq != 2 || page.entries[0].SeqEnd != 30 {
		t.Fatalf("spanned entry was cut: %d..%d, want 2..30", page.entries[0].Seq, page.entries[0].SeqEnd)
	}
}

// An empty timeline still reports a coherent window: no entries, no coverage either direction.
func TestSelectTimelinePageEmpty(t *testing.T) {
	page := selectTimelinePage(nil, "tail", 0, 40, 0, 0)
	if len(page.entries) != 0 || page.hasOlder || page.hasNewer {
		t.Fatalf("empty tail = %+v", page)
	}
	page = selectTimelinePage(nil, "before", 1, 40, 0, 0)
	if len(page.entries) != 0 || page.hasOlder || page.hasNewer {
		t.Fatalf("empty before = %+v", page)
	}
	page = selectTimelinePage(nil, "after", 0, 40, 0, 0)
	if len(page.entries) != 0 || page.hasOlder || page.hasNewer {
		t.Fatalf("empty after = %+v", page)
	}
}

// timelineSeqEndOf treats an unset seqEnd as the same seq, and never lets it fall below the start.
func TestTimelineSeqBounds(t *testing.T) {
	if got := timelineSeqEndOf(pi.TimelineEntry{Seq: 5}); got != 5 {
		t.Fatalf("unset seqEnd = %d, want 5", got)
	}
	if got := timelineSeqEndOf(pi.TimelineEntry{Seq: 5, SeqEnd: 9}); got != 9 {
		t.Fatalf("spanned seqEnd = %d, want 9", got)
	}
	if got := timelineSeqStartOf(pi.TimelineEntry{Seq: 0}); got != 1 {
		t.Fatalf("zero seq start = %d, want 1", got)
	}
}
