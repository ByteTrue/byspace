package server

import (
	"encoding/binary"
	"encoding/json"
	"testing"

	diffframes "github.com/ByteTrue/byspace/internal/diff"
	"github.com/ByteTrue/byspace/internal/workspace"
)

// decodeBodyFiles is the client reading of a Bodies frame: one ParsedDiffFile per entry.
func decodeBodyFiles(t *testing.T, frame []byte) map[string]workspace.ParsedDiffFile {
	t.Helper()
	if frame[0] != diffframes.OpcodeBodies {
		t.Fatalf("opcode = %x, want bodies", frame[0])
	}
	offset := 2 + int(frame[1])
	count := binary.BigEndian.Uint32(frame[offset:])
	offset += 4
	files := map[string]workspace.ParsedDiffFile{}
	for range count {
		pathLen := int(binary.BigEndian.Uint16(frame[offset:]))
		offset += 2
		path := string(frame[offset : offset+pathLen])
		offset += pathLen
		bodyLen := int(binary.BigEndian.Uint32(frame[offset:]))
		offset += 4
		var file workspace.ParsedDiffFile
		if err := json.Unmarshal(frame[offset:offset+bodyLen], &file); err != nil {
			t.Fatal(err)
		}
		offset += bodyLen
		files[path] = file
	}
	if offset != len(frame) {
		t.Fatalf("trailing bytes after %d files", count)
	}
	return files
}

// Two files change, then only one does. The second revision must carry one body, because the
// client keeps the other file from the revision it already has.
func TestDiffSubscriptionSendsOnlyChangedBodies(t *testing.T) {
	dir := t.TempDir()
	gitInit(t, dir)
	writeRepoFile(t, dir, "a.txt", "one\n")
	writeRepoFile(t, dir, "b.txt", "two\n")
	gitIn(t, dir, "add", ".")
	gitIn(t, dir, "commit", "-m", "seed")
	writeRepoFile(t, dir, "a.txt", "one\nedited\n")
	writeRepoFile(t, dir, "b.txt", "two\nedited\n")

	srv := newTestServer(t, t.TempDir())
	sink := addTestClient(srv)
	srv.RegisterDiffSubscription("diff_1", sink, dir, map[string]any{"mode": "uncommitted"})
	t.Cleanup(func() { srv.UnregisterDiffSubscription("diff_1") })

	waitForDiffUpdate(t, sink, func(payload map[string]any) bool {
		return addedLines(payload, "a.txt") == 1 && addedLines(payload, "b.txt") == 1
	})

	writeRepoFile(t, dir, "a.txt", "one\nedited\nagain\n")
	srv.markWorkingTreeChange(dir)
	waitForDiffUpdate(t, sink, func(payload map[string]any) bool {
		return addedLines(payload, "a.txt") == 2 && addedLines(payload, "b.txt") == 1
	})

	frames := sink.binarySnapshot()
	for i := len(frames) - 1; i >= 0; i-- {
		if frames[i][0] != diffframes.OpcodeBodies {
			continue
		}
		bodies := decodeBodyFiles(t, frames[i])
		if len(bodies) != 1 || bodies["a.txt"].Additions != 2 {
			t.Fatalf("the second revision resent %v, want only a.txt", bodies)
		}
		return
	}
	t.Fatal("no Bodies frame was sent")
}

func TestEncodeDiffFramesRoundTrip(t *testing.T) {
	header := diffframes.BeginHeader{
		Revision: 7,
		Cwd:      "/repo",
		Compare:  map[string]any{"mode": "uncommitted"},
		Resolved: diffframes.Resolved{BaseSha: "a", HeadSha: "b", MergeBaseSha: "c"},
		Entries:  []string{"a.txt"},
	}
	frame, err := diffframes.EncodeBegin("sub_1", header)
	if err != nil {
		t.Fatal(err)
	}
	if frame[0] != diffframes.OpcodeBegin || int(frame[1]) != len("sub_1") {
		t.Fatalf("unexpected begin layout %x", frame[:2])
	}
	var decoded diffframes.BeginHeader
	if err := json.Unmarshal(frame[2+len("sub_1"):], &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Revision != 7 || decoded.Entries[0] != "a.txt" {
		t.Fatalf("decoded %+v", decoded)
	}
	if _, err := diffframes.EncodeBegin("", header); err == nil {
		t.Fatal("an empty subscription id must be refused")
	}
	bodies, err := diffframes.EncodeBodies("sub_1", []workspace.ParsedDiffFile{{Path: "a.txt", Additions: 3}})
	if err != nil {
		t.Fatal(err)
	}
	if decodeBodyFiles(t, bodies)["a.txt"].Additions != 3 {
		t.Fatal("the body did not round-trip")
	}
	if _, err := diffframes.EncodeEnd("sub_1", diffframes.EndTrailer{Revision: 7}); err != nil {
		t.Fatal(err)
	}
}
