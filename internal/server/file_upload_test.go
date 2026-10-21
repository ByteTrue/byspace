package server

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/ByteTrue/byspace/internal/terminal"
)

func uploadServer(t *testing.T) *Server {
	t.Helper()
	srv, err := New(Options{HomeDir: t.TempDir(), Version: "test", PiCommand: writeFaithfulFakePi(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	return srv
}

// The bytes arrive as binary frames, not as a JSON data field. Reading a `data` field (which the
// schema does not have) produced an empty file every time.
func TestChunkedUploadWritesFile(t *testing.T) {
	srv := uploadServer(t)
	upload, err := srv.beginUpload("req-1", "note.txt", "text/plain", 11)
	if err != nil {
		t.Fatal(err)
	}

	// Begin frame only confirms the transfer.
	if resp := srv.receiveUploadFrame(&terminal.FileFrame{
		Opcode: terminal.OpcodeFileBegin, RequestID: "req-1",
		Metadata: &terminal.FileBeginMetadata{Mime: "text/plain", Size: 11, Encoding: "binary"},
	}); resp != nil {
		t.Fatalf("begin should not respond: %+v", resp)
	}

	for _, part := range []string{"hello ", "world"} {
		if resp := srv.receiveUploadFrame(&terminal.FileFrame{
			Opcode: terminal.OpcodeFileChunk, RequestID: "req-1", Payload: []byte(part),
		}); resp != nil {
			t.Fatalf("chunk should not respond: %+v", resp)
		}
	}

	resp := srv.receiveUploadFrame(&terminal.FileFrame{Opcode: terminal.OpcodeFileEnd, RequestID: "req-1"})
	if resp == nil {
		t.Fatal("end should produce a response")
	}
	if resp["error"] != nil {
		t.Fatalf("unexpected error: %v", resp["error"])
	}
	file, _ := resp["file"].(map[string]any)
	if file["fileName"] != "note.txt" || file["size"] != int64(11) {
		t.Fatalf("file: %+v", file)
	}

	body, readErr := os.ReadFile(upload.path)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if string(body) != "hello world" {
		t.Fatalf("content = %q", body)
	}
}

// A short write relative to the declared size means the client died mid-transfer; reporting
// success would hand the user a truncated file with no indication.
func TestUploadReportsIncompleteTransfer(t *testing.T) {
	srv := uploadServer(t)
	if _, err := srv.beginUpload("req-2", "big.bin", "application/octet-stream", 100); err != nil {
		t.Fatal(err)
	}
	if resp := srv.receiveUploadFrame(&terminal.FileFrame{
		Opcode: terminal.OpcodeFileChunk, RequestID: "req-2", Payload: []byte("only-a-few"),
	}); resp != nil {
		t.Fatalf("chunk should not respond: %+v", resp)
	}
	resp := srv.receiveUploadFrame(&terminal.FileFrame{Opcode: terminal.OpcodeFileEnd, RequestID: "req-2"})
	if resp == nil || resp["error"] == nil {
		t.Fatalf("incomplete upload must be reported: %+v", resp)
	}
	file, _ := resp["file"].(map[string]any)
	if file != nil {
		t.Fatalf("no file should be reported: %+v", file)
	}
}

// A frame for an unknown request arrives after the client gave up; dropping it keeps a stale
// socket from resurrecting an abandoned upload.
func TestUploadIgnoresUnknownRequest(t *testing.T) {
	srv := uploadServer(t)
	if resp := srv.receiveUploadFrame(&terminal.FileFrame{
		Opcode: terminal.OpcodeFileChunk, RequestID: "never-started", Payload: []byte("x"),
	}); resp != nil {
		t.Fatalf("unknown request should be ignored: %+v", resp)
	}
}

// The name comes from the client and becomes a path component.
func TestSanitizeUploadFileName(t *testing.T) {
	cases := map[string]string{
		"note.txt":           "note.txt",
		"../../etc/passwd":   "passwd",
		"/abs/path/file.png": "file.png",
		"with\x00null":       "withnull",
		"..":                 "",
		".":                  "",
	}
	for input, want := range cases {
		if got := sanitizeUploadFileName(input); got != want {
			t.Fatalf("sanitizeUploadFileName(%q) = %q, want %q", input, got, want)
		}
	}
}

// A client that retries the same request id must not leave an orphan directory behind.
func TestUploadReplacesPreviousAttempt(t *testing.T) {
	srv := uploadServer(t)
	first, err := srv.beginUpload("req-3", "a.txt", "text/plain", 1)
	if err != nil {
		t.Fatal(err)
	}
	firstDir := filepath.Dir(first.path)

	second, err := srv.beginUpload("req-3", "a.txt", "text/plain", 1)
	if err != nil {
		t.Fatal(err)
	}
	if second.id == first.id {
		t.Fatal("the retry should get its own staging directory")
	}
	if _, statErr := os.Stat(firstDir); statErr == nil {
		t.Fatal("the previous attempt's directory was left behind")
	}
}
