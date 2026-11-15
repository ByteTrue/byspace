package server

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/roles"
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

	result, err := srv.tunnelTarget().Open("t1", port, "", "", func(tunnel.Frame) error { return nil })
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

	result, _ := srv.tunnelTarget().Open("t1", port, "", "", func(tunnel.Frame) error { return nil })
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
	srv := newTunnelTestServer(t, map[string]any{
		"allowedPorts":   []any{float64(3000), float64(3001)},
		"allowedTargets": []any{"192.168.1.9:5432", "not-an-endpoint"},
	})
	got := tunnelEndpoints(srv.store.LoadDaemonConfig())
	if len(got) != 3 {
		t.Fatalf("allowlist = %+v", got)
	}
	if got[0] != (tunnel.Endpoint{Port: 3000}) || got[1] != (tunnel.Endpoint{Port: 3001}) {
		t.Fatalf("loopback entries = %+v", got[:2])
	}
	if got[2] != (tunnel.Endpoint{Host: "192.168.1.9", Port: 5432}) {
		t.Fatalf("host entry = %+v", got[2])
	}
	if got := tunnelEndpoints(map[string]any{}); got != nil {
		t.Fatalf("absent allowlist = %v", got)
	}
	if got := tunnelEndpoints(nil); got != nil {
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
	result, err := srv.tunnelTarget().Open("t1", port, "", "", func(frame tunnel.Frame) error {
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

	// The client's bytes go in as upstream; the service's echo comes back as downstream.
	srv.tunnelTarget().HandleFrame(tunnel.Frame{
		Opcode:   tunnel.OpcodeDataUpstream,
		TunnelID: result.TunnelID,
		Payload:  []byte("hello"),
	}, "", true, func(tunnel.Frame) error { return nil })

	var echoed []byte
	deadline := time.After(5 * time.Second)
	for len(echoed) < 5 {
		select {
		case frame := <-upstream:
			if frame.Opcode == tunnel.OpcodeDataDownstream {
				echoed = append(echoed, frame.Payload...)
			}
		case <-deadline:
			t.Fatalf("timed out with %q", echoed)
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

// The two security seams this feature adds: the grant is per destination, and the JSON create path
// must carry the old destination when it replaces one.
func TestTunnelOpenAuthorizationIsPerDestination(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	if err := srv.tunnelGrants().Allow("pk_host", "192.168.1.9", 5432); err != nil {
		t.Fatal(err)
	}
	if err := srv.tunnelGrants().Allow("pk_loop", "", 5432); err != nil {
		t.Fatal(err)
	}

	if !srv.tunnelOpenAuthorized("pk_host", tunnel.EncodeOpenPayload(5432, "192.168.1.9")) {
		t.Fatal("the granted host destination was refused")
	}
	// A grant for this machine's loopback must not authorize the same port elsewhere, and the reverse
	// must not either: comparing ports alone would blur them.
	if srv.tunnelOpenAuthorized("pk_host", tunnel.EncodeOpenPayload(5432, "")) {
		t.Fatal("a host grant authorized loopback")
	}
	if srv.tunnelOpenAuthorized("pk_loop", tunnel.EncodeOpenPayload(5432, "192.168.1.9")) {
		t.Fatal("a loopback grant authorized another host")
	}
	if srv.tunnelOpenAuthorized("pk_host", []byte{0x15}) {
		t.Fatal("a malformed open payload must not authorize anything")
	}
}

// Editing a rule goes through tunnel.create with the OLD destination in replaceRemoteHost/Port. A
// dropped JSON field here turns every edit into "append a second rule".
func TestTunnelCreateReplacesRemoteHost(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	sink := &recordingSink{}
	send := func(payload map[string]any) {
		t.Helper()
		raw, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		srv.handleSessionMessage(context.Background(), sink, raw)
	}

	send(map[string]any{
		"type":      "tunnel.create.request",
		"requestId": "c1",
		"config": map[string]any{
			"peerId":   "peer-edit",
			"url":      "wss://relay.example.com",
			"forwards": []any{map[string]any{"remotePort": 5432}},
		},
	})
	send(map[string]any{
		"type":      "tunnel.create.request",
		"requestId": "c2",
		"config": map[string]any{
			"peerId":            "peer-edit",
			"replaceRemotePort": 5432,
			"forwards": []any{
				map[string]any{"remotePort": 6432, "remoteHost": "10.0.0.9", "localPort": 16432},
			},
		},
	})

	// The gate is off, so the config is persisted without a listener. Read the file: it is the answer
	// the next boot uses, and it also pins the JSON field this test is about.
	raw, err := os.ReadFile(filepath.Join(srv.homeDir, tunnel.RegistryFilename))
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Peers []tunnel.PeerConfig `json:"peers"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	if len(file.Peers) != 1 {
		t.Fatalf("expected one peer, got %+v", file.Peers)
	}
	forwards := file.Peers[0].Forwards
	if len(forwards) != 1 {
		t.Fatalf("expected the replaced rule to be the only one, got %+v", forwards)
	}
	if forwards[0].RemotePort != 6432 || forwards[0].RemoteHost != "10.0.0.9" {
		t.Fatalf("edit did not reach tunnels.json: %+v", forwards[0])
	}
}

// An app from before host support omits remoteHost, so it cannot say which of two rules on one port
// it means. The daemon refuses that request instead of mutating the loopback rule the user did not
// click; a request that states the host still works.
func TestTunnelHandlersRefuseAmbiguousHostlessRequest(t *testing.T) {
	srv := newTunnelTestServer(t, nil)
	registry := srv.tunnelRegistry()
	if err := registry.Add(tunnel.PeerConfig{
		PeerID: "peer-ambiguous",
		URL:    "wss://relay.example.com",
		Forwards: []tunnel.ForwardConfig{
			{RemotePort: 5432},
			{RemotePort: 5432, RemoteHost: "10.0.0.9"},
		},
	}); err != nil {
		t.Fatal(err)
	}

	sink := &recordingSink{}
	send := func(payload map[string]any) {
		t.Helper()
		raw, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		srv.handleSessionMessage(context.Background(), sink, raw)
	}

	// A host-less remove must not pick the loopback rule.
	send(map[string]any{
		"type":       "tunnel.remove.request",
		"requestId":  "r1",
		"peerId":     "peer-ambiguous",
		"remotePort": 5432,
	})
	// A host-less create (what an old app's toggle sends) must not add a third rule either.
	send(map[string]any{
		"type":      "tunnel.create.request",
		"requestId": "c1",
		"config": map[string]any{
			"peerId":   "peer-ambiguous",
			"forwards": []any{map[string]any{"remotePort": 5432}},
		},
	})

	readForwards := func() []tunnel.ForwardConfig {
		t.Helper()
		raw, err := os.ReadFile(filepath.Join(srv.homeDir, tunnel.RegistryFilename))
		if err != nil {
			t.Fatal(err)
		}
		var file struct {
			Peers []tunnel.PeerConfig `json:"peers"`
		}
		if err := json.Unmarshal(raw, &file); err != nil {
			t.Fatal(err)
		}
		if len(file.Peers) != 1 {
			t.Fatalf("expected one peer, got %+v", file.Peers)
		}
		return file.Peers[0].Forwards
	}

	if forwards := readForwards(); len(forwards) != 2 {
		t.Fatalf("an ambiguous request changed the rules: %+v", forwards)
	}

	// Stating the host resolves the ambiguity.
	send(map[string]any{
		"type":       "tunnel.remove.request",
		"requestId":  "r2",
		"peerId":     "peer-ambiguous",
		"remotePort": 5432,
		"remoteHost": "127.0.0.1",
	})
	forwards := readForwards()
	if len(forwards) != 1 || forwards[0].RemoteHost != "10.0.0.9" {
		t.Fatalf("the explicit loopback rule was not the one removed: %+v", forwards)
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
