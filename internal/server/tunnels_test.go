package server

import (
	"context"
	"io"
	"net"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/agentroles"
	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/tunnel"
)

// startEchoPort runs a TCP service that echoes its input, standing in for the dev server a tunnel
// exposes.
func startEchoPort(t *testing.T) (int, func()) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		for {
			conn, acceptErr := listener.Accept()
			if acceptErr != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				_, _ = io.Copy(c, c)
			}(conn)
		}
	}()
	return listener.Addr().(*net.TCPAddr).Port, func() { _ = listener.Close() }
}

// newTunnelTestServer builds a Server whose config carries the given tunnel section.
func newTunnelTestServer(t *testing.T, tunnelConfig map[string]any) *Server {
	t.Helper()
	deviceDir := t.TempDir()
	srv, err := New(Options{HomeDir: filepath.Join(deviceDir, "home"), Version: "test", PiCommand: writeFaithfulFakePi(t)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	if tunnelConfig != nil {
		srv.store.SaveDaemonConfig(map[string]any{"tunnel": tunnelConfig})
	}
	return srv
}

// The three gates all live server-side because a client can lie about all of them. Each denial
// must name its gate: the UI shows the reason verbatim, and a bare refusal leaves the user
// guessing which of the three closed.
func TestTunnelOpenRefusedWhileGateClosed(t *testing.T) {
	port, stop := startEchoPort(t)
	defer stop()

	srv := newTunnelTestServer(t, map[string]any{"allowedPorts": []any{float64(port)}})

	result, err := srv.tunnelTarget().Open(port, func(tunnel.Frame) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if result.Allowed {
		t.Fatal("the gate starts closed, so the open must be refused")
	}
	if !strings.Contains(strings.ToLower(result.Reason), "disabled") {
		t.Fatalf("the refusal should name the gate: %q", result.Reason)
	}
}

// A host with no daemon password must refuse: an unauthenticated forwarder is an open proxy.
func TestTunnelOpenRefusedWithoutPassword(t *testing.T) {
	port, stop := startEchoPort(t)
	defer stop()

	srv := newTunnelTestServer(t, map[string]any{"allowedPorts": []any{float64(port)}})
	srv.mu.Lock()
	srv.tunnelsEnabled = true
	srv.mu.Unlock()

	result, _ := srv.tunnelTarget().Open(port, func(tunnel.Frame) error { return nil })
	if result.Allowed {
		t.Fatal("a host without a password must refuse")
	}
	if !strings.Contains(result.Reason, "password") {
		t.Fatalf("the refusal should mention the password: %q", result.Reason)
	}
}

// The allowlist is the third gate. An absent allowlist must deny everything rather than permit
// everything — a missing config key is not consent.
func TestTunnelAllowlistReadsConfig(t *testing.T) {
	srv := newTunnelTestServer(t, map[string]any{"allowedPorts": []any{float64(3000), float64(3001)}})
	got := tunnelAllowlist(srv.store.LoadDaemonConfig())
	if len(got) != 2 || got[0] != 3000 || got[1] != 3001 {
		t.Fatalf("allowlist = %v", got)
	}
	if got := tunnelAllowlist(map[string]any{}); got != nil {
		t.Fatalf("absent allowlist = %v", got)
	}
	if got := tunnelAllowlist(nil); got != nil {
		t.Fatalf("nil config = %v", got)
	}
}

// End to end: a whitelisted port opens, downstream bytes reach the real service, and the echo
// comes back as upstream frames.
func TestTunnelOpenForwardsBytes(t *testing.T) {
	port, stop := startEchoPort(t)
	defer stop()

	srv := newTunnelTestServer(t, map[string]any{"allowedPorts": []any{float64(port)}})
	srv.mu.Lock()
	srv.tunnelsEnabled = true
	srv.mu.Unlock()
	// A bcrypt-shaped hash satisfies the second gate without inventing a login.
	srv.store.SetDaemonPasswordHash("$2a$12$abcdefghijklmnopqrstuv")
	srv.store.SaveDaemonConfig(map[string]any{
		"tunnel": map[string]any{"allowedPorts": []any{float64(port)}},
	})

	upstream := make(chan tunnel.Frame, 16)
	result, err := srv.tunnelTarget().Open(port, func(frame tunnel.Frame) error {
		select {
		case upstream <- frame:
		default:
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Allowed {
		t.Fatalf("refused: %s", result.Reason)
	}

	srv.tunnelTarget().HandleFrame(tunnel.Frame{
		Opcode:   tunnel.OpcodeDataDownstream,
		TunnelID: result.TunnelID,
		Payload:  []byte("hello"),
	}, func(tunnel.Frame) error { return nil })

	var echoed []byte
	for len(echoed) < 5 {
		frame := <-upstream
		if frame.Opcode == tunnel.OpcodeDataUpstream {
			echoed = append(echoed, frame.Payload...)
		}
	}
	if string(echoed) != "hello" {
		t.Fatalf("echoed %q", echoed)
	}
}

// The peer list is what the client renders; a peer without a state would render blank.
func TestTunnelListReportsConfiguredPeers(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	registry := srv.tunnelRegistry()
	if err := registry.Add(tunnel.PeerConfig{
		PeerID:   "peer-a",
		URL:      "wss://relay.example.com",
		Forwards: []tunnel.ForwardConfig{{RemotePort: 3000}},
	}); err != nil {
		t.Fatal(err)
	}
	statuses := registry.List()
	if len(statuses) != 1 || statuses[0].PeerID != "peer-a" {
		t.Fatalf("statuses = %+v", statuses)
	}
	if statuses[0].State == "" {
		t.Fatal("a peer needs a state; the client renders it directly")
	}
}

// Removing a peer must persist: a restart that resurrects it is a configuration the user cannot
// delete.
func TestTunnelRemovePersists(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	registry := srv.tunnelRegistry()
	if err := registry.Add(tunnel.PeerConfig{
		PeerID:   "peer-b",
		URL:      "wss://relay.example.com",
		Forwards: []tunnel.ForwardConfig{{RemotePort: 3001}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := registry.Remove("peer-b"); err != nil {
		t.Fatal(err)
	}
	if len(registry.List()) != 0 {
		t.Fatal("peer survived removal")
	}
}

// Each inbound stream belongs to exactly one client: downstream bytes must return to the socket
// that asked for the port, not to every connected client.
func TestTunnelStreamOwnershipIsPerSink(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	first := &recordingSink{}
	second := &recordingSink{}

	srv.rememberTunnelStream("s1", first)
	if err := srv.sendTunnelFrameToOpener(t.Context(), "s1", []byte("down")); err != nil {
		t.Fatal(err)
	}
	if first.binaryCount() != 1 || second.binaryCount() != 0 {
		t.Fatalf("first=%d second=%d", first.binaryCount(), second.binaryCount())
	}

	srv.forgetTunnelStream("s1")
	if err := srv.sendTunnelFrameToOpener(t.Context(), "s1", []byte("late")); err != nil {
		t.Fatal(err)
	}
	if first.binaryCount() != 1 {
		t.Fatal("a frame for a closed stream must be dropped, not delivered")
	}
}

// binaryCount reports how many binary frames the sink received.
func (r *recordingSink) binaryCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.binaries
}

// A role is more than a label: it carries the instructions that make the agent behave as that role.
// Go wrote the label and never appended the prompt, so Chief was created with no idea what it was.
func TestRolePromptReachesTheAgent(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	prompt := srv.systemPromptFor(store.AgentRecord{
		ID:     "agt_chief",
		Labels: map[string]string{"byspace.agent-role": "chief"},
	})
	if !strings.Contains(prompt, "You are Chief") {
		t.Fatalf("the role prompt was not appended: %q", prompt)
	}

	// An ordinary agent gets no role prompt.
	plain := srv.systemPromptFor(store.AgentRecord{ID: "agt_x", Labels: map[string]string{"team": "infra"}})
	if strings.Contains(plain, "You are Chief") {
		t.Fatalf("a roleless agent got Chief's prompt: %q", plain)
	}
}

// A client must not label its agent as one of the daemon's roles: the label carries the prompt.
func TestReservedLabelsCannotBeForged(t *testing.T) {
	stripped := agentroles.StripReserved(map[string]string{
		"byspace.agent-role": "chief",
		"mine":               "kept",
	})
	if _, present := stripped["byspace.agent-role"]; present {
		t.Fatal("a client forged the role label")
	}
	if stripped["mine"] != "kept" {
		t.Fatal("an ordinary label was dropped")
	}
}

// A provider that clamps the requested thinking level runs at the clamped one; showing the requested
// value claims a level the model is not using.
func TestEffectiveThinkingOptionPrefersRuntime(t *testing.T) {
	runtimeLevel := "high"
	configured := "max"

	// Runtime wins.
	got := effectiveThinkingOptionID(store.AgentRecord{
		RuntimeInfo: &store.AgentRuntimeInfo{Provider: "pi", ThinkingOptionID: &runtimeLevel},
	}, configured)
	if got != "high" {
		t.Fatalf("effective = %v, want high", got)
	}

	// No runtime opinion: the configured value is the best available answer.
	got = effectiveThinkingOptionID(store.AgentRecord{RuntimeInfo: &store.AgentRuntimeInfo{Provider: "pi"}}, configured)
	if got != "max" {
		t.Fatalf("effective = %v, want max", got)
	}
	got = effectiveThinkingOptionID(store.AgentRecord{}, configured)
	if got != "max" {
		t.Fatalf("effective = %v, want max", got)
	}

	// An empty runtime value is "no level", not a level named "".
	empty := "   "
	got = effectiveThinkingOptionID(store.AgentRecord{
		RuntimeInfo: &store.AgentRuntimeInfo{Provider: "pi", ThinkingOptionID: &empty},
	}, configured)
	if got != nil {
		t.Fatalf("effective = %v, want nil", got)
	}
}

// An archive can land between the first read and the load finishing. The loaded agent would then be
// a running process for a conversation the user just removed, spending tokens on work nobody reads.
func TestEnsureUnarchivedAgentLoadedRejectsArchived(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	archived := "2026-01-01T00:00:00Z"
	record := store.AgentRecord{
		ID: "agt_archived", Provider: "pi", Cwd: t.TempDir(), ArchivedAt: &archived, LastStatus: "idle",
	}
	if err := srv.store.UpsertAgent(record); err != nil {
		t.Fatal(err)
	}
	if _, err := srv.ensureUnarchivedAgentLoaded("agt_archived"); err == nil {
		t.Fatal("an archived agent must not load")
	} else if !strings.Contains(err.Error(), "archived") {
		t.Fatalf("err = %v", err)
	}
}

// A provider that accepts a prompt and never starts a turn leaves the client spinning with no way to
// tell "working" from "hung". The timeout turns that wait into an actionable error.
func TestWaitForRunStartTimesOut(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	// A very short deadline so the test does not wait a minute; the constant is what production uses.
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()

	err := srv.waitForRunStart(ctx, "agt_missing", "pi")
	if err == nil {
		t.Fatal("an agent that never starts must time out")
	}
}

// A turn that already finished must not be reported as a timeout: short turns complete before the
// first poll.
func TestWaitForRunStartAcceptsIdle(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	if err := srv.store.UpsertAgent(store.AgentRecord{
		ID: "agt_idle", Provider: "pi", Cwd: "/tmp", LastStatus: "idle",
	}); err != nil {
		t.Fatal(err)
	}
	if err := srv.waitForRunStart(context.Background(), "agt_idle", "pi"); err != nil {
		t.Fatalf("an idle agent completed its turn, that is not a timeout: %v", err)
	}
}
