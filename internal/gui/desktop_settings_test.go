package gui

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDesktopSettingsAPIGetAndPost(t *testing.T) {
	homeDir := t.TempDir()
	takeOverCalled := false
	handler := withDesktopSettingsAPI(
		http.NotFoundHandler(),
		homeDir,
		func() DaemonHostStatus {
			return DaemonHostStatus{InProcess: true, Healthy: true, Addr: "127.0.0.1:6777"}
		},
		func() { takeOverCalled = true },
		nil,
		nil,
	)

	getRec := httptest.NewRecorder()
	handler.ServeHTTP(getRec, httptest.NewRequest(http.MethodGet, "/_byspace/desktop/settings", nil))
	if getRec.Code != http.StatusOK {
		t.Fatalf("GET returned %d: %s", getRec.Code, getRec.Body.String())
	}

	postRec := httptest.NewRecorder()
	handler.ServeHTTP(
		postRec,
		httptest.NewRequest(
			http.MethodPost,
			"/_byspace/desktop/settings",
			strings.NewReader(`{"keepAwake":"display","noAutoDownload":true,"takeOverDaemon":true}`),
		),
	)
	if postRec.Code != http.StatusOK {
		t.Fatalf("POST returned %d: %s", postRec.Code, postRec.Body.String())
	}
	if !takeOverCalled {
		t.Fatal("expected takeOverDaemon to invoke callback")
	}
	var body struct {
		Desktop  bool            `json:"desktop"`
		Settings DesktopSettings `json:"settings"`
	}
	if err := json.Unmarshal(postRec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.Desktop || body.Settings.KeepAwake != "display" || !body.Settings.NoAutoDownload {
		t.Fatalf("unexpected response body: %+v", body)
	}
}

func TestDesktopSettingsRestartToUpdateInvokesAutoRelaunch(t *testing.T) {
	homeDir := t.TempDir()
	relaunchCh := make(chan struct{}, 1)
	updater := &ClientUpdater{
		Version: "0.20.2",
		HomeDir: homeDir,
		AutoRelaunch: func() {
			select {
			case relaunchCh <- struct{}{}:
			default:
			}
		},
	}
	handler := withDesktopSettingsAPI(
		http.NotFoundHandler(),
		homeDir,
		func() DaemonHostStatus {
			return DaemonHostStatus{InProcess: true, Healthy: true, Addr: "127.0.0.1:6777"}
		},
		nil,
		updater,
		nil,
	)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(
		rec,
		httptest.NewRequest(
			http.MethodPost,
			"/_byspace/desktop/settings",
			strings.NewReader(`{"restartToUpdate":true}`),
		),
	)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST returned %d: %s", rec.Code, rec.Body.String())
	}
	<-relaunchCh
}
