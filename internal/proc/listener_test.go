package proc

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestListeningOnAndIsBySpace(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	pids, err := ListeningOn(context.Background(), port)
	if err != nil {
		t.Fatalf("ListeningOn(%d): %v", port, err)
	}
	if !slices.Contains(pids, os.Getpid()) {
		t.Fatalf("expected pid %d in %v", os.Getpid(), pids)
	}
	gotExe, err := Executable(os.Getpid())
	if err != nil || gotExe == "" {
		t.Fatalf("Executable: %q, %v", gotExe, err)
	}
	_ = ln.Close()

	// Closed port must return empty slice and nil error.
	pidsAfter, err := ListeningOn(context.Background(), port)
	if err != nil || len(pidsAfter) != 0 {
		t.Fatalf("expected no listeners after close, got %v, %v", pidsAfter, err)
	}

	for path, want := range map[string]bool{
		"/Applications/BySpace.app/Contents/MacOS/byspace": true,
		"/usr/local/bin/byspace":                           true,
		"/usr/local/bin/byspace-darwin-arm64":              true,
		`C:\Users\u\.local\bin\byspace.exe`:                true,
		`C:\Users\u\.local\bin\byspace.exe.old-2`:          true,
		"/usr/bin/python3":                                 false,
		filepath.FromSlash("/tmp/other.old-2"):             false,
	} {
		if IsBySpace(path) != want {
			t.Fatalf("IsBySpace(%q) = %v, want %v", path, !want, want)
		}
	}

	if !IsContainerForwarder("/Applications/OrbStack.app/Contents/MacOS/OrbStack Helper") {
		t.Fatal("expected OrbStack Helper to be recognized as container forwarder")
	}
}
