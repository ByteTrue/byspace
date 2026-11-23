package server

import (
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	diffframes "github.com/ByteTrue/byspace/internal/diff"
)

// diffUpdatePayloads returns the payload of every checkout_diff_update sent to sink.
func diffUpdatePayloads(t *testing.T, sink *recordingSink) []map[string]any {
	t.Helper()
	sink.mu.Lock()
	defer sink.mu.Unlock()
	var out []map[string]any
	for _, raw := range sink.texts {
		var envelope struct {
			Message struct {
				Type    string         `json:"type"`
				Payload map[string]any `json:"payload"`
			} `json:"message"`
		}
		if json.Unmarshal([]byte(raw), &envelope) != nil {
			continue
		}
		if envelope.Message.Type == "checkout_diff_update" {
			out = append(out, envelope.Message.Payload)
		}
	}
	return append(out, diffPayloadsFromFrames(t, sink.binaryFrames)...)
}

// diffPayloadsFromFrames is the client's reading of the binary channel: a revision is Begin,
// Bodies, End, and a path the Bodies frame does not carry keeps its body from the last revision.
// Folding the frames here lets the subscription tests assert what the pane renders, not which
// transport carried it.
func diffPayloadsFromFrames(t *testing.T, frames [][]byte) []map[string]any {
	t.Helper()
	type pending struct {
		header diffframes.BeginHeader
		bodies map[string]map[string]any
	}
	inflight := map[string]*pending{}
	retained := map[string]map[string]map[string]any{}
	var out []map[string]any
	for _, frame := range frames {
		if len(frame) < 2 {
			continue
		}
		id := string(frame[2 : 2+int(frame[1])])
		switch frame[0] {
		case diffframes.OpcodeBegin:
			var header diffframes.BeginHeader
			if json.Unmarshal(frame[2+int(frame[1]):], &header) != nil {
				continue
			}
			inflight[id] = &pending{header: header, bodies: map[string]map[string]any{}}
		case diffframes.OpcodeBodies:
			current := inflight[id]
			if current == nil {
				continue
			}
			for path, file := range decodeBodyFiles(t, frame) {
				raw, err := json.Marshal(file)
				if err != nil {
					t.Fatal(err)
				}
				var body map[string]any
				if err := json.Unmarshal(raw, &body); err != nil {
					t.Fatal(err)
				}
				current.bodies[path] = body
			}
		case diffframes.OpcodeEnd:
			current := inflight[id]
			if current == nil {
				continue
			}
			delete(inflight, id)
			var trailer diffframes.EndTrailer
			if json.Unmarshal(frame[2+int(frame[1]):], &trailer) != nil {
				continue
			}
			files := []any{}
			next := map[string]map[string]any{}
			for _, path := range current.header.Entries {
				body := current.bodies[path]
				if body == nil {
					body = retained[id][path]
				}
				if body == nil {
					continue
				}
				next[path] = body
				files = append(files, body)
			}
			retained[id] = next
			var errPayload any
			if trailer.Error != nil {
				errPayload = map[string]any{"code": trailer.Error.Code, "message": trailer.Error.Message}
			}
			payload := map[string]any{
				"subscriptionId": id,
				"cwd":            current.header.Cwd,
				"files":          files,
				"error":          errPayload,
			}
			if trailer.DiffTooLarge {
				payload["diffTooLarge"] = true
			}
			out = append(out, payload)
		}
	}
	return out
}

// addedLines sums the additions the update reports for the given path.
func addedLines(payload map[string]any, path string) float64 {
	files, _ := payload["files"].([]any)
	var total float64
	for _, entry := range files {
		file, _ := entry.(map[string]any)
		if file["path"] != path {
			continue
		}
		if n, ok := file["additions"].(float64); ok {
			total += n
		}
	}
	return total
}

