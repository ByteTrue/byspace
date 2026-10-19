package cli

import (
	"bytes"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ByteTrue/byspace/internal/server"
)

func TestCLIVersionHelpLsRunAndLogs(t *testing.T) {
	var out, errOut bytes.Buffer

	// 1. version
	if code := Main("0.20.2-go", []string{"version"}, &out, &errOut); code != 0 {
		t.Fatalf("version failed (%d): %s", code, errOut.String())
	}
	if strings.TrimSpace(out.String()) != "0.20.2-go" {
		t.Fatalf("unexpected version output: %q", out.String())
	}

	// 2. Spin up in-memory test daemon with a fake Pi binary
	tmp := t.TempDir()
	fakePi := filepath.Join(tmp, "fake-pi.sh")
	script := `#!/bin/sh
while read line; do
  case "$line" in
    *'"type":"prompt"'*)
      echo '{"type":"response","id":"req_1","command":"prompt","success":true,"data":{"agentInvoked":true}}'
      echo '{"type":"agent_start"}'
      echo '{"type":"turn_start"}'
      echo '{"type":"message_start","message":{"role":"assistant","content":[]}}'
      echo '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"CLI end-to-end Pi output!"}}'
      echo '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"CLI end-to-end Pi output!"}]}}'
      echo '{"type":"agent_end","willRetry":false}'
      echo '{"type":"agent_settled"}'
      ;;
  esac
done
`
	if err := os.WriteFile(fakePi, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}

	homeDir := filepath.Join(tmp, "home")
	srv, err := server.New(server.Options{
		HomeDir:   homeDir,
		Version:   "0.20.2-go",
		PiCommand: fakePi,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	ts := httptest.NewServer(srv)
	defer ts.Close()
	addr := strings.TrimPrefix(ts.URL, "http://")

	// 3. byspace run --addr ... --cwd ... --wait "hello"
	out.Reset()
	errOut.Reset()
	if code := Main("0.20.2-go", []string{"run", "--addr", addr, "--cwd", tmp, "say hi"}, &out, &errOut); code != 0 {
		t.Fatalf("byspace run failed (%d): %s", code, errOut.String())
	}
	if strings.TrimSpace(out.String()) != "CLI end-to-end Pi output!" {
		t.Fatalf("unexpected run output: %q", out.String())
	}

	// 4. byspace ls --home ...
	out.Reset()
	errOut.Reset()
	if code := Main("0.20.2-go", []string{"ls", "--home", homeDir}, &out, &errOut); code != 0 {
		t.Fatalf("byspace ls failed (%d): %s", code, errOut.String())
	}
	if !strings.Contains(out.String(), "pi") || !strings.Contains(out.String(), "say hi") {
		t.Fatalf("unexpected ls output: %q", out.String())
	}

	// 5. byspace daemon status --addr ...
	out.Reset()
	errOut.Reset()
	if code := Main("0.20.2-go", []string{"daemon", "status", "--addr", addr}, &out, &errOut); code != 0 {
		t.Fatalf("daemon status failed (%d): %s", code, errOut.String())
	}
	if !strings.Contains(out.String(), "running") || !strings.Contains(out.String(), srv.ServerID()) {
		t.Fatalf("unexpected daemon status output: %q", out.String())
	}

	// 6. byspace mcp-bridge --addr ... (tools/list + tools/call list_agents)
	mcpIn := strings.NewReader(
		`{"jsonrpc":"2.0","id":1,"method":"tools/list"}` + "\n" +
			`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_agents","arguments":{}}}` + "\n",
	)
	out.Reset()
	if err := runMCPBridge([]string{"--addr", addr}, mcpIn, &out); err != nil {
		t.Fatalf("mcp-bridge failed: %v", err)
	}
	if !strings.Contains(out.String(), `"name":"list_agents"`) || !strings.Contains(out.String(), `say hi`) {
		t.Fatalf("unexpected mcp-bridge output: %s", out.String())
	}
}
