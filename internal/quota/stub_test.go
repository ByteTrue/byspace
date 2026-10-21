package quota

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// stubServer serves body and repoints the provider URL at itself.
func stubServer(t *testing.T, body string, target *string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
	*target = srv.URL
	return srv
}

// stubStatus serves one status code and repoints the provider URL at itself.
func stubStatus(t *testing.T, status int, target *string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
	}))
	*target = srv.URL
	return srv
}
