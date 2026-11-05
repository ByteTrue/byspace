package providers

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/ByteTrue/byspace/internal/execres"
)

func TestStartProviderSessionResolvesUserLocalCommand(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses shell scripts")
	}
	home := t.TempDir()
	localBin := filepath.Join(home, ".local", "bin")
	if err := os.MkdirAll(localBin, 0o755); err != nil {
		t.Fatal(err)
	}
	command := filepath.Join(localBin, "pi")
	if err := os.WriteFile(command, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	t.Setenv("PATH", t.TempDir())

	_, err := StartProviderSession(LaunchConfig{Provider: "pi"})
	if err == nil {
		t.Fatal("the stub provider should exit instead of completing RPC initialization")
	}
	if _, statErr := os.Stat(command); statErr != nil {
		t.Fatalf("launch did not resolve the user-local executable: %v", statErr)
	}
	if resolved := ResolveProviderCommand(context.Background(), "pi"); resolved != command {
		t.Fatalf("launch resolver = %q, want %q", resolved, command)
	}
}

func TestProviderEnvironmentFindsInterpreterWithoutShellPath(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses /usr/bin/env")
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node.js is not installed")
	}
	home := t.TempDir()
	localBin := filepath.Join(home, ".local", "bin")
	if err := os.MkdirAll(localBin, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(node, filepath.Join(localBin, "node")); err != nil {
		t.Fatal(err)
	}
	command := filepath.Join(localBin, "provider")
	if err := os.WriteFile(command, []byte("#!/usr/bin/env node\nprocess.stdout.write('ready')\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	cmd := exec.Command(command)
	cmd.Env = execres.AppendStandardDirs([]string{"PATH=/usr/bin:/bin:/usr/sbin:/sbin"})
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("provider interpreter lookup failed: %v: %s", err, output)
	}
	if string(output) != "ready" {
		t.Fatalf("provider output = %q, want ready", output)
	}
}
