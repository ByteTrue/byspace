package providers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

// The mode picker, the thinking picker and the Fast toggle only reach Codex on turn/start. Each of
// these was silently dropped before: the record changed, the UI changed, and Codex kept its defaults.
func TestCodexTurnParamsCarryModeThinkingAndFast(t *testing.T) {
	params := codexTurnParams(codexTurnState{
		ThreadID:      "th_1",
		Cwd:           "/repo",
		Model:         "gpt-5.4",
		ModeID:        "full-access",
		Thinking:      "high",
		FeatureValues: map[string]any{"fast_mode": true},
		Input:         []map[string]any{{"type": "text", "text": "hi"}},
	})

	if params["approvalPolicy"] != "never" {
		t.Errorf("approvalPolicy = %v, want the full-access preset", params["approvalPolicy"])
	}
	sandbox, _ := params["sandboxPolicy"].(map[string]any)
	if sandbox["type"] != "dangerFullAccess" {
		t.Errorf("sandboxPolicy = %v", sandbox)
	}
	if params["effort"] != "high" {
		t.Errorf("effort = %v, want the thinking level", params["effort"])
	}
	if params["serviceTier"] != "fast" {
		t.Errorf("serviceTier = %v, want fast", params["serviceTier"])
	}
	if params["model"] != "gpt-5.4" || params["cwd"] != "/repo" {
		t.Errorf("model/cwd = %v/%v", params["model"], params["cwd"])
	}
}

// A model that does not accept fast mode must not receive it: Codex rejects the turn instead of
// ignoring the tier.
func TestCodexTurnParamsSkipFastForUnsupportedModels(t *testing.T) {
	params := codexTurnParams(codexTurnState{
		Model:         "some-other-model",
		ModeID:        "auto",
		FeatureValues: map[string]any{"fast_mode": true},
	})
	if _, has := params["serviceTier"]; has {
		t.Fatalf("serviceTier sent for a model that does not support it: %v", params)
	}
}

// An explicit provider option outranks the mode preset, which is how the provider sheet wins.
func TestCodexTurnParamsPreferProviderOptions(t *testing.T) {
	params := codexTurnParams(codexTurnState{
		ModeID: "full-access",
		ProviderOptions: map[string]any{
			"approval_policy":         "on-request",
			"sandbox_mode":            "read-only",
			"sandbox_workspace_write": map[string]any{"network_access": true},
		},
	})
	if params["approvalPolicy"] != nil {
		t.Errorf("approvalPolicy = %v, want the user's pin to win by omission", params["approvalPolicy"])
	}
	sandbox, _ := params["sandboxPolicy"].(map[string]any)
	if sandbox["type"] != "readOnly" {
		t.Errorf("sandboxPolicy = %v, want the pinned read-only mode", sandbox)
	}
}

func TestCodexSandboxPolicyWorkspaceWrite(t *testing.T) {
	policy := codexSandboxPolicy("workspace-write", map[string]any{
		"network_access":    true,
		"writable_roots":    []any{"/tmp/x"},
		"exclude_slash_tmp": true,
	})
	if policy["type"] != "workspaceWrite" || policy["networkAccess"] != true || policy["excludeSlashTmp"] != true {
		t.Fatalf("policy = %v", policy)
	}
	if !reflect.DeepEqual(policy["writableRoots"], []any{"/tmp/x"}) {
		t.Fatalf("writableRoots = %v", policy["writableRoots"])
	}
	// Defaults are explicit, not absent: Codex requires the object to be complete.
	empty := codexSandboxPolicy("workspace-write", nil)
	if empty["networkAccess"] != false || !reflect.DeepEqual(empty["writableRoots"], []any{}) {
		t.Fatalf("default policy = %v", empty)
	}
}

// Claude takes the daemon's system prompt and the thinking level as launch flags; no other channel
// exists for either.
func TestClaudeLaunchArgsCarrySystemPromptAndEffort(t *testing.T) {
	args := claudeLaunchArgs(LaunchConfig{
		Model:            "opus",
		ModeID:           "acceptEdits",
		ThinkingOptionID: "high",
		SystemPrompt:     "Always answer in Chinese.",
	})
	joined := strings.Join(args, "\x00")
	for _, want := range []string{"--model\x00opus", "--permission-mode\x00acceptEdits", "--effort\x00high", "--append-system-prompt\x00Always answer in Chinese."} {
		if !strings.Contains(joined, want) {
			t.Fatalf("args %v missing %q", args, want)
		}
	}
}

// "off" and "default" are BySpace option ids, not Claude effort levels: passing them makes the CLI
// reject the launch.
func TestClaudeLaunchArgsSkipNonEffortThinking(t *testing.T) {
	for _, thinking := range []string{"off", "default", "ultracode", ""} {
		args := claudeLaunchArgs(LaunchConfig{ThinkingOptionID: thinking, Model: "opus"})
		if strings.Contains(strings.Join(args, " "), "--effort") {
			t.Fatalf("thinking %q produced --effort: %v", thinking, args)
		}
	}
}

// OpenCode takes the model, the agent (mode) and the thinking variant per message. Storing them on
// the session and never sending them left the pickers decorative.
func TestOpenCodePromptCarriesModelModeAndVariant(t *testing.T) {
	bodies := make(chan map[string]any, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/message") {
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			bodies <- body
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("{\"parts\":[]}"))
	}))
	defer server.Close()

	session := &OpenCodeSession{
		baseURL:    server.URL,
		sessionID:  "s1",
		httpClient: server.Client(),
		model:      "anthropic/claude-sonnet-4-5",
		modeID:     "build",
		thinking:   "high",
	}
	if err := session.Prompt(context.Background(), "hi", nil); err != nil {
		t.Fatal(err)
	}
	select {
	case body := <-bodies:
		model, _ := body["model"].(map[string]any)
		if model["providerID"] != "anthropic" || model["modelID"] != "claude-sonnet-4-5" {
			t.Fatalf("model = %v", body["model"])
		}
		if body["agent"] != "build" || body["variant"] != "high" {
			t.Fatalf("agent/variant = %v/%v", body["agent"], body["variant"])
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no message was sent")
	}
}
