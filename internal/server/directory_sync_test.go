package server

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/ByteTrue/byspace/internal/directorysync"
	"github.com/ByteTrue/byspace/internal/store"
)

// projectListResponse is the shape `handleProjectList` answers with.
type projectListResponse struct {
	RequestID string           `json:"requestId"`
	Projects  []map[string]any `json:"projects"`
	Sync      map[string]any   `json:"sync"`
}

// lastSessionPayload decodes the payload of the most recent frame of one type.
func lastSessionPayload[T any](t *testing.T, sink *recordingSink, msgType string) T {
	t.Helper()
	sink.mu.Lock()
	defer sink.mu.Unlock()
	for i := len(sink.texts) - 1; i >= 0; i-- {
		var envelope struct {
			Type    string `json:"type"`
			Message struct {
				Type    string          `json:"type"`
				Payload json.RawMessage `json:"payload"`
			} `json:"message"`
		}
		if json.Unmarshal([]byte(sink.texts[i]), &envelope) != nil || envelope.Type != "session" {
			continue
		}
		if envelope.Message.Type != msgType {
			continue
		}
		var payload T
		if err := json.Unmarshal(envelope.Message.Payload, &payload); err != nil {
			t.Fatalf("payload of %s: %v", msgType, err)
		}
		return payload
	}
	t.Fatalf("no %s frame was sent", msgType)
	var zero T
	return zero
}

// directoryTestServer is a server wired for directory-sync reads without a full socket.
func directoryTestServer(t *testing.T) (*Server, *recordingSink) {
	t.Helper()
	srv := newTestServer(t, t.TempDir())
	sink := &recordingSink{}
	srv.mu.Lock()
	srv.clients[sink] = true
	srv.mu.Unlock()
	return srv, sink
}

func addProject(t *testing.T, srv *Server, root string) store.ProjectRecord {
	t.Helper()
	prj, err := srv.store.FindOrCreateProjectForDirectory(root)
	if err != nil {
		t.Fatal(err)
	}
	return prj
}

// The first read is a snapshot and the second, carrying the cursor, is a delta.
//
// A daemon that answers every read with a snapshot forces the client to replace its whole project
// table on every poll. That is what this daemon did before it had sequences, and it is why the
// feature was switched off in `server_info`.
func TestProjectListAnswersADeltaAfterACursor(t *testing.T) {
	srv, sink := directoryTestServer(t)
	addProject(t, srv, t.TempDir())

	srv.handleProjectList(context.Background(), sink, json.RawMessage(`{"requestId":"r1","sync":{}}`))
	first := lastSessionPayload[projectListResponse](t, sink, "project.list.response")
	if first.Sync["mode"] != "snapshot" {
		t.Fatalf("first read mode = %v, want snapshot", first.Sync["mode"])
	}
	if first.Sync["reason"] != "no_cursor" {
		t.Fatalf("first read reason = %v, want no_cursor", first.Sync["reason"])
	}
	generation := first.Sync["generation"]
	head := first.Sync["headSeq"]
	if len(first.Projects) == 0 {
		t.Fatal("the snapshot listed no projects")
	}
	// Every row carries the sequence the client stores as its cursor.
	for _, row := range first.Projects {
		if _, has := row["syncSeq"]; !has {
			t.Fatalf("project row has no syncSeq: %+v", row)
		}
	}

	// Nothing changed, so the delta is empty and the head did not move.
	request, _ := json.Marshal(map[string]any{
		"requestId": "r2",
		"sync":      map[string]any{"generation": generation, "afterSeq": head},
	})
	srv.handleProjectList(context.Background(), sink, request)
	second := lastSessionPayload[projectListResponse](t, sink, "project.list.response")
	if second.Sync["mode"] != "changes" {
		t.Fatalf("second read mode = %v, want changes", second.Sync["mode"])
	}
	if len(second.Projects) != 0 {
		t.Fatalf("second read returned %+v, want nothing changed", second.Projects)
	}
	if second.Sync["headSeq"] != head {
		t.Fatalf("headSeq moved from %v to %v without a change", head, second.Sync["headSeq"])
	}
}

