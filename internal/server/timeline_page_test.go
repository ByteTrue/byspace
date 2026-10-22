package server

import (
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/pi"
)

// pageOf builds `count` projected rows at seq 1..count, the shape a timeline with no merging has.
func pageOf(count int) []projectedEntry {
	out := make([]projectedEntry, 0, count)
	for seq := 1; seq <= count; seq++ {
		out = append(out, projectedEntry{
			Item:            pi.TimelineItem{Type: "assistant_message", Text: "m"},
			SeqStart:        seq,
			SeqEnd:          seq,
			SourceSeqRanges: []timelineSeqRange{{StartSeq: seq, EndSeq: seq}},
		})
	}
	return out
}

func seqs(entries []projectedEntry) []int {
	out := make([]int, 0, len(entries))
	for _, e := range entries {
		out = append(out, e.SeqStart)
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
	if first := page.entries[0].SeqStart; first != 61 {
		t.Fatalf("tail starts at %d, want 61", first)
	}
	if last := page.entries[len(page.entries)-1].SeqStart; last != 100 {
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
	if first := page.entries[0].SeqStart; first != 61 {
		t.Fatalf("before starts at %d, want 61", first)
	}
	if last := page.entries[len(page.entries)-1].SeqStart; last != 100 {
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
	if first := page.entries[0].SeqStart; first != 21 {
		t.Fatalf("second before page starts at %d, want 21", first)
	}
	if last := page.entries[len(page.entries)-1].SeqStart; last != 60 {
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
	if page.entries[0].SeqStart != 1 || page.entries[len(page.entries)-1].SeqStart != 20 {
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
	if first := page.entries[0].SeqStart; first != 1 {
		t.Fatalf("after from the start begins at %d, want 1", first)
	}
	if last := page.entries[len(page.entries)-1].SeqStart; last != 40 {
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
	all := []projectedEntry{
		{Item: pi.TimelineItem{Type: "user_message"}, SeqStart: 1, SeqEnd: 1},
		// One merged assistant message spanning seqs 2..30.
		{Item: pi.TimelineItem{Type: "assistant_message"}, SeqStart: 2, SeqEnd: 30},
		{Item: pi.TimelineItem{Type: "user_message"}, SeqStart: 31, SeqEnd: 31},
	}
	// A page of 2 taken before seq 32 must not cut the spanned message: it selects by seqStart, so
	// the spanned entry (seqStart 2) lands whole with the following user_message (seqStart 31).
	page := selectTimelinePage(all, "before", 32, 2, 1, 31)
	if len(page.entries) != 2 {
		t.Fatalf("entries = %d, want 2", len(page.entries))
	}
	if page.entries[0].SeqStart != 2 || page.entries[0].SeqEnd != 30 {
		t.Fatalf("spanned entry was cut: %d..%d, want 2..30", page.entries[0].SeqStart, page.entries[0].SeqEnd)
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

// The projection is what makes a page of streamed deltas usable: one assistant turn is thousands of
// raw entries, and without folding them a 40-row page is 40 fragments of one message.
func TestProjectTimelineRowsFoldsDeltas(t *testing.T) {
	rows := []pi.TimelineEntry{
		{Seq: 1, SeqEnd: 1, TurnID: "t1", Item: pi.TimelineItem{Type: "user_message", Text: "hi", MessageID: "u1"}},
		{Seq: 2, SeqEnd: 2, TurnID: "t1", Item: pi.TimelineItem{Type: "reasoning", Text: "think "}},
		{Seq: 3, SeqEnd: 3, TurnID: "t1", Item: pi.TimelineItem{Type: "reasoning", Text: "more"}},
		{Seq: 4, SeqEnd: 4, TurnID: "t1", Item: pi.TimelineItem{Type: "assistant_message", Text: "Hel", MessageID: "a1"}},
		{Seq: 5, SeqEnd: 5, TurnID: "t1", Item: pi.TimelineItem{Type: "assistant_message", Text: "lo", MessageID: "a1"}},
		{Seq: 6, SeqEnd: 6, TurnID: "t1", Item: pi.TimelineItem{Type: "tool_call", CallID: "c1", Name: "bash", Status: "running"}},
		{Seq: 7, SeqEnd: 7, TurnID: "t1", Item: pi.TimelineItem{Type: "tool_call", CallID: "c1", Name: "bash", Status: "completed"}},
		{Seq: 8, SeqEnd: 8, TurnID: "t1", Item: pi.TimelineItem{Type: "assistant_message", Text: "Bye", MessageID: "a2"}},
	}
	projected := projectTimelineRows(rows, "projected")
	// user_message | reasoning(merged) | assistant "Hello" | tool_call(merged) | assistant "Bye"
	if len(projected) != 5 {
		for i, e := range projected {
			t.Logf("  [%d] %s %q seq %d..%d", i, e.Item.Type, e.Item.Text, e.SeqStart, e.SeqEnd)
		}
		t.Fatalf("projected rows = %d, want 5", len(projected))
	}
	if got := projected[1].Item.Text; got != "think more" {
		t.Fatalf("reasoning merge = %q, want %q", got, "think more")
	}
	if got := projected[2].Item.Text; got != "Hello" {
		t.Fatalf("assistant merge = %q, want %q", got, "Hello")
	}
	if projected[2].SeqStart != 4 || projected[2].SeqEnd != 5 {
		t.Fatalf("merged assistant seq range = %d..%d, want 4..5", projected[2].SeqStart, projected[2].SeqEnd)
	}
	if got := projected[3].Item.Status; got != "completed" {
		t.Fatalf("tool call status = %q, want completed", got)
	}
	if projected[3].SeqStart != 6 || projected[3].SeqEnd != 7 {
		t.Fatalf("tool call seq range = %d..%d, want 6..7", projected[3].SeqStart, projected[3].SeqEnd)
	}
	// Two assistant messages with different ids in one turn stay separate rows.
	if got := projected[4].Item.Text; got != "Bye" {
		t.Fatalf("the second assistant message merged into the first: %q", got)
	}

	// The source ranges record every raw seq the row covers, which is what keeps a page boundary
	// from falling inside a merged message.
	ranges := projected[2].SourceSeqRanges
	if len(ranges) != 1 || ranges[0].StartSeq != 4 || ranges[0].EndSeq != 5 {
		t.Fatalf("merged assistant sourceSeqRanges = %+v, want one range 4..5", ranges)
	}
}

// The canonical projection leaves every delta as its own row: it is what a client that merges
// client-side asks for, and folding it would hide the raw timeline.
func TestProjectTimelineRowsCanonicalKeepsEveryRow(t *testing.T) {
	rows := []pi.TimelineEntry{
		{Seq: 1, SeqEnd: 1, TurnID: "t1", Item: pi.TimelineItem{Type: "assistant_message", Text: "a", MessageID: "m"}},
		{Seq: 2, SeqEnd: 2, TurnID: "t1", Item: pi.TimelineItem{Type: "assistant_message", Text: "b", MessageID: "m"}},
	}
	if got := len(projectTimelineRows(rows, "canonical")); got != 2 {
		t.Fatalf("canonical rows = %d, want 2", got)
	}
	if got := len(projectTimelineRows(rows, "projected")); got != 1 {
		t.Fatalf("projected rows = %d, want 1", got)
	}
}

// A delta with no messageId joins the row before it: providers stream text before they know the id.
// A delta whose id differs starts a new row.
func TestMergeAssistantChunksByMessageID(t *testing.T) {
	rows := []pi.TimelineEntry{
		{Seq: 1, SeqEnd: 1, TurnID: "t1", Item: pi.TimelineItem{Type: "assistant_message", Text: "a"}},
		{Seq: 2, SeqEnd: 2, TurnID: "t1", Item: pi.TimelineItem{Type: "assistant_message", Text: "b"}},
		{Seq: 3, SeqEnd: 3, TurnID: "t1", Item: pi.TimelineItem{Type: "assistant_message", Text: "c", MessageID: "x"}},
		{Seq: 4, SeqEnd: 4, TurnID: "t1", Item: pi.TimelineItem{Type: "assistant_message", Text: "d", MessageID: "x"}},
		{Seq: 5, SeqEnd: 5, TurnID: "t1", Item: pi.TimelineItem{Type: "assistant_message", Text: "e", MessageID: "y"}},
	}
	projected := projectTimelineRows(rows, "projected")
	if len(projected) != 3 {
		t.Fatalf("rows = %d, want 3 (ab, cdx merged, e separate)", len(projected))
	}
	if projected[0].Item.Text != "ab" {
		t.Fatalf("id-less deltas = %q, want %q", projected[0].Item.Text, "ab")
	}
	if projected[1].Item.Text != "cd" {
		t.Fatalf("same-id deltas = %q, want %q", projected[1].Item.Text, "cd")
	}
	if projected[2].Item.Text != "e" {
		t.Fatalf("a new id must start a new row, got %q", projected[2].Item.Text)
	}
}

// Deltas from different turns never merge, even when adjacent: the turn boundary is what makes a
// row a row.
func TestMergeStopsAtTurnBoundary(t *testing.T) {
	rows := []pi.TimelineEntry{
		{Seq: 1, SeqEnd: 1, TurnID: "t1", Item: pi.TimelineItem{Type: "assistant_message", Text: "a", MessageID: "m1"}},
		{Seq: 2, SeqEnd: 2, TurnID: "t2", Item: pi.TimelineItem{Type: "assistant_message", Text: "b", MessageID: "m1"}},
	}
	if got := len(projectTimelineRows(rows, "projected")); got != 2 {
		t.Fatalf("rows = %d, want 2: a turn boundary splits them", got)
	}
}
