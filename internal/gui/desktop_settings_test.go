//go:build !nogui

package gui

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDesktopWindowActionDoesNotPersistSettings(t *testing.T) {
	homeDir := t.TempDir()
	settingsPath := filepath.Join(homeDir, desktopSettingsFile)
	if err := os.WriteFile(settingsPath, []byte(`{"theme":"dark"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	called := ""
	handler := withDesktopSettingsAPI(
		http.NotFoundHandler(), homeDir, nil, nil, nil, nil,
		func(action string) map[string]any { called = action; return nil }, nil, nil, nil,
	)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/_byspace/desktop/window", strings.NewReader(`{"action":"minimize"}`)))
	if recorder.Code != http.StatusOK {
		t.Fatalf("window action returned %d: %s", recorder.Code, recorder.Body.String())
	}
	if called != "minimize" {
		t.Fatalf("window action = %q, want minimize", called)
	}
	content, err := os.ReadFile(settingsPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != `{"theme":"dark"}` {
		t.Fatalf("window action rewrote settings: %s", content)
	}
}