// A removed project is reported as a removal, which is the only way a client learns the row is
// gone — "nothing was updated" is indistinguishable from "the row is still there".
func TestProjectListReportsRemovals(t *testing.T) {
	srv, sink := directoryTestServer(t)
	prj := addProject(t, srv, t.TempDir())

	srv.handleProjectList(context.Background(), sink, json.RawMessage(`{"requestId":"r1","sync":{}}`))
	first := lastSessionPayload[projectListResponse](t, sink, "project.list.response")
	generation, head := first.Sync["generation"], first.Sync["headSeq"]

	// A project leaves the directory by being archived, not by being deleted from the store.
	archivedAt := "2026-10-27T00:00:00Z"
	prj.ArchivedAt = &archivedAt
	if err := srv.store.UpsertProject(prj); err != nil {
		t.Fatal(err)
	}
	request, _ := json.Marshal(map[string]any{
		"requestId": "r2",
		"sync":      map[string]any{"generation": generation, "afterSeq": head},
	})
	srv.handleProjectList(context.Background(), sink, request)
	second := lastSessionPayload[projectListResponse](t, sink, "project.list.response")

	if second.Sync["mode"] != "changes" {
		t.Fatalf("mode = %v, want changes", second.Sync["mode"])
	}
	removals, _ := second.Sync["removals"].([]any)
	if len(removals) != 1 {
		t.Fatalf("removals = %+v, want the deleted project", second.Sync["removals"])
	}
	removal, _ := removals[0].(map[string]any)
	if removal["id"] != prj.ProjectID {
		t.Fatalf("removal = %+v, want %s", removal, prj.ProjectID)
	}
}

// A cursor from an earlier daemon instance gets a snapshot: its replica may hold rows this process
// never saw, so a delta could not repair it.
func TestProjectListRejectsAStaleGeneration(t *testing.T) {
	srv, sink := directoryTestServer(t)
	addProject(t, srv, t.TempDir())

	request := json.RawMessage(`{"requestId":"r1","sync":{"generation":"from-a-previous-run","afterSeq":1}}`)
	srv.handleProjectList(context.Background(), sink, request)
	response := lastSessionPayload[projectListResponse](t, sink, "project.list.response")

	if response.Sync["mode"] != "snapshot" {
		t.Fatalf("mode = %v, want snapshot", response.Sync["mode"])
	}
	if response.Sync["reason"] != "generation_changed" {
		t.Fatalf("reason = %v, want generation_changed", response.Sync["reason"])
	}
}

// A live update carries the sequence only for clients that asked for one.
//
// A socket that never sent a cursor does not read `seq`; stamping it there would claim a position
// it does not hold, and two clients would disagree about the same row.
func TestBroadcastStampsSequenceOnlyForCursorSinks(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	sequenced, plain := &recordingSink{}, &recordingSink{}
	srv.mu.Lock()
	srv.clients[sequenced] = true
	srv.clients[plain] = true
	srv.directorySyncSinks[sequenced] = true
	srv.mu.Unlock()

	srv.broadcastProjectUpsert(map[string]any{"projectId": "prj_1", "projectDisplayName": "one"})

	withSeq := lastSessionPayload[map[string]any](t, sequenced, "project.update")
	if withSeq["seq"] == nil {
		t.Fatalf("sequenced sink got %+v, want a seq", withSeq)
	}
	if withSeq["generation"] == nil {
		t.Fatalf("sequenced sink got %+v, want a generation", withSeq)
	}
	withoutSeq := lastSessionPayload[map[string]any](t, plain, "project.update")
	if _, has := withoutSeq["seq"]; has {
		t.Fatalf("plain sink got seq %v", withoutSeq["seq"])
	}
	if withoutSeq["kind"] != "upsert" {
		t.Fatalf("plain sink got %+v, want the same update without sequences", withoutSeq)
	}
}

// A sequenced read needs the whole directory, so a filtered one is refused rather than answered
// with a cursor that claims to cover rows it skipped.
func TestSequencedWorkspaceReadRejectsAFilter(t *testing.T) {
	srv, sink := directoryTestServer(t)
	request := json.RawMessage(`{"requestId":"r1","sync":{},"filter":{"query":"x"}}`)
	srv.handleFetchWorkspaces(context.Background(), sink, request)

	errPayload := lastSessionPayload[map[string]any](t, sink, "rpc_error")
	if errPayload["code"] != "invalid_request" {
		t.Fatalf("payload = %+v, want invalid_request", errPayload)
	}
}

// The service the server uses is the one whose generation the responses carry.
func TestServerInfoAdvertisesDirectorySync(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	features, _ := srv.buildServerInfoPayload()["features"].(map[string]any)
	if features["directorySync"] != true {
		t.Fatalf("directorySync = %v, want true: the implementation exists", features["directorySync"])
	}
	if srv.directory == nil {
		t.Fatal("the server has no directory service")
	}
	var _ *directorysync.Service = srv.directory
}
