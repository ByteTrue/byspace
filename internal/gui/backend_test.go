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

func TestLightStepMatchesMagpieRule(t *testing.T) {
	type look struct {
		on, shown, release bool
	}
	for name, looks := range map[string][]look{
		"closed":        {{true, false, false}, {true, false, true}},
		"off":           {{false, false, false}, {false, false, false}, {false, false, false}},
		"shown":         {{true, true, false}, {true, true, false}, {true, true, false}},
		"shown between": {{true, false, false}, {true, true, false}, {true, false, false}, {true, false, true}},
		"turned off":    {{true, false, false}, {false, false, false}, {true, false, false}, {true, false, true}},
	} {
		ticks := 0
		for i, l := range looks {
			var release bool
			ticks, release = LightStep(l.on, l.shown, ticks)
			if release != l.release {
				t.Fatalf("%s: look %d released=%v, want %v", name, i, release, l.release)
			}
			if release {
				ticks = 0
			}
		}
	}
}

func TestIdleAtRequiresNoActiveAgentsUnfocusedWindowAndSettleElapsed(t *testing.T) {
	now := time.Now()
	if IdleAt(true, false, now, now, 10*time.Second) {
		t.Fatal("must not be idle while an agent is running")
	}
	if IdleAt(false, true, time.Time{}, now, 10*time.Second) {
		t.Fatal("must not be idle while the window is focused in the foreground")
	}
	if IdleAt(false, false, now.Add(-5*time.Second), now, 10*time.Second) {
		t.Fatal("must not be idle before the 10s settle window has elapsed")
	}
	if !IdleAt(false, false, now.Add(-11*time.Second), now, 10*time.Second) {
		t.Fatal("expected idle once agents finished >10s ago and window is unfocused")
	}
}

func TestDesktopSettingsDefaultsAndPersistence(t *testing.T) {
	dir := t.TempDir()
	def := LoadDesktopSettings(dir)
	if def.Lightweight || def.NoAutoUpdate || def.NoAutoDownload || def.AutoRestart {
		t.Fatalf("expected all booleans false by default (matching magpie), got %+v", def)
	}
	want := DesktopSettings{
		Lightweight:    true,
		NoAutoDownload: true,
		AutoRestart:    true,
		WindowWidth:    1440,
		WindowHeight:   900,
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

func TestDockStepAndShouldShowInDock(t *testing.T) {
	if got := DockStep(true, true, true); got != (dockMove{}) {
		t.Fatalf("already regular: got %+v", got)
	}
	if got := DockStep(false, true, true); got != (dockMove{policy: true, again: true, front: true}) {
		t.Fatalf("joining Dock to front must set again=true: got %+v", got)
	}
	if !ShouldShowInDock(DesktopSettings{HideFromDock: false}, false, false) {
		t.Fatal("when HideFromDock is false, app stays in Dock even when window is hidden")
	}
	if ShouldShowInDock(DesktopSettings{HideFromDock: true}, false, false) {
		t.Fatal("when HideFromDock is true and window is hidden, app should leave Dock")
	}
	if !ShouldShowInDock(DesktopSettings{HideFromDock: true}, true, false) {
		t.Fatal("when window is shown, app should be in Dock")
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
