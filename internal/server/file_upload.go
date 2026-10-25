package server

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/terminal"
)

// Chunked file uploads, ported from server/file-upload.
//
// `file.upload.request` carries only metadata: name, mime, size, modifiedAt. The bytes arrive as
// binary FileBegin/FileChunk/FileEnd frames on the same socket, because a base64 blob inside a
// JSON message would be a third larger and would have to be assembled in memory first.
//
// A half-finished upload is abandoned on a timer: a client that closes the tab mid-transfer must
// not leave a growing directory behind forever.

// StaleUploadTimeout bounds how long an upload may sit without a frame.
const StaleUploadTimeout = 10 * time.Minute

// pendingUpload is one in-flight transfer.
type pendingUpload struct {
	requestID string
	id        string
	fileName  string
	mimeType  string
	declared  int64
	path      string
	received  int64
	file      *os.File
	timer     *time.Timer
	mu        sync.Mutex
}

// beginUpload registers a transfer and creates its staging file.
func (s *Server) beginUpload(requestID, fileName, mimeType string, size int64) (*pendingUpload, error) {
	if strings.TrimSpace(requestID) == "" {
		return nil, fmt.Errorf("upload request id is required")
	}
	safeName := sanitizeUploadFileName(fileName)
	if safeName == "" {
		safeName = "upload.bin"
	}
	var idBytes [8]byte
	_, _ = rand.Read(idBytes[:])
	uploadID := "up_" + hex.EncodeToString(idBytes[:])

	dir := filepath.Join(s.homeDir, "uploads", uploadID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, safeName)
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return nil, err
	}

	upload := &pendingUpload{
		requestID: requestID, id: uploadID, fileName: safeName,
		mimeType: mimeType, declared: size, path: path, file: file,
	}
	upload.timer = time.AfterFunc(StaleUploadTimeout, func() {
		s.abandonUpload(requestID, upload)
	})

	s.mu.Lock()
	if s.pendingUploads == nil {
		s.pendingUploads = make(map[string]*pendingUpload)
	}
	// A repeated request id replaces the previous attempt: the client retried, and keeping both
	// would leave an orphan directory.
	if previous, exists := s.pendingUploads[requestID]; exists {
		s.abandonLocked(previous)
	}
	s.pendingUploads[requestID] = upload
	s.mu.Unlock()
	return upload, nil
}

// abandonUpload drops a transfer whose timer fired.
func (s *Server) abandonUpload(requestID string, upload *pendingUpload) {
	s.mu.Lock()
	if current, exists := s.pendingUploads[requestID]; exists && current == upload {
		s.abandonLocked(upload)
		delete(s.pendingUploads, requestID)
	}
	s.mu.Unlock()
}

// abandonLocked closes and removes an upload's staging directory. Callers hold s.mu.
func (s *Server) abandonLocked(upload *pendingUpload) {
	if upload.timer != nil {
		upload.timer.Stop()
	}
	upload.mu.Lock()
	if upload.file != nil {
		_ = upload.file.Close()
		upload.file = nil
	}
	upload.mu.Unlock()
	_ = os.RemoveAll(filepath.Dir(upload.path))
}

// receiveUploadFrame applies one frame and returns a response message when the transfer
// completes.
func (s *Server) receiveUploadFrame(frame *terminal.FileFrame) map[string]any {
	s.mu.Lock()
	upload, exists := s.pendingUploads[frame.RequestID]
	if exists && upload.timer != nil {
		upload.timer.Reset(StaleUploadTimeout)
	}
	s.mu.Unlock()
	if !exists {
		// A frame for an unknown request arrives after the client gave up; dropping it keeps a
		// stale socket from resurrecting an abandoned upload.
		return nil
	}

	upload.mu.Lock()
	defer upload.mu.Unlock()

	switch frame.Opcode {
	case terminal.OpcodeFileBegin:
		// The metadata frame confirms the transfer is starting; the file is already open.
		return nil
	case terminal.OpcodeFileChunk:
		if upload.file == nil {
			return s.failUpload(frame.RequestID, upload, "upload was already closed")
		}
		n, err := upload.file.Write(frame.Payload)
		if err != nil {
			return s.failUpload(frame.RequestID, upload, err.Error())
		}
		upload.received += int64(n)
		return nil
	default:
		return s.finishUpload(frame.RequestID, upload)
	}
}

// finishUpload closes the staging file and reports the uploaded file.
func (s *Server) finishUpload(requestID string, upload *pendingUpload) map[string]any {
	if upload.file != nil {
		_ = upload.file.Sync()
		_ = upload.file.Close()
		upload.file = nil
	}
	s.mu.Lock()
	if current, exists := s.pendingUploads[requestID]; exists && current == upload {
		delete(s.pendingUploads, requestID)
	}
	s.mu.Unlock()
	if upload.timer != nil {
		upload.timer.Stop()
	}

	// A short write relative to the declared size means the client died mid-transfer; reporting
	// success would hand the user a truncated file with no indication.
	if upload.declared > 0 && upload.received != upload.declared {
		_ = os.RemoveAll(filepath.Dir(upload.path))
		return map[string]any{
			"requestId": requestID,
			"file":      nil,
			"error":     fmt.Sprintf("upload incomplete: received %d of %d bytes", upload.received, upload.declared),
		}
	}

	return map[string]any{
		"requestId": requestID,
		"file": map[string]any{
			"type":     "uploaded_file",
			"id":       upload.id,
			"fileName": upload.fileName,
			"mimeType": upload.mimeType,
			"size":     upload.received,
			"path":     upload.path,
		},
		"error": nil,
	}
}

// failUpload reports a write failure and cleans up.
func (s *Server) failUpload(requestID string, upload *pendingUpload, message string) map[string]any {
	if upload.file != nil {
		_ = upload.file.Close()
		upload.file = nil
	}
	s.mu.Lock()
	if current, exists := s.pendingUploads[requestID]; exists && current == upload {
		delete(s.pendingUploads, requestID)
	}
	s.mu.Unlock()
	if upload.timer != nil {
		upload.timer.Stop()
	}
	_ = os.RemoveAll(filepath.Dir(upload.path))
	return map[string]any{"requestId": requestID, "file": nil, "error": message}
}

// sanitizeUploadFileName strips anything that would escape the staging directory.
//
// The name comes from the client and becomes a path component; a value containing separators or
// `..` would write outside `$BYSPACE_HOME/uploads`.
func sanitizeUploadFileName(name string) string {
	base := filepath.Base(strings.TrimSpace(name))
	if base == "." || base == ".." || base == string(filepath.Separator) {
		return ""
	}
	// Control characters are not a filename; they also break the JSON round trip.
	return strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, base)
}
