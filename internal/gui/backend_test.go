package gui

import (
	"fmt"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/daemon"
	"github.com/ByteTrue/byspace/internal/store"
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

func TestIdleAtRequiresNoActiveAgentsAndSettleElapsed(t *testing.T) {
	now := time.Now()
	if IdleAt(true, now, now, 10*time.Second) {
		t.Fatal("must not be idle while an agent is running")
	}
	if IdleAt(false, now.Add(-5*time.Second), now, 10*time.Second) {
		t.Fatal("must not be idle before the 10s settle window has elapsed")
	}
	if !IdleAt(false, now.Add(-11*time.Second), now, 10*time.Second) {
		t.Fatal("expected idle once agents finished >10s ago")
	}
}

func TestDesktopSettingsDefaultsAndPersistence(t *testing.T) {
	dir := t.TempDir()
	def := LoadDesktopSettings(dir)
	if def.NoAutoUpdate || def.NoAutoDownload || def.AutoRestart {
		t.Fatalf("expected all booleans false by default, got %+v", def)
	}
	want := DesktopSettings{
		NoAutoDownload: true,
		AutoRestart:    true,
	}
	if err := SaveDesktopSettings(dir, want); err != nil {
		t.Fatalf("SaveDesktopSettings: %v", err)
	}
	got := LoadDesktopSettings(dir)
	if got != want {
		t.Fatalf("LoadDesktopSettings = %+v, want %+v", got, want)
	}
	if got.EffectiveKeepAwake() != "system" {
		t.Fatalf("expected default EffectiveKeepAwake=system, got %s", got.EffectiveKeepAwake())
	}
}

func TestClientUpdaterNeverDownloadsSameOrOlderVersion(t *testing.T) {
	u := &ClientUpdater{
		Version: "0.23.1",
		HomeDir: t.TempDir(),
		state:   "latest",
	}
	// Calling DownloadFound when state is "latest" (or when no newer release exists) must be a no-op.
	u.DownloadFound()
	if st, _ := u.State(); st != "latest" {
		t.Fatalf("expected state to remain 'latest', got %q", st)
	}
}

// The desktop app must bind the address the settings page saved, and dial it through loopback.
func TestResolveDesktopListenAddr(t *testing.T) {
	t.Setenv("BYSPACE_LISTEN", "")
	t.Setenv("BYSPACE_PORT", "")
	homeDir := t.TempDir()
	if got := ResolveDesktopListenAddr(homeDir); got != defaultDesktopDaemonAddr {
		t.Fatalf("fresh home = %q, want %q", got, defaultDesktopDaemonAddr)
	}
	store.New(homeDir).SaveDaemonConfig(map[string]any{"listen": "0.0.0.0:6777"})
	got := ResolveDesktopListenAddr(homeDir)
	if got != "0.0.0.0:6777" {
		t.Fatalf("saved home = %q, want the saved listen target", got)
	}
	if dial := daemon.DialAddress(got); dial != "127.0.0.1:6777" {
		t.Fatalf("dial address = %q, want loopback", dial)
	}
}
