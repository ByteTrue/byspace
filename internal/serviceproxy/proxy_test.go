package serviceproxy

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func strPtr(value string) *string { return &value }

// The hostname carries the script, the branch (when not the default) and the project, so one
// browser tab is enough to know what you are looking at.
func TestBuildProxyLabel(t *testing.T) {
	cases := []struct {
		service ServiceIdentity
		want    string
	}{
		{ServiceIdentity{ProjectSlug: "byspace", ScriptName: "dev", BranchName: nil}, "dev--byspace"},
		{ServiceIdentity{ProjectSlug: "byspace", ScriptName: "dev", BranchName: strPtr("main")}, "dev--byspace"},
		{ServiceIdentity{ProjectSlug: "byspace", ScriptName: "dev", BranchName: strPtr("master")}, "dev--byspace"},
		{ServiceIdentity{ProjectSlug: "byspace", ScriptName: "dev", BranchName: strPtr("feat/login")}, "dev--feat-login--byspace"},
		{ServiceIdentity{ProjectSlug: "BySpace", ScriptName: "Dev Server", BranchName: nil}, "dev-server--byspace"},
	}
	for _, c := range cases {
		if got := BuildProxyLabel(c.service); got != c.want {
			t.Fatalf("service %+v → %q, want %q", c.service, got, c.want)
		}
	}
}

// Accents are stripped rather than hyphenated: "café" must stay recognisable.
func TestToHostnameLabel(t *testing.T) {
	cases := map[string]string{
		"Café":       "cafe",
		"naïve app":  "naive-app",
		"  padded  ": "padded",
		"a--b":       "a-b",
		"UPPER":      "upper",
		"a.b/c":      "a-b-c",
		"":           "untitled",
		"!!!":        "untitled",
	}
	for input, want := range cases {
		if got := ToHostnameLabel(input); got != want {
			t.Fatalf("ToHostnameLabel(%q) = %q, want %q", input, got, want)
		}
	}
}

// A long label is shortened with a digest, so two names sharing a prefix do not collide on one
// hostname.
func TestCapDNSLabel(t *testing.T) {
	short := "dev--byspace"
	if got := CapDNSLabel(short); got != short {
		t.Fatalf("short label changed: %q", got)
	}

	long := strings.Repeat("a", 120)
	capped := CapDNSLabel(long)
	if len(capped) > MaxDNSLabelLength {
		t.Fatalf("length %d exceeds the DNS limit", len(capped))
	}
	if !strings.Contains(capped, "--") {
		t.Fatalf("the digest suffix is missing: %q", capped)
	}

	// Two long names that share a prefix must not collide.
	other := strings.Repeat("a", 119) + "b"
	if CapDNSLabel(long) == CapDNSLabel(other) {
		t.Fatal("distinct long labels produced the same hostname")
	}
}

func TestBuildLocalAndPublicHostname(t *testing.T) {
	service := ServiceIdentity{ProjectSlug: "byspace", ScriptName: "dev"}
	if got := BuildLocalHostname(service); got != "dev--byspace.localhost" {
		t.Fatalf("local = %q", got)
	}
	public, err := BuildPublicHostname("https://apps.example.com", service)
	if err != nil {
		t.Fatal(err)
	}
	if public != "dev--byspace.apps.example.com" {
		t.Fatalf("public = %q", public)
	}
	full, err := BuildPublicURL("https://apps.example.com:8443", service)
	if err != nil {
		t.Fatal(err)
	}
	if full != "https://dev--byspace.apps.example.com:8443" {
		t.Fatalf("url = %q", full)
	}
}

// The host header carries a port and different case; the route has to match anyway.
func TestLookupStripsPortAndCase(t *testing.T) {
	p := NewProxy("", t.Logf)
	p.Register(Route{Hostname: "dev--byspace.localhost", Port: 3000, WorkspaceID: "w1", ScriptName: "dev"})

	if route, ok := p.Lookup("dev--byspace.localhost:6778"); !ok || route.Port != 3000 {
		t.Fatalf("port-stripping lookup failed: %+v ok=%v", route, ok)
	}
	if route, ok := p.Lookup("DEV--BySpace.localhost"); !ok || route.Port != 3000 {
		t.Fatalf("case-insensitive lookup failed: %+v ok=%v", route, ok)
	}
	if _, ok := p.Lookup("other.localhost"); ok {
		t.Fatal("an unregistered host must not match")
	}
}

// The proxy forwards to the script's port and preserves the hostname, because a dev server builds
// absolute URLs and its HMR handshake from it.
func TestProxyForwardsAndPreservesHost(t *testing.T) {
	var seenHost, seenForwarded string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenHost = r.Host
		seenForwarded = r.Header.Get("X-Forwarded-Host")
		_, _ = io.WriteString(w, "from upstream")
	}))
	defer upstream.Close()

	port := portOf(t, upstream.URL)
	p := NewProxy("", t.Logf)
	p.Register(Route{Hostname: "dev--byspace.localhost", Port: port, WorkspaceID: "w", ScriptName: "dev"})

	front := httptest.NewServer(p)
	defer front.Close()

	request, err := http.NewRequest(http.MethodGet, front.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Host = "dev--byspace.localhost"
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()

	body, _ := io.ReadAll(response.Body)
	if string(body) != "from upstream" {
		t.Fatalf("body = %q", body)
	}
	if seenHost != "dev--byspace.localhost" || seenForwarded != "dev--byspace.localhost" {
		t.Fatalf("host = %q forwarded = %q", seenHost, seenForwarded)
	}
}

// An unregistered hostname gets a 404 rather than a default app: answering with something else
// makes a typo look like a broken service.
func TestProxyUnknownHostIsNotFound(t *testing.T) {
	p := NewProxy("", t.Logf)
	front := httptest.NewServer(p)
	defer front.Close()

	request, _ := http.NewRequest(http.MethodGet, front.URL, nil)
	request.Host = "nobody.localhost"
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d", response.StatusCode)
	}
}

// A stale route forwards to a port that may now belong to another workspace, which is worse than
// a 404.
func TestUnregisterScriptRemovesItsRoutes(t *testing.T) {
	p := NewProxy("", t.Logf)
	p.Register(Route{Hostname: "a.localhost", Port: 1, WorkspaceID: "w1", ScriptName: "dev"})
	p.Register(Route{Hostname: "b.localhost", Port: 2, WorkspaceID: "w1", ScriptName: "api"})
	p.Register(Route{Hostname: "c.localhost", Port: 3, WorkspaceID: "w2", ScriptName: "dev"})

	p.UnregisterScript("w1", "dev")
	if _, ok := p.Lookup("a.localhost"); ok {
		t.Fatal("route survived unregister")
	}
	if _, ok := p.Lookup("b.localhost"); !ok {
		t.Fatal("another script of the same workspace was removed")
	}
	if _, ok := p.Lookup("c.localhost"); !ok {
		t.Fatal("another workspace's route was removed")
	}
}

// portOf extracts the port from a test server URL.
func portOf(t *testing.T, rawURL string) int {
	t.Helper()
	_, portPart, err := net.SplitHostPort(strings.TrimPrefix(rawURL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	var port int
	if _, err := fmt.Sscanf(portPart, "%d", &port); err != nil {
		t.Fatal(err)
	}
	return port
}
