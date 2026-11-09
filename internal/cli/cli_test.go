package cli

import (
	"bytes"
	"encoding/json"
	"net"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/server"
)

func TestCLIVersionHelpLsRunAndLogs(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("spawns /bin/sh")
	}
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
	envProbe := filepath.Join(tmp, "pi-env.txt")
	script := `#!/bin/sh
	printf '%s|%s|%s\n' "$BYSPACE_AGENT_ID" "$BYSPACE_HOST" "$PATH" > "` + envProbe + `"
while read line; do
  req_id=$(echo "$line" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
  [ -z "$req_id" ] && req_id="req_1"
  case "$line" in
    *'"type":"get_state"'*)
      echo "{\"type\":\"response\",\"id\":\"$req_id\",\"command\":\"get_state\",\"success\":true,\"data\":{\"sessionId\":\"sess_cli_1\",\"thinkingLevel\":\"medium\",\"isStreaming\":false,\"isCompacting\":false,\"messageCount\":0,\"pendingMessageCount\":0}}"
      ;;
    *'"type":"prompt"'*)
      echo "{\"type\":\"response\",\"id\":\"$req_id\",\"command\":\"prompt\",\"success\":true,\"data\":{\"agentInvoked\":true}}"
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
	// The listener comes first: the daemon tells its agents which address to call
	// (BYSPACE_HOST), and that is the address it actually bound.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	bindAddr := listener.Addr().String()
	srv, err := server.New(server.Options{
		HomeDir:    homeDir,
		Version:    "0.20.2-go",
		PiCommand:  fakePi,
		ListenAddr: bindAddr,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	ts := httptest.NewUnstartedServer(srv)
	ts.Listener = listener
	ts.Start()
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

	// 3b. The agent's own environment is how it reaches the daemon: without these variables a
	// shell inside the agent cannot find the right daemon or name itself as a caller.
	probe, readErr := os.ReadFile(envProbe)
	if readErr != nil {
		t.Fatalf("the agent never saw its environment: %v", readErr)
	}
	fields := strings.Split(strings.TrimSpace(string(probe)), "|")
	if len(fields) != 3 {
		t.Fatalf("unexpected env probe %q", probe)
	}
	if fields[0] == "" {
		t.Fatalf("the agent process has no BYSPACE_AGENT_ID (probe %q)", probe)
	}
	if fields[1] != addr {
		t.Fatalf("BYSPACE_HOST = %q, want the daemon address %q", fields[1], addr)
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

	// 6. byspace heartbeat create / list / delete
	out.Reset()
	errOut.Reset()
	if code := Main("0.20.2-go", []string{"schedule", "create", "--addr", addr, "--cron", "*/10 * * * *", "--name", "Check CI", "--provider", "pi", "check status"}, &out, &errOut); code != 0 {
		t.Fatalf("heartbeat create failed (%d): %s", code, errOut.String())
	}
	schedID := strings.TrimSpace(out.String())
	if schedID == "" {
		t.Fatal("expected schedule ID from heartbeat create")
	}

	// A new-agent schedule names its provider, as the Node CLI requires; a heartbeat belongs to the
	// agent the command runs in.
	errOut.Reset()
	if code := Main("0.20.2-go", []string{"schedule", "create", "--addr", addr, "--cron", "*/10 * * * *", "check status"}, &out, &errOut); code == 0 || !strings.Contains(errOut.String(), "Provider is required") {
		t.Fatalf("create without a provider: code %d, %q", code, errOut.String())
	}
	t.Setenv("BYSPACE_AGENT_ID", "")
	errOut.Reset()
	if code := Main("0.20.2-go", []string{"heartbeat", "create", "--addr", addr, "--cron", "*/10 * * * *", "check status"}, &out, &errOut); code == 0 || !strings.Contains(errOut.String(), "must run inside a BySpace agent") {
		t.Fatalf("heartbeat outside an agent: code %d, %q", code, errOut.String())
	}
	// --run-now runs the schedule on creation; without it the schedule waits for its first slot.
	for _, runNow := range []bool{false, true} {
		args := []string{"schedule", "create", "--addr", addr, "--every", "1h", "--provider", "pi", "--json", "check later"}
		if runNow {
			args = append(args[:2], append([]string{"--run-now"}, args[2:]...)...)
		}
		out.Reset()
		errOut.Reset()
		if code := Main("0.20.2-go", args, &out, &errOut); code != 0 {
			t.Fatalf("schedule create (run-now %v) failed: %s", runNow, errOut.String())
		}
		var created struct {
			ID        string `json:"id"`
			CreatedAt string `json:"createdAt"`
			NextRunAt string `json:"nextRunAt"`
		}
		if err := json.Unmarshal(out.Bytes(), &created); err != nil {
			t.Fatalf("schedule create --json: %v %q", err, out.String())
		}
		if immediate := created.NextRunAt == created.CreatedAt; immediate != runNow {
			t.Fatalf("run-now %v: createdAt %s nextRunAt %s", runNow, created.CreatedAt, created.NextRunAt)
		}
		out.Reset()
		if code := Main("0.20.2-go", []string{"schedule", "delete", "--addr", addr, created.ID}, &out, &errOut); code != 0 {
			t.Fatalf("schedule delete failed: %s", errOut.String())
		}
	}
	errOut.Reset()
	if code := Main("0.20.2-go", []string{"schedule", "create", "--addr", addr, "--cron", "0 9 * * *", "--target", "11111111-1111-4111-8111-111111111111", "--provider", "pi", "check status"}, &out, &errOut); code == 0 || !strings.Contains(errOut.String(), "only be used with a new-agent target") {
		t.Fatalf("--target with --provider: code %d, %q", code, errOut.String())
	}

	// A request the daemon refuses reports the daemon's reason, not a timeout.
	errOut.Reset()
	started := time.Now()
	if code := Main("0.20.2-go", []string{"schedule", "create", "--addr", addr, "--cron", "61 * * * *", "--provider", "pi", "check status"}, &out, &errOut); code == 0 || !strings.Contains(errOut.String(), "Invalid cron minute value") {
		t.Fatalf("create with a bad cron: code %d, %q", code, errOut.String())
	}
	if time.Since(started) > 5*time.Second {
		t.Fatalf("the refused request took %s: it waited for a response that never comes", time.Since(started))
	}

	out.Reset()
	if code := Main("0.20.2-go", []string{"heartbeat", "list", "--addr", addr}, &out, &errOut); code != 0 {
		t.Fatalf("heartbeat list failed (%d): %s", code, errOut.String())
	}
	if !strings.Contains(out.String(), schedID) || !strings.Contains(out.String(), "check status") {
		t.Fatalf("unexpected heartbeat list output: %q", out.String())
	}

	out.Reset()
	if code := Main("0.20.2-go", []string{"heartbeat", "delete", "--addr", addr, schedID}, &out, &errOut); code != 0 {
		t.Fatalf("heartbeat delete failed (%d): %s", code, errOut.String())
	}

	// 8. byspace pair --home ...
	out.Reset()
	if code := Main("0.20.2-go", []string{"pair", "--home", homeDir, "--app-url", "https://app.byspace.cc.cd"}, &out, &errOut); code != 0 {
		t.Fatalf("pair failed (%d): %s", code, errOut.String())
	}
	if !strings.HasPrefix(strings.TrimSpace(out.String()), "https://app.byspace.cc.cd/#offer=") {
		t.Fatalf("unexpected pair output: %q", out.String())
	}

	// 9. CLI parity command groups: project ls, workspace ls, provider ls
	out.Reset()
	if code := Main("0.20.2-go", []string{"project", "ls", "--addr", addr}, &out, &errOut); code != 0 {
		t.Fatalf("project ls failed (%d): %s", code, errOut.String())
	}
	if !strings.Contains(out.String(), "prj_") {
		t.Fatalf("expected prj_ in project ls output: %q", out.String())
	}

	out.Reset()
	if code := Main("0.20.2-go", []string{"workspace", "ls", "--addr", addr}, &out, &errOut); code != 0 {
		t.Fatalf("workspace ls failed (%d): %s", code, errOut.String())
	}
	if !strings.Contains(out.String(), "wks_") {
		t.Fatalf("expected wks_ in workspace ls output: %q", out.String())
	}

	out.Reset()
	if code := Main("0.20.2-go", []string{"provider", "ls", "--addr", addr}, &out, &errOut); code != 0 {
		t.Fatalf("provider ls failed (%d): %s", code, errOut.String())
	}
	if !strings.Contains(out.String(), `"provider": "pi"`) {
		t.Fatalf("expected pi in provider ls output: %q", out.String())
	}
}

// `--env FOO` with no `=` is a mistake the user wants to hear about; quietly setting FOO to the
// empty string would run the agent with a broken environment.
func TestParseKeyValueFlagsRejectsMalformed(t *testing.T) {
	for _, value := range []string{"novalue", "=value", "  ", "= "} {
		if _, err := parseKeyValueFlags([]string{value}, "env"); err == nil {
			t.Fatalf("%q should be rejected", value)
		}
	}
}

// Everything after the first `=` is the value, so a value may contain `=`.
func TestParseKeyValueFlagsSplitsOnFirstEquals(t *testing.T) {
	got, err := parseKeyValueFlags([]string{"URL=http://x?a=b", "EMPTY="}, "env")
	if err != nil {
		t.Fatal(err)
	}
	if got["URL"] != "http://x?a=b" {
		t.Fatalf("URL = %q", got["URL"])
	}
	if value, present := got["EMPTY"]; !present || value != "" {
		t.Fatalf("an empty value must be kept, got %q present=%v", value, present)
	}
}

// Zero means the default, not "wait forever": an unbounded wait on a dead provider never returns.
func TestWaitBudgetDefaults(t *testing.T) {
	if got := waitBudget(0); got != defaultWaitBudgetMs {
		t.Fatalf("zero = %d", got)
	}
	if got := waitBudget(-time.Second); got != defaultWaitBudgetMs {
		t.Fatalf("negative = %d", got)
	}
	if got := waitBudget(90 * time.Second); got != 90_000 {
		t.Fatalf("explicit = %d", got)
	}
}

// Three ways to supply the text, with a defined precedence: a file is what a script uses when the
// message would blow past the shell's argument limit.
func TestReadPromptTextPrecedence(t *testing.T) {
	file := filepath.Join(t.TempDir(), "prompt.txt")
	if err := os.WriteFile(file, []byte("from file\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	// The file wins over both other forms.
	text, agent, err := readPromptText([]string{"agt_1", "positional"}, "from-flag", file)
	if err != nil || text != "from file" || agent != "agt_1" {
		t.Fatalf("text=%q agent=%q err=%v", text, agent, err)
	}

	// The flag wins over the positional argument.
	text, agent, err = readPromptText([]string{"agt_1", "positional"}, "from-flag", "")
	if err != nil || text != "from-flag" || agent != "agt_1" {
		t.Fatalf("text=%q agent=%q err=%v", text, agent, err)
	}

	// Then the positional argument.
	text, agent, err = readPromptText([]string{"agt_1", "two", "words"}, "", "")
	if err != nil || text != "two words" || agent != "agt_1" {
		t.Fatalf("text=%q agent=%q err=%v", text, agent, err)
	}
}

// Every incomplete form has to name itself, or the user cannot tell which piece is missing.
func TestReadPromptTextErrors(t *testing.T) {
	if _, _, err := readPromptText(nil, "text", ""); err == nil {
		t.Fatal("a flag without an agent must fail")
	}
	if _, _, err := readPromptText([]string{"agt_1"}, "", ""); err == nil {
		t.Fatal("an agent without text must fail")
	}
	empty := filepath.Join(t.TempDir(), "empty.txt")
	if err := os.WriteFile(empty, []byte("   \n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := readPromptText([]string{"agt_1"}, "", empty); err == nil {
		t.Fatal("an empty file must fail")
	}
}
