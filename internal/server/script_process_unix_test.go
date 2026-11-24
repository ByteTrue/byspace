//go:build !windows

package server

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/terminal"
)

func TestStopWorkspaceScriptAwaitsGracefulTreeShutdown(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "stopped")
	sess, err := terminal.StartSession(terminal.StartOptions{
		Command: "/bin/sh",
		Args:    []string{"-c", "trap 'echo stopped > \"" + marker + "\"; exit 0' TERM; sleep 300 & wait"},
	})
	if err != nil {
		t.Skip("cannot spawn /bin/sh:", err)
	}
	t.Cleanup(func() { _ = sess.Close() })
	srv := &Server{workspaceScripts: map[string]*workspaceScript{}}
	entry := &workspaceScript{WorkspaceID: "ws", Name: "dev", Status: "running", sess: sess}
	srv.workspaceScripts[srv.scriptKey("ws", "dev")] = entry
	time.Sleep(200 * time.Millisecond)

	srv.stopWorkspaceScript("ws", "dev")
	if _, err := os.Stat(marker); err != nil {
		t.Fatalf("script stop returned before its graceful handler completed: %v", err)
	}
}
