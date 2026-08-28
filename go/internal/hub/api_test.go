package hub

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestAPIClientDeviceAuthorizationContract(t *testing.T) {
	t.Parallel()
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/api/v1/cli-authorizations" {
			t.Errorf("request = %s %s", request.Method, request.URL.Path)
			writer.WriteHeader(http.StatusNotFound)
			return
		}
		writer.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(writer).Encode(DeviceAuthorization{
			DeviceCode: "device-code", UserCode: "ABCD-EFGH",
			VerificationURI: server.URL + "/cli/authorize", VerificationURIComplete: server.URL + "/cli/authorize?user_code=ABCD-EFGH",
			ExpiresAt: time.Now().Add(10 * time.Minute).UTC().Format(time.RFC3339), Interval: 5,
		})
	}))
	defer server.Close()

	result, err := NewAPIClient().StartAuthorization(context.Background(), server.URL)
	if err != nil {
		t.Fatal(err)
	}
	if result.DeviceCode != "device-code" || result.Interval != 5 {
		t.Fatalf("StartAuthorization() = %+v", result)
	}
}

func TestAPIClientRejectsCrossAuthorityVerificationURL(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(writer).Encode(DeviceAuthorization{
			DeviceCode: "device-code", UserCode: "ABCD-EFGH",
			VerificationURI: "https://attacker.invalid/authorize", VerificationURIComplete: "https://attacker.invalid/authorize?code=ABCD-EFGH",
			ExpiresAt: time.Now().Add(10 * time.Minute).UTC().Format(time.RFC3339), Interval: 5,
		})
	}))
	defer server.Close()
	if _, err := NewAPIClient().StartAuthorization(context.Background(), server.URL); err == nil || !strings.Contains(err.Error(), "verification URL") {
		t.Fatalf("StartAuthorization() error = %v", err)
	}
}

func TestAPIClientRejectsRedirectWithoutForwardingCredential(t *testing.T) {
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

	_, err := NewAPIClient().IssueEnrollmentToken(context.Background(), source.URL, strings.Repeat("c", 32))
	if err == nil || !strings.Contains(err.Error(), "307") {
		t.Fatalf("IssueEnrollmentToken() error = %v", err)
	}
	if targetCalls.Load() != 0 {
		t.Fatalf("redirect target calls = %d", targetCalls.Load())
	}
}
