package providers

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/execres"
)

// A bare provider name has to resolve through the standard install dirs a desktop daemon does
// not inherit over PATH (here, a user-local binary in a home that is not on PATH).
func TestStartProviderSessionResolvesUserLocalCommand(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses shell scripts")
	}
	home := t.TempDir()
	localBin := filepath.Join(home, ".local", "bin")
	if err := os.MkdirAll(localBin, 0o755); err != nil {
		t.Fatal(err)
	}
	// The launch returns as soon as the process is spawned, so the marker is the evidence that
	// the resolved executable actually ran; an exit status cannot distinguish a failed launch from
	// a provider that started and quit.
	marker := filepath.Join(home, "launched")
	command := filepath.Join(localBin, "pi")
	if err := os.WriteFile(command, []byte("#!/bin/sh\n: > '"+marker+"'\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	t.Setenv("PATH", t.TempDir())

	sess, err := StartProviderSession(LaunchConfig{Provider: "pi"})
	if err != nil {
		t.Fatalf("launch failed to use the resolved executable: %v", err)
	}
	defer sess.Close()

	deadline := time.Now().Add(2 * time.Second)
	for {
		if _, statErr := os.Stat(marker); statErr == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the resolved provider executable did not run")
		}
		time.Sleep(10 * time.Millisecond)
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
