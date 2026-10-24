package workspace

import "testing"

// `web-app` and `web app` both normalize to WEB_APP; two scripts mapping to one name would
// silently shadow each other's port.
func TestNormalizeServiceEnvName(t *testing.T) {
	cases := map[string]string{
		"web":      "WEB",
		"web-app":  "WEB_APP",
		"web app":  "WEB_APP",
		"api_v2":   "API_V2",
		"  --x-- ": "X",
	}
	for input, want := range cases {
		if got := NormalizeServiceEnvName(input); got != want {
			t.Fatalf("NormalizeServiceEnvName(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestAssertNoServiceEnvNameCollisions(t *testing.T) {
	if err := AssertNoServiceEnvNameCollisions([]string{"web", "api"}); err != nil {
		t.Fatalf("distinct names must pass: %v", err)
	}
	err := AssertNoServiceEnvNameCollisions([]string{"web app", "web-app"})
	if err == nil {
		t.Fatal("expected a collision error")
	}
}

// A loopback-bound daemon keeps its scripts on loopback: binding 0.0.0.0 would expose a dev
// server to the network just because the user opened BySpace.
func TestResolveServiceBindHost(t *testing.T) {
	cases := map[string]string{
		"":                 "127.0.0.1",
		"127.0.0.1:6778":   "127.0.0.1",
		"localhost":        "127.0.0.1",
		"[::1]:6778":       "127.0.0.1",
		"0.0.0.0:6778":     "0.0.0.0",
		"192.168.1.5:6778": "0.0.0.0",
	}
	for input, want := range cases {
		if got := ResolveServiceBindHost(input); got != want {
			t.Fatalf("ResolveServiceBindHost(%q) = %q, want %q", input, got, want)
		}
	}
}

// One script must be able to find its siblings' ports; that is the whole point of the env.
func TestBuildServiceEnv(t *testing.T) {
	env, err := BuildServiceEnv("web", "127.0.0.1:6778", []ServicePeer{
		{ScriptName: "web", Port: 6100},
		{ScriptName: "api", Port: 6200},
	})
	if err != nil {
		t.Fatal(err)
	}
	if env["HOST"] != "127.0.0.1" {
		t.Fatalf("HOST = %q", env["HOST"])
	}
	if env["BYSPACE_PORT"] != "6100" {
		t.Fatalf("BYSPACE_PORT = %q", env["BYSPACE_PORT"])
	}
	if env["BYSPACE_SERVICE_API_PORT"] != "6200" {
		t.Fatalf("sibling port missing: %v", env)
	}
	if env["BYSPACE_SERVICE_WEB_PORT"] != "6100" {
		t.Fatalf("own port as a service entry missing: %v", env)
	}
}

func TestBuildServiceEnvRejectsUnknownSelf(t *testing.T) {
	if _, err := BuildServiceEnv("missing", "", []ServicePeer{{ScriptName: "web", Port: 1}}); err == nil {
		t.Fatal("expected an error when the script is absent from peers")
	}
}
