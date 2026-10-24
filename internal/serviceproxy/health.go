package serviceproxy

import (
	"net"
	"strconv"
	"sync"
	"time"
)

// Health state values, matching script-health-monitor.ts.
const (
	HealthPending   = "pending"
	HealthHealthy   = "healthy"
	HealthUnhealthy = "unhealthy"
)

// Defaults from the node daemon. The grace period exists because a dev server that has just been
// told to start is not listening yet, and reporting it unhealthy immediately would flash a red
// badge on every start.
const (
	DefaultPollInterval            = 3 * time.Second
	DefaultGracePeriod             = 5 * time.Second
	DefaultFailuresBeforeUnhealthy = 2
)

// healthState is the tracked state for one route.
type healthState struct {
	registeredAt        time.Time
	health              string
	consecutiveFailures int
}

// HealthMonitor probes service ports and reports transitions.
//
// Ported from script-health-monitor.ts. Two consecutive failures are needed before a route is
// called unhealthy: one dropped probe is a hiccup (a restart, a GC pause), and a single-sample
// verdict would flap the badge between states.
type HealthMonitor struct {
	Proxy    *Proxy
	Interval time.Duration
	Grace    time.Duration
	// FailuresBeforeUnhealthy is how many consecutive failed probes condemn a route.
	FailuresBeforeUnhealthy int
	// DialTimeout bounds one probe. A probe that hangs is a failure, not a pending result.
	DialTimeout time.Duration
	// OnChange reports a workspace whose health changed.
	OnChange func(workspaceID string, routes []Route)
	Logf     func(string, ...any)
	// Probe overrides the port check. Tests use it; production leaves it nil.
	Probe func(port int) bool

	mu     sync.Mutex
	states map[string]*healthState
	// lastEmitted lets the monitor suppress a notification that would not change anything. A
	// poll every three seconds that re-emits the same health is pure noise on the socket.
	lastEmitted map[string]string
	stop        chan struct{}
	stopped     bool
}

// NewHealthMonitor builds a monitor for a proxy.
func NewHealthMonitor(proxy *Proxy, logf func(string, ...any)) *HealthMonitor {
	if logf == nil {
		logf = func(string, ...any) {}
	}
	return &HealthMonitor{
		Proxy:                   proxy,
		Interval:                DefaultPollInterval,
		Grace:                   0,
		FailuresBeforeUnhealthy: DefaultFailuresBeforeUnhealthy,
		DialTimeout:             750 * time.Millisecond,
		Logf:                    logf,
		states:                  make(map[string]*healthState),
		lastEmitted:             make(map[string]string),
		stop:                    make(chan struct{}),
	}
}

// Start begins polling.
func (h *HealthMonitor) Start() {
	if h.Interval <= 0 {
		h.Interval = DefaultPollInterval
	}
	go func() {
		ticker := time.NewTicker(h.Interval)
		defer ticker.Stop()
		for {
			select {
			case <-h.stop:
				return
			case <-ticker.C:
				h.PollOnce()
			}
		}
	}()
}

// Stop ends polling.
func (h *HealthMonitor) Stop() {
	h.mu.Lock()
	if h.stopped {
		h.mu.Unlock()
		return
	}
	h.stopped = true
	h.mu.Unlock()
	close(h.stop)
}

// PollOnce probes every route once and reports transitions.
func (h *HealthMonitor) PollOnce() {
	h.mu.Lock()
	routes := make([]Route, 0, len(h.states)+8)
	h.mu.Unlock()

	h.Proxy.mu.RLock()
	for _, route := range h.Proxy.routes {
		routes = append(routes, route)
	}
	h.Proxy.mu.RUnlock()

	now := time.Now()
	changedWorkspaces := make(map[string]bool)

	for _, route := range routes {
		h.mu.Lock()
		state, ok := h.states[route.Hostname]
		if !ok {
			state = &healthState{registeredAt: now, health: HealthPending}
			h.states[route.Hostname] = state
		}
		// A route younger than the grace period is not probed: the script was told to start and
		// has not bound its port yet.
		if now.Sub(state.registeredAt) < h.Grace {
			h.mu.Unlock()
			continue
		}
		h.mu.Unlock()

		healthy := h.probe(route.Port)

		h.mu.Lock()
		previous := state.health
		if healthy {
			state.consecutiveFailures = 0
			state.health = HealthHealthy
		} else {
			state.consecutiveFailures++
			if state.consecutiveFailures >= h.FailuresBeforeUnhealthy {
				state.health = HealthUnhealthy
			}
		}
		if state.health != previous {
			changedWorkspaces[route.WorkspaceID] = true
			h.Logf("service proxy: %s health %s → %s", route.Hostname, previous, state.health)
		}
		h.mu.Unlock()
	}

	// Forget routes that no longer exist, or their state leaks for the life of the daemon.
	h.mu.Lock()
	present := make(map[string]bool, len(routes))
	for _, route := range routes {
		present[route.Hostname] = true
	}
	for hostname := range h.states {
		if !present[hostname] {
			delete(h.states, hostname)
		}
	}
	h.mu.Unlock()

	if h.OnChange == nil {
		return
	}
	for workspaceID := range changedWorkspaces {
		h.emit(workspaceID, routes)
	}
}

// emit calls OnChange unless the workspace's health has not actually changed.
func (h *HealthMonitor) emit(workspaceID string, routes []Route) {
	snapshot := ""
	for _, route := range routes {
		if route.WorkspaceID != workspaceID {
			continue
		}
		h.mu.Lock()
		state := h.states[route.Hostname]
		health := HealthPending
		if state != nil {
			health = state.health
		}
		h.mu.Unlock()
		snapshot += route.ScriptName + "=" + health + ";"
	}

	h.mu.Lock()
	if previous, ok := h.lastEmitted[workspaceID]; ok && previous == snapshot {
		h.mu.Unlock()
		return
	}
	h.lastEmitted[workspaceID] = snapshot
	h.mu.Unlock()

	h.OnChange(workspaceID, routes)
}

// Health reports a route's current health.
func (h *HealthMonitor) Health(hostname string) string {
	h.mu.Lock()
	defer h.mu.Unlock()
	if state, ok := h.states[hostname]; ok {
		return state.health
	}
	return HealthPending
}

// probe checks whether a port accepts a connection.
func (h *HealthMonitor) probe(port int) bool {
	if h.Probe != nil {
		return h.Probe(port)
	}
	timeout := h.DialTimeout
	if timeout <= 0 {
		timeout = 750 * time.Millisecond
	}
	conn, err := net.DialTimeout("tcp", "127.0.0.1:"+strconv.Itoa(port), timeout)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}
