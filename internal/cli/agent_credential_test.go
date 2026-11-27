package cli

import (
	"net"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/ByteTrue/byspace/internal/server"
)

func TestCLITransportPrefersAgentCredential(t *testing.T) {
	t.Setenv("BYSPACE_AGENT_CREDENTIAL", "agent-opaque-token")
	if got := cliTransportCredential("shared-cli-token"); got != "agent-opaque-token" {
		t.Fatalf("transport credential = %q, want per-agent credential", got)
	}
}

func TestCLITransportHumanFallsBackToSharedCredential(t *testing.T) {
	t.Setenv("BYSPACE_AGENT_CREDENTIAL", "")
	if got := cliTransportCredential("shared-cli-token"); got != "shared-cli-token" {
		t.Fatalf("transport credential = %q, want shared human credential", got)
	}
}

func TestChiefCLIUnixSocketBindsAgentIdentity(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("BYSPACE_HOME", homeDir)
	t.Setenv("BYSPACE_AGENT_ID", "agt_unix")
	t.Setenv("BYSPACE_AGENT_CREDENTIAL", "agent-unix-token")
	if shared := server.EnsureCLICredential(homeDir); shared == "" || shared == "agent-unix-token" {
		t.Fatal("fixture needs a distinct shared human credential")
	}

	socketPath := filepath.Join(t.TempDir(), "d")
	listener, err := net.Listen("unix", socketPath)
	if runtime.GOOS == "windows" && err != nil {
		t.Skipf("unix sockets are unavailable on this Windows host: %v", err)
	}
	if err != nil {
		t.Fatal(err)
	}
	mock := startMockChiefDaemonOnListener(t, listener, func(req map[string]any) mockChiefResponse {
		return mockChiefResponse{
			MessageType: "chief.thread.create.response",
			Payload: map[string]any{
				"requestId": req["requestId"],
				"mission":   sampleMissionMap(nil),
				"thread":    sampleThreadMap(nil),
				"error":     nil,
			},
		}
	})

	code, stdout, stderr := runChiefCLI(t,
		"thread", "create", "--addr", mock.addr,
		"--mission", "msn_1", "--title", "Unix agent", "--goal", "Bind the caller", "--json",
	)
	if code != 0 || stderr != "" {
		t.Fatalf("unix-socket Chief CLI failed (%d): stdout=%q stderr=%q", code, stdout, stderr)
	}
	rec := mock.lastRequest(t)
	if got := rec.Request["callerAgentId"]; got != "agt_unix" {
		t.Fatalf("callerAgentId = %#v, want agt_unix", got)
	}
	if got := rec.Headers.Get("Authorization"); got != "Bearer agent-unix-token" {
		t.Fatalf("Authorization = %q, want the agent credential", got)
	}
	if got := rec.Headers.Get("Sec-WebSocket-Protocol"); got != "byspace.bearer.agent-unix-token" {
		t.Fatalf("Sec-WebSocket-Protocol = %q, want the agent credential", got)
	}
}
