package hub

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestDirectRemoteEnrollUsesExactContract(t *testing.T) {
	t.Parallel()
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/daemons/enroll" || request.Method != http.MethodPost {
			t.Fatalf("request = %s %s", request.Method, request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer "+strings.Repeat("t", 32) {
			t.Fatal("missing enrollment bearer")
		}
		var input enrollmentRequest
		if err := json.NewDecoder(request.Body).Decode(&input); err != nil {
			t.Fatal(err)
		}
		if input.DaemonID != "11111111-1111-4111-8111-111111111111" || input.Scopes[0] != executionScope {
			t.Fatalf("input = %+v", input)
		}
		_ = json.NewEncoder(writer).Encode(enrollmentResult{
			DaemonID: input.DaemonID, Scopes: []string{executionScope},
			WebSocketURL: "ws" + strings.TrimPrefix(server.URL, "http") + "/api/daemons/socket",
		})
	}))
	defer server.Close()

	result, err := newDirectRemote().Enroll(context.Background(), enrollmentRequest{
		DaemonID: "11111111-1111-4111-8111-111111111111", IdempotencyKey: "22222222-2222-4222-8222-222222222222",
		HubOrigin: server.URL, Token: strings.Repeat("t", 32), Hostname: "test-host",
		ServerID: "srv_123456789012", DaemonPublicKey: strings.Repeat("a", 44),
		CredentialVerifier: strings.Repeat("v", 43), Scopes: []string{executionScope},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.DaemonID != "11111111-1111-4111-8111-111111111111" || result.Scopes[0] != executionScope {
		t.Fatalf("Enroll() = %+v", result)
	}
}

func TestDirectRemoteEnrollmentRetryAfterIsBounded(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Retry-After", "600")
		writer.WriteHeader(http.StatusTooManyRequests)
	}))
	defer server.Close()

	_, err := newDirectRemote().Enroll(context.Background(), enrollmentRequest{
		HubOrigin: server.URL, Token: strings.Repeat("t", 32),
	})
	var retry *retryAfterError
	if !errors.As(err, &retry) || retry.statusCode != http.StatusTooManyRequests || retry.delay != maxHubRetryAfter {
		t.Fatalf("Enroll() error = %#v", err)
	}
	if parsed := parseRetryAfter(time.Now().Add(time.Minute).UTC().Format(http.TimeFormat)); parsed <= 0 || parsed > time.Minute {
		t.Fatalf("HTTP-date Retry-After = %s", parsed)
	}
}

func TestDirectRemoteRejectsEnrollmentRedirectWithoutForwardingBearer(t *testing.T) {
	t.Parallel()
	var targetCalls atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		targetCalls.Add(1)
	}))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Redirect(writer, request, target.URL, http.StatusTemporaryRedirect)
	}))
	defer source.Close()

	_, err := newDirectRemote().Enroll(context.Background(), enrollmentRequest{
		HubOrigin: source.URL, Token: strings.Repeat("t", 32),
	})
	if err == nil || !strings.Contains(err.Error(), "307") {
		t.Fatalf("Enroll() error = %v", err)
	}
	if targetCalls.Load() != 0 {
		t.Fatalf("redirect target calls = %d", targetCalls.Load())
	}
}

func TestDirectRemoteOpenAuthenticatesSameAuthoritySocket(t *testing.T) {
	t.Parallel()
	accepted := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/daemons/socket" || request.Header.Get("Authorization") != "Bearer "+strings.Repeat("c", 32) {
			t.Fatalf("socket request = %s authorization=%q", request.URL.Path, request.Header.Get("Authorization"))
		}
		if request.Header.Get("x-paseo-daemon-id") != "11111111-1111-4111-8111-111111111111" {
			t.Fatalf("daemon id = %q", request.Header.Get("x-paseo-daemon-id"))
		}
		connection, err := websocket.Accept(writer, request, nil)
		if err != nil {
			t.Error(err)
			return
		}
		close(accepted)
		defer connection.CloseNow()
		_, _, _ = connection.Read(context.Background())
	}))
	defer server.Close()

	socket, _, err := newDirectRemote().Dial(context.Background(), socketRequest{
		DaemonID:     "11111111-1111-4111-8111-111111111111",
		WebSocketURL: "ws" + strings.TrimPrefix(server.URL, "http") + "/api/daemons/socket",
		Credential:   strings.Repeat("c", 32),
	})
	if err != nil {
		t.Fatal(err)
	}
	<-accepted
	if err := socket.Close(websocket.StatusNormalClosure, "test complete"); err != nil {
		t.Fatal(err)
	}
}
