package server

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ByteTrue/byspace/internal/serviceproxy"
)

// A registered service hostname is served by the proxy, not by the daemon API.
func TestServiceHostIsProxied(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "app body")
	}))
	defer upstream.Close()
	_, portPart, err := net.SplitHostPort(strings.TrimPrefix(upstream.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}

	srv := newTunnelTestServer(t, nil)
	srv.serviceProxy().Register(serviceproxy.Route{
		Hostname: "dev--byspace.localhost", Port: atoiPort(t, portPart), WorkspaceID: "w", ScriptName: "dev",
	})

	front := httptest.NewServer(srv)
	defer front.Close()

	request, _ := http.NewRequest(http.MethodGet, front.URL, nil)
	request.Host = "dev--byspace.localhost"
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	if string(body) != "app body" {
		t.Fatalf("body = %q", body)
	}
}

// An unregistered hostname still goes to the daemon API, not the proxy.
func TestUnregisteredHostStillHitsDaemon(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	srv.serviceProxy() // create it so the branch is exercised
	front := httptest.NewServer(srv)
	defer front.Close()

	response, err := http.Get(front.URL + "/api/health")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", response.StatusCode)
	}
}

// A service that is not running has no hostname and no URL: the client would otherwise show a
// link that 404s.
func TestStoppedServiceHasNoProxyURL(t *testing.T) {
	payload := workspaceScriptPayload(&workspaceScript{
		WorkspaceID: "w", Name: "dev", IsService: true, Status: "stopped", Port: 3000,
	})
	if payload["hostname"] != "" {
		t.Fatalf("hostname = %v", payload["hostname"])
	}
	if payload["localProxyUrl"] != nil || payload["proxyUrl"] != nil {
		t.Fatalf("URLs = %v / %v", payload["localProxyUrl"], payload["proxyUrl"])
	}
}

// A running service exposes its hostname and a browsable URL.
func TestRunningServiceExposesProxyURL(t *testing.T) {
	entry := &workspaceScript{
		WorkspaceID: "w", Name: "dev", IsService: true, Status: "running", Port: 3000,
		hostname: "dev--byspace.localhost", localProxyURL: "http://dev--byspace.localhost:6778",
	}
	payload := workspaceScriptPayload(entry)
	if payload["hostname"] != "dev--byspace.localhost" {
		t.Fatalf("hostname = %v", payload["hostname"])
	}
	if payload["proxyUrl"] != "http://dev--byspace.localhost:6778" {
		t.Fatalf("proxyUrl = %v", payload["proxyUrl"])
	}
}

// atoiPort parses a port string.
func atoiPort(t *testing.T, value string) int {
	t.Helper()
	port := 0
	for _, r := range value {
		if r < '0' || r > '9' {
			t.Fatalf("not a port: %q", value)
		}
		port = port*10 + int(r-'0')
	}
	return port
}
