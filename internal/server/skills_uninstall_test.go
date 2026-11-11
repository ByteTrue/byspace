package server

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/ByteTrue/byspace/internal/store"
)

// Uninstall has to record the choice, or a later startup repair installs the bundle again.
//
// It used to remove the directories and leave the stored selection at "all", so the host still
// wanted every bundled skill and the next boot that saw any drift copied them back — the skills
// reappeared after the user had removed them.
func TestUninstallRecordsEmptySelectionSoStartupDoesNotReinstall(t *testing.T) {
	sourceDir := resolveSkillsSourceDir()
	if sourceDir == "" {
		t.Fatal("expected non-empty bundled skills sourceDir")
	}
	// The agent homes the skills are written to live under the user's home.
	userHome := sandboxUserHome(t)
	homeDir := filepath.Join(t.TempDir(), "home")
	skillsDir := filepath.Join(userHome, ".agents", "skills")

	// Seed the host the way accepting "install everything" leaves it, with one copy missing: that
	// drift is exactly what the startup repair repairs.
	store.New(homeDir).SaveDaemonConfig(map[string]any{
		"skillsSelection": map[string]any{"mode": "all"},
	})
	bundle := getSkillsStatus(sourceDir, userHome, map[string]any{"mode": "all"}, SkillTargetIDs)
	if err := applySkillsStatus(sourceDir, userHome, bundle); err != nil {
		t.Fatalf("install: %v", err)
	}
	if len(bundle.Available) == 0 {
		t.Fatal("expected the bundle to ship at least one skill")
	}
	if err := os.RemoveAll(filepath.Join(skillsDir, bundle.Available[0])); err != nil {
		t.Fatal(err)
	}

	srv, err := New(Options{HomeDir: homeDir, Version: "0.0.0-test"})
	if err != nil {
		t.Fatal(err)
	}
	// The startup repair is an explicit entry-point step, not part of constructing the server.
	srv.AutoUpdateInstalledSkills()
	repaired := getSkillsStatus(sourceDir, userHome, map[string]any{"mode": "all"}, SkillTargetIDs)
	if len(repaired.Installed) != len(bundle.Available) {
		t.Fatalf("expected the startup repair to restore the bundle, got %v", repaired.Installed)
	}

	ts := httptest.NewServer(srv)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	_ = ws.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","clientId":"cli_skills","protocolVersion":1}`))
	_ = readUntilSessionType(t, ctx, ws, "status", "server_info")

	frame, _ := json.Marshal(map[string]any{"type": "session", "message": map[string]any{
		"type":      "agent.skills.uninstall.request",
		"requestId": "req_uninstall",
	}})
	if err := ws.Write(ctx, websocket.MessageText, frame); err != nil {
		t.Fatal(err)
	}
	response := readUntilSessionType(t, ctx, ws, "agent.skills.uninstall.response", "")
	selection, _ := response["selection"].(map[string]any)
	skills, _ := selection["skills"].([]any)
	if selection["mode"] != "custom" || len(skills) != 0 {
		t.Fatalf("uninstall reported selection %+v; the host still wants the bundle", selection)
	}
	ws.CloseNow()
	ts.Close()
	srv.Close()

	// The real check: the next startup on the same home must not bring them back.
	restarted, err := New(Options{HomeDir: homeDir, Version: "0.0.0-test"})
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	restarted.AutoUpdateInstalledSkills()
	for _, name := range repaired.Installed {
		path := filepath.Join(skillsDir, name)
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("startup reinstalled %s after the user uninstalled it", path)
		}
	}
}
