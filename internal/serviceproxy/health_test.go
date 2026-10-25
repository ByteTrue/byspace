package serviceproxy

import (
	"testing"
)

// One dropped probe is a hiccup (a restart, a GC pause). Two consecutive failures are needed
// before a route is called unhealthy, or the badge flaps on every blip.
func TestHealthNeedsTwoFailures(t *testing.T) {
	proxy := NewProxy("", t.Logf)
	proxy.Register(Route{Hostname: "a.localhost", Port: 1, WorkspaceID: "w1", ScriptName: "dev"})

	monitor := NewHealthMonitor(proxy, t.Logf)
	healthy := false
	monitor.Probe = func(int) bool { return healthy }
	monitor.Grace = 0
	monitor.FailuresBeforeUnhealthy = 2

	// First poll: one failure, still pending rather than unhealthy.
	monitor.PollOnce()
	if got := monitor.Health("a.localhost"); got == HealthUnhealthy {
		t.Fatalf("a single failure condemned the route: %q", got)
	}

	// Second poll: now it is unhealthy.
	monitor.PollOnce()
	if got := monitor.Health("a.localhost"); got != HealthUnhealthy {
		t.Fatalf("two failures should be unhealthy, got %q", got)
	}

	// One success clears the failure count, so the next single failure does not condemn it.
	healthy = true
	monitor.PollOnce()
	if got := monitor.Health("a.localhost"); got != HealthHealthy {
		t.Fatalf("a success should mark it healthy, got %q", got)
	}
	healthy = false
	monitor.PollOnce()
	if got := monitor.Health("a.localhost"); got == HealthUnhealthy {
		t.Fatal("one failure after a success must not be unhealthy")
	}
}

// A route younger than the grace period is not probed: the script was told to start and has not
// bound its port yet, so an immediate verdict would flash red on every start.
func TestHealthGracePeriod(t *testing.T) {
	proxy := NewProxy("", t.Logf)
	proxy.Register(Route{Hostname: "b.localhost", Port: 1, WorkspaceID: "w1", ScriptName: "dev"})

	monitor := NewHealthMonitor(proxy, t.Logf)
	monitor.Grace = 1e18 // effectively "never probe"
	probed := false
	monitor.Probe = func(int) bool { probed = true; return false }

	monitor.PollOnce()
	if probed {
		t.Fatal("a route inside the grace period must not be probed")
	}
	if got := monitor.Health("b.localhost"); got != HealthPending {
		t.Fatalf("state = %q", got)
	}
}

// Re-emitting the same health every three seconds is pure noise on the socket.
func TestHealthEmitsOnlyOnChange(t *testing.T) {
	proxy := NewProxy("", t.Logf)
	proxy.Register(Route{Hostname: "c.localhost", Port: 1, WorkspaceID: "w1", ScriptName: "dev"})

	monitor := NewHealthMonitor(proxy, t.Logf)
	monitor.Probe = func(int) bool { return true }
	emitted := 0
	monitor.OnChange = func(string, []Route) { emitted++ }

	monitor.PollOnce() // pending → healthy
	monitor.PollOnce() // healthy → healthy, no change
	monitor.PollOnce()
	if emitted != 1 {
		t.Fatalf("emitted %d times, want 1", emitted)
	}
}

// State for a route that no longer exists must not leak for the life of the daemon.
func TestHealthForgetsRemovedRoutes(t *testing.T) {
	proxy := NewProxy("", t.Logf)
	proxy.Register(Route{Hostname: "d.localhost", Port: 1, WorkspaceID: "w1", ScriptName: "dev"})

	monitor := NewHealthMonitor(proxy, t.Logf)
	monitor.Probe = func(int) bool { return true }
	monitor.PollOnce()
	if got := monitor.Health("d.localhost"); got != HealthHealthy {
		t.Fatalf("state = %q", got)
	}

	proxy.Unregister("d.localhost")
	monitor.PollOnce()
	if got := monitor.Health("d.localhost"); got != HealthPending {
		t.Fatalf("state for a removed route should be forgotten, got %q", got)
	}
}

// A real port probe: an open listener is healthy, a closed one is not.
func TestHealthProbesRealPorts(t *testing.T) {
	proxy := NewProxy("", t.Logf)
	monitor := NewHealthMonitor(proxy, t.Logf)
	monitor.Grace = 0

	listener, port := listenOnFreePort(t)
	defer listener.Close()
	proxy.Register(Route{Hostname: "e.localhost", Port: port, WorkspaceID: "w", ScriptName: "dev"})
	monitor.PollOnce()
	monitor.PollOnce()
	if got := monitor.Health("e.localhost"); got != HealthHealthy {
		t.Fatalf("an open listener should be healthy, got %q", got)
	}

	_ = listener.Close()
	monitor.PollOnce()
	monitor.PollOnce()
	if got := monitor.Health("e.localhost"); got != HealthUnhealthy {
		t.Fatalf("a closed port should be unhealthy, got %q", got)
	}
}
