package naming

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// fakePi answers pi's RPC with a fixed name and records every prompt it was sent.
func fakePi(t *testing.T, reply string) (command, promptLog string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("spawns /bin/sh")
	}
	dir := t.TempDir()
	promptLog = filepath.Join(dir, "prompts.log")
	script := `#!/bin/sh
while read line; do
  req_id=$(echo "$line" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
  case "$line" in
    *'"type":"get_state"'*)
      echo "{\"type\":\"response\",\"id\":\"$req_id\",\"command\":\"get_state\",\"success\":true,\"data\":{\"sessionId\":\"s\",\"isStreaming\":false,\"messageCount\":0,\"pendingMessageCount\":0}}"
      ;;
    *'"type":"prompt"'*)
      echo "$line" >> '` + promptLog + `'
      echo "{\"type\":\"response\",\"id\":\"$req_id\",\"command\":\"prompt\",\"success\":true,\"data\":{}}"
      echo '{"type":"agent_start"}'
      echo '{"type":"message_start","message":{"role":"assistant","content":[]}}'
      echo '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"` + reply + `"}]}}'
      echo '{"type":"agent_end","willRetry":false}'
      echo '{"type":"agent_settled"}'
      ;;
    *)
      echo "{\"type\":\"response\",\"id\":\"$req_id\",\"success\":true,\"data\":{}}"
      ;;
  esac
done
`
	command = filepath.Join(dir, "pi")
	if err := os.WriteFile(command, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return command, promptLog
}

// The model is given the task to name: the seed follows the instruction.
func TestGenerateSendsTheSeed(t *testing.T) {
	command, promptLog := fakePi(t, `{\"title\":\"Fix the login redirect\",\"branch\":\"fix-login-redirect\"}`)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	seed := "<user-prompt>\nThe login page redirects to a 404 after sign-in\n</user-prompt>"
	result, err := PiGenerator{Command: command}.Generate(ctx, seed)
	if err != nil {
		t.Fatal(err)
	}
	if result.Title != "Fix the login redirect" || result.Branch != "fix-login-redirect" {
		t.Fatalf("result = %+v", result)
	}
	sent, err := os.ReadFile(promptLog)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(sent), "Material:") || !strings.Contains(string(sent), "redirects to a 404 after sign-in") {
		t.Fatalf("the prompt pi received has no material: %s", sent)
	}
}