// waitForDiffUpdate blocks until an update matching match has been sent, and returns it.
func waitForDiffUpdate(t *testing.T, sink *recordingSink, match func(map[string]any) bool) map[string]any {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		for _, payload := range diffUpdatePayloads(t, sink) {
			if match(payload) {
				return payload
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("no matching checkout_diff_update arrived; got %v", diffUpdatePayloads(t, sink))
	return nil
}

// A subscribed pane is served by the diff engine: the first answer arrives on its own, and a write
// reaches the pane without anyone calling PollSubscriptionsOnce.
func TestDiffSubscriptionDeliversChangesWithoutPolling(t *testing.T) {
	dir := t.TempDir()
	gitInit(t, dir)
	writeRepoFile(t, dir, "a.txt", "one\n")
	gitIn(t, dir, "add", ".")
	gitIn(t, dir, "commit", "-m", "one")
	writeRepoFile(t, dir, "a.txt", "one\ntwo\n")

	srv := newTestServer(t, t.TempDir())
	sink := addTestClient(srv)
	srv.RegisterDiffSubscription("diff_1", sink, dir, map[string]any{"mode": "uncommitted"})
	t.Cleanup(func() { srv.UnregisterDiffSubscription("diff_1") })

	first := waitForDiffUpdate(t, sink, func(payload map[string]any) bool {
		return addedLines(payload, "a.txt") == 1
	})
	if first["subscriptionId"] != "diff_1" {
		t.Fatalf("subscriptionId = %v", first["subscriptionId"])
	}
	if first["error"] != nil {
		t.Fatalf("error = %v", first["error"])
	}

	writeRepoFile(t, dir, "a.txt", "one\ntwo\nthree\n")
	srv.markWorkingTreeChange(dir)

	second := waitForDiffUpdate(t, sink, func(payload map[string]any) bool {
		return addedLines(payload, "a.txt") == 2
	})
	if second["error"] != nil {
		t.Fatalf("error = %v", second["error"])
	}
}

// A pane that closed stops costing computation: the subscription is released and later changes
// deliver nothing.
func TestUnregisteredDiffSubscriptionStopsDelivery(t *testing.T) {
	dir := t.TempDir()
	gitInit(t, dir)
	writeRepoFile(t, dir, "a.txt", "one\n")
	gitIn(t, dir, "add", ".")
	gitIn(t, dir, "commit", "-m", "one")

	srv := newTestServer(t, t.TempDir())
	sink := addTestClient(srv)
	srv.RegisterDiffSubscription("diff_1", sink, dir, map[string]any{"mode": "uncommitted"})
	waitForDiffUpdate(t, sink, func(map[string]any) bool { return true })
	srv.UnregisterDiffSubscription("diff_1")

	writeRepoFile(t, dir, "a.txt", "one\ntwo\n")
	srv.markWorkingTreeChange(dir)
	time.Sleep(600 * time.Millisecond)

	if updates := diffUpdatePayloads(t, sink); len(updates) != 1 {
		t.Fatalf("a released subscription still received updates: %d", len(updates))
	}
}

// Two panes on one checkout share the comparison: one change reaches both, and the engine computes
// it once (the sharing itself is covered by the engine test that counts computations).
func TestTwoPanesOnOneCheckoutBothReceiveTheUpdate(t *testing.T) {
	dir := t.TempDir()
	gitInit(t, dir)
	writeRepoFile(t, dir, "a.txt", "one\n")
	gitIn(t, dir, "add", ".")
	gitIn(t, dir, "commit", "-m", "one")
	writeRepoFile(t, dir, "a.txt", "one\ntwo\n")

	srv := newTestServer(t, t.TempDir())
	left, right := addTestClient(srv), addTestClient(srv)
	compare := map[string]any{"mode": "uncommitted"}
	srv.RegisterDiffSubscription("diff_left", left, dir, compare)
	srv.RegisterDiffSubscription("diff_right", right, dir, compare)
	t.Cleanup(func() {
		srv.UnregisterDiffSubscription("diff_left")
		srv.UnregisterDiffSubscription("diff_right")
	})

	writeRepoFile(t, dir, "a.txt", "one\ntwo\nthree\n")
	srv.markWorkingTreeChange(dir)

	waitForDiffUpdate(t, left, func(payload map[string]any) bool { return addedLines(payload, "a.txt") == 2 })
	waitForDiffUpdate(t, right, func(payload map[string]any) bool { return addedLines(payload, "a.txt") == 2 })
}

// The watcher reports a checkout with backslashes on Windows while the client subscribes with
// forward slashes. An invalidation that compares the two spellings literally never reaches the
// pane, so the subscription must canonicalize its key and the invalidation must use the same form.
func TestDiffSubscriptionInvalidationAcceptsEitherPathSpelling(t *testing.T) {
	dir := t.TempDir()
	gitInit(t, dir)
	writeRepoFile(t, dir, "a.txt", "one\n")
	gitIn(t, dir, "add", ".")
	gitIn(t, dir, "commit", "-m", "one")
	writeRepoFile(t, dir, "a.txt", "one\ntwo\n")

	srv := newTestServer(t, t.TempDir())
	sink := addTestClient(srv)
	srv.RegisterDiffSubscription("diff_1", sink, filepath.ToSlash(dir), map[string]any{"mode": "uncommitted"})
	t.Cleanup(func() { srv.UnregisterDiffSubscription("diff_1") })
	waitForDiffUpdate(t, sink, func(payload map[string]any) bool { return addedLines(payload, "a.txt") == 1 })

	writeRepoFile(t, dir, "a.txt", "one\ntwo\nthree\n")
	srv.markWorkingTreeChange(filepath.FromSlash(dir))

	waitForDiffUpdate(t, sink, func(payload map[string]any) bool { return addedLines(payload, "a.txt") == 2 })
}
