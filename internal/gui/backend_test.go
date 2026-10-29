package gui

import (
	"fmt"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestNormalizeDeepLink(t *testing.T) {
	cases := map[string]string{
		"":                        "/",
		"byspace://#offer=abc":    "/#offer=abc",
		"byspace:///offer=abc":    "/#offer=abc",
		"byspace://settings":      "/settings",
		"#offer=xyz":              "/#offer=xyz",
		"https://other.example/x": "/",
	}
	for in, want := range cases {
		if got := NormalizeDeepLink(in); got != want {
			t.Fatalf("NormalizeDeepLink(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDaemonSupervisorAttachesAndTakesOverOnExit(t *testing.T) {
	t.Setenv("BYSPACE_DISABLE_HOME_WORKSPACE", "1")
	homeDir := t.TempDir()

	// 1. Start a fake "external daemon" answering /health on an ephemeral port.
	extLn, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	addr := extLn.Addr().String()
	extMux := http.NewServeMux()
	extMux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"ok":true,"serverId":"srv_external"}`)
	})
	extSrv := &http.Server{Handler: extMux}
	go func() { _ = extSrv.Serve(extLn) }()
	defer extSrv.Close()

	if !ProbeDaemonHealth(addr) {
		t.Fatalf("expected external daemon at %s to answer /health", addr)
	}

	// 2. Start DaemonSupervisor: it must attach without starting an in-process server.
	sup := &DaemonSupervisor{
		Addr:          addr,
		HomeDir:       homeDir,
		Version:       "0.22.0-test",
		WatchInterval: 40 * time.Millisecond,
	}
	if err := sup.Start(); err != nil {
		t.Fatalf("sup.Start: %v", err)
	}
	defer sup.Close()

	if sup.OwnsInProcessDaemon() {
		t.Fatal("expected supervisor to attach to existing daemon, not own in-process server yet")
	}

	// 3. Stop the external daemon: the supervisor's watchLoop must take over the port in-process.
	_ = extSrv.Close()

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if sup.OwnsInProcessDaemon() && ProbeDaemonHealth(addr) {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("expected supervisor to take over %s after external daemon exited (owns=%v, health=%v)",
		addr, sup.OwnsInProcessDaemon(), ProbeDaemonHealth(addr))
}
