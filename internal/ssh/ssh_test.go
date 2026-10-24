package ssh

import (
	"strings"
	"testing"
)

// A host starting with `-` is an option injection: `ssh -oProxyCommand=...` in the host position
// is not a host at all.
func TestValidateHostRejectsInjection(t *testing.T) {
	for _, host := range []string{"-oProxyCommand=curl evil", "-lroot", "  ", "a b", "a\tb"} {
		if _, err := ValidateHost(host); err == nil {
			t.Fatalf("%q should be rejected", host)
		}
	}
	good, err := ValidateHost("  user@host.example.com  ")
	if err != nil || good != "user@host.example.com" {
		t.Fatalf("got %q err %v", good, err)
	}
}

func TestParseURI(t *testing.T) {
	target, err := ParseURI("ssh://deploy@build-box:2222?daemonPort=6800")
	if err != nil {
		t.Fatal(err)
	}
	if target.Host != "deploy@build-box" || target.SSHPort != 2222 || target.DaemonPort != 6800 {
		t.Fatalf("%+v", target)
	}

	// The daemon port defaults, so a short URI works.
	plain, err := ParseURI("ssh://build-box")
	if err != nil {
		t.Fatal(err)
	}
	if plain.Host != "build-box" || plain.SSHPort != 0 || plain.DaemonPort != DefaultDaemonPort {
		t.Fatalf("%+v", plain)
	}
}

// Every rejection here is a URI that would otherwise produce a confusing ssh failure.
func TestParseURIRejections(t *testing.T) {
	cases := map[string]string{
		"http://host":                          "scheme",
		"ssh://user:pass@host":                 "password",
		"ssh://host/path":                      "path",
		"ssh://host#frag":                      "fragment",
		"ssh://host?unknown=1":                 "option",
		"ssh://host?daemonPort=1&daemonPort=2": "once",
		"ssh://host?daemonPort=abc":            "number",
		"ssh://host?daemonPort=0":              "between 1",
		"ssh://":                               "required",
	}
	for uri, want := range cases {
		_, err := ParseURI(uri)
		if err == nil {
			t.Fatalf("%q should be rejected", uri)
		}
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("%q: error %q should mention %q", uri, err.Error(), want)
		}
	}
}

// `-W` proxies stdio to a port on the far side, and the options disable everything interactive —
// a prompt would hang a CLI with no terminal.
func TestBuildArgs(t *testing.T) {
	args, err := BuildArgs(Target{Host: "user@host", SSHPort: 2222, DaemonPort: 6777})
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(args, " ")
	for _, want := range []string{
		"-T", "BatchMode=yes", "ConnectTimeout=10", "ClearAllForwardings=yes",
		"ExitOnForwardFailure=yes", "-p 2222", "-W 127.0.0.1:6777", "user@host",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("args %q missing %q", joined, want)
		}
	}

	// Without an explicit SSH port there is no -p, so ssh uses its own default.
	noPort, err := BuildArgs(Target{Host: "host", DaemonPort: 6777})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.Join(noPort, " "), " -p ") {
		t.Fatalf("unexpected -p: %v", noPort)
	}
}

// The far side is reached through -W, so the daemon port is what must be validated.
func TestBuildArgsValidatesPorts(t *testing.T) {
	if _, err := BuildArgs(Target{Host: "host", DaemonPort: 0}); err == nil {
		t.Fatal("daemon port 0 must be rejected")
	}
	if _, err := BuildArgs(Target{Host: "host", DaemonPort: 70000}); err == nil {
		t.Fatal("out-of-range daemon port must be rejected")
	}
	if _, err := BuildArgs(Target{Host: "-oProxyCommand=x", DaemonPort: 6777}); err == nil {
		t.Fatal("an injected host must be rejected")
	}
}

// Open binds immediately and only launches ssh when something dials it.
func TestOpenBindsAndAccepts(t *testing.T) {
	tunnel, err := Open(Target{Host: "127.0.0.1", DaemonPort: 1, SSHPort: 1})
	if err != nil {
		t.Fatal(err)
	}
	defer tunnel.Close()

	if tunnel.Endpoint == "" {
		t.Fatal("no endpoint")
	}
	if !tunnel.WaitForListener(2 * 1e9) {
		t.Fatal("the listener never accepted")
	}
}
