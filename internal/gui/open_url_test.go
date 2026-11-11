//go:build !nogui

package gui

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The desktop shell is the only place that can open the system browser; the webview has no
// address bar, so a link it navigates to replaces the app.
func TestDesktopOpenURL(t *testing.T) {
	opened := make([]string, 0, 1)
	handler := withDesktopOpenURL(
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusTeapot)
		}),
		func(target string) error {
			opened = append(opened, target)
			return nil
		},
	)

	post := func(body string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/_byspace/desktop/open-url", strings.NewReader(body))
		handler.ServeHTTP(recorder, request)
		return recorder
	}

	if recorder := post(`{"url":"https://example.com/x"}`); recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", recorder.Code)
	}
	if len(opened) != 1 || opened[0] != "https://example.com/x" {
		t.Fatalf("opened = %v, want the https URL", opened)
	}

	for _, body := range []string{
		`{"url":"file:///etc/passwd"}`,
		`{"url":"javascript:alert(1)"}`,
		`{"url":""}`,
	} {
		if recorder := post(body); recorder.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", body, recorder.Code)
		}
	}
	if len(opened) != 1 {
		t.Fatalf("a rejected URL reached the browser: %v", opened)
	}

	unavailable := withDesktopOpenURL(
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusTeapot)
		}),
		nil,
	)
	recorder := httptest.NewRecorder()
	unavailable.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/_byspace/desktop/open-url", strings.NewReader(`{"url":"https://example.com"}`)))
	if recorder.Code != http.StatusServiceUnavailable {
		t.Errorf("missing opener: status = %d, want 503", recorder.Code)
	}

	// Everything that is not this endpoint keeps going to the desktop API.
	recorder = httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/_byspace/desktop/settings", nil))
	if recorder.Code != http.StatusTeapot {
		t.Fatalf("pass-through status = %d, want the next handler's", recorder.Code)
	}
}
