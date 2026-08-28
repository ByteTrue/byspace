package cli

import (
	"bytes"
	"encoding/json"
	"path/filepath"
	"testing"

	"byspace/internal/daemon"
)

func TestRunStatusAndStopWhenStopped(t *testing.T) {
	home := t.TempDir()
	t.Setenv("BYSPACE_HOME", home)

	var stdout, stderr bytes.Buffer
	if code := Run([]string{"daemon", "status", "--json"}, &stdout, &stderr); code != 0 {
		t.Fatalf("status exit = %d, stderr = %q", code, stderr.String())
	}
	var status daemon.Status
	if err := json.Unmarshal(stdout.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	if status.Home != home || status.LocalDaemon != "stopped" {
		t.Fatalf("unexpected status: %+v", status)
	}

	stdout.Reset()
	stderr.Reset()
	if code := Run([]string{"daemon", "stop", "--json"}, &stdout, &stderr); code != 0 {
		t.Fatalf("stop exit = %d, stderr = %q", code, stderr.String())
	}
	var result struct {
		Action string `json:"action"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Action != "not_running" {
		t.Fatalf("stop action = %q", result.Action)
	}
}

func TestResolveRelayURLPrecedence(t *testing.T) {
	t.Setenv("BYSPACE_RELAY_URL", "wss://environment.example")

	got, err := resolveRelayURL("ws://explicit.example:8080/")
	if err != nil {
		t.Fatal(err)
	}
	if got != "ws://explicit.example:8080" {
		t.Fatalf("explicit Relay URL = %q", got)
	}
	got, err = resolveRelayURL("")
	if err != nil {
		t.Fatal(err)
	}
	if got != "wss://environment.example" {
		t.Fatalf("environment Relay URL = %q", got)
	}
}

func TestResolveWebDirPrecedence(t *testing.T) {
	environment := filepath.Join(t.TempDir(), "environment")
	explicit := filepath.Join(t.TempDir(), "explicit")
	t.Setenv("BYSPACE_WEB_DIR", environment)

	got, err := resolveWebDir(explicit)
	if err != nil {
		t.Fatal(err)
	}
	if got != explicit {
		t.Fatalf("explicit Web directory = %q", got)
	}
	got, err = resolveWebDir("")
	if err != nil {
		t.Fatal(err)
	}
	if got != environment {
		t.Fatalf("environment Web directory = %q", got)
	}
}

func TestRunRejectsUnknownCommands(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := Run([]string{"future"}, &stdout, &stderr); code != 2 {
		t.Fatalf("unknown command exit = %d", code)
	}
	if stderr.Len() == 0 {
		t.Fatal("unknown command did not explain the error")
	}
}
