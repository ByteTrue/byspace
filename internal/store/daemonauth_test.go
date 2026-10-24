package store

import (
	"os"
	"path/filepath"
	"testing"
)

// A home written by the node daemon stores the hash under `auth.password`. Reading any other
// key silently turns the password off on upgrade, so this pins the name.
func TestLoadDaemonConfigReadsTheNodePasswordField(t *testing.T) {
	dir := t.TempDir()
	hash, err := HashDaemonPassword("hunter2")
	if err != nil {
		t.Fatalf("HashDaemonPassword: %v", err)
	}
	body := `{"version":1,"daemon":{"auth":{"password":"` + hash + `"}}}`
	if err := os.WriteFile(filepath.Join(dir, "config.json"), []byte(body), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	s := New(dir)
	if got := s.DaemonPasswordHash(); got != hash {
		t.Fatalf("DaemonPasswordHash() = %q, want the stored hash", got)
	}
	auth, _ := s.LoadDaemonConfig()["auth"].(map[string]any)
	if auth["passwordSet"] != true {
		t.Fatalf("auth.passwordSet = %v, want true", auth["passwordSet"])
	}
	if _, leaked := auth[daemonPasswordHashKey]; leaked {
		t.Fatal("the hash must never appear in the config the wire sees")
	}
}

func TestSetDaemonPasswordHashRoundTripsAndClears(t *testing.T) {
	dir := t.TempDir()
	s := New(dir)

	hash, err := HashDaemonPassword("hunter2")
	if err != nil {
		t.Fatalf("HashDaemonPassword: %v", err)
	}
	if err := s.SetDaemonPasswordHash(hash); err != nil {
		t.Fatalf("SetDaemonPasswordHash: %v", err)
	}
	if !VerifyDaemonPassword(s.DaemonPasswordHash(), "hunter2") {
		t.Fatal("the stored hash must verify")
	}

	if err := s.SetDaemonPasswordHash(""); err != nil {
		t.Fatalf("SetDaemonPasswordHash(clear): %v", err)
	}
	if got := s.DaemonPasswordHash(); got != "" {
		t.Fatalf("DaemonPasswordHash() after clear = %q, want empty", got)
	}
	auth, _ := s.LoadDaemonConfig()["auth"].(map[string]any)
	if auth["passwordSet"] != false {
		t.Fatalf("auth.passwordSet after clear = %v, want false", auth["passwordSet"])
	}
}

func TestSetDaemonPasswordHashKeepsOtherSettings(t *testing.T) {
	dir := t.TempDir()
	s := New(dir)
	s.SaveDaemonConfig(map[string]any{"appendSystemPrompt": "be brief"})

	hash, _ := HashDaemonPassword("hunter2")
	if err := s.SetDaemonPasswordHash(hash); err != nil {
		t.Fatalf("SetDaemonPasswordHash: %v", err)
	}

	if got := s.LoadDaemonConfig()["appendSystemPrompt"]; got != "be brief" {
		t.Fatalf("appendSystemPrompt = %v, want it preserved", got)
	}
}
