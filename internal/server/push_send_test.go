package server

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/ByteTrue/byspace/internal/home"
)

func pushServer(t *testing.T) *Server {
	t.Helper()
	tmp := t.TempDir()
	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "test", PiCommand: writeFaithfulFakePi(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	return srv
}

// A browser-shaped token is a subscription; an Expo token is not, and must not be treated as one.
func TestSendPushToSubscriptions(t *testing.T) {
	srv := pushServer(t)

	var mu sync.Mutex
	var gotAuth, gotEncoding string
	var gotBody []byte
	ts := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		gotAuth = r.Header.Get("Authorization")
		gotEncoding = r.Header.Get("Content-Encoding")
		gotBody, _ = io.ReadAll(r.Body)
		mu.Unlock()
		w.WriteHeader(http.StatusCreated)
	}))
	defer ts.Close()
	// The harness serves a self-signed certificate; a real push service is https with a valid
	// chain, so only the transport needs relaxing here.
	srv.pushHTTPClient = &http.Client{Transport: &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}}

	uaKey, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	auth := make([]byte, 16)
	_, _ = rand.Read(auth)
	token, _ := json.Marshal(map[string]any{
		"endpoint": ts.URL + "/push/abc",
		"keys": map[string]string{
			"p256dh": base64.RawURLEncoding.EncodeToString(uaKey.PublicKey().Bytes()),
			"auth":   base64.RawURLEncoding.EncodeToString(auth),
		},
	})
	// One real subscription plus an Expo token that must be skipped.
	tokens := []string{string(token), "ExponentPushToken[xyz]"}
	raw, _ := json.Marshal(tokens)
	if err := home.WriteAtomic(filepath.Join(srv.HomeDir(), "push-tokens.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}

	delivered := srv.sendPushToAllTokens(context.Background(), map[string]any{"title": "hi"})
	if delivered != 1 {
		t.Fatalf("delivered = %d, want 1 (the Expo token must be skipped)", delivered)
	}

	mu.Lock()
	defer mu.Unlock()
	if gotEncoding != "aes128gcm" {
		t.Fatalf("Content-Encoding = %q", gotEncoding)
	}
	if !strings.HasPrefix(gotAuth, "vapid t=") {
		t.Fatalf("Authorization = %q", gotAuth)
	}
	if len(gotBody) < 100 {
		t.Fatalf("body too small: %d bytes", len(gotBody))
	}
	if strings.Contains(string(gotBody), `"title"`) {
		t.Fatal("payload must not appear in plaintext")
	}
}

// A 410 means the browser unsubscribed; retrying forever wastes a round trip per notification.
func TestSendPushPrunesGoneSubscriptions(t *testing.T) {
	srv := pushServer(t)
	ts := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusGone)
	}))
	defer ts.Close()
	srv.pushHTTPClient = &http.Client{Transport: &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}}

	uaKey, _ := ecdh.P256().GenerateKey(rand.Reader)
	auth := make([]byte, 16)
	_, _ = rand.Read(auth)
	token, _ := json.Marshal(map[string]any{
		"endpoint": ts.URL + "/push/gone",
		"keys": map[string]string{
			"p256dh": base64.RawURLEncoding.EncodeToString(uaKey.PublicKey().Bytes()),
			"auth":   base64.RawURLEncoding.EncodeToString(auth),
		},
	})
	keep := "ExponentPushToken[keep]"
	raw, _ := json.Marshal([]string{string(token), keep})
	if err := home.WriteAtomic(filepath.Join(srv.HomeDir(), "push-tokens.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}

	if delivered := srv.sendPushToAllTokens(context.Background(), map[string]any{"title": "x"}); delivered != 0 {
		t.Fatalf("delivered = %d", delivered)
	}

	remaining := srv.readPushTokens()
	if len(remaining) != 1 || remaining[0] != keep {
		t.Fatalf("gone subscription was not pruned: %v", remaining)
	}
}

// Errors never push: a failing provider would notify on every retry.
func TestNotifyAttentionSkipsErrors(t *testing.T) {
	srv := pushServer(t)
	// No tokens, so this only asserts it does not panic and does not attempt delivery for an
	// error reason. The policy itself is covered in internal/attention.
	srv.notifyAttention("agt_x", AttentionReasonError, "t", "b")
	if _, err := os.Stat(filepath.Join(srv.HomeDir(), "push-tokens.json")); err == nil {
		t.Fatal("nothing should have been written")
	}
}
