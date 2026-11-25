package cli

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/ByteTrue/byspace/internal/store"
)

func TestMain(m *testing.M) {
	if os.Getenv("BYSPACE_PROVIDER_HELPER") == "acp-conformance" {
		os.Exit(runCLIACPConformanceHelper())
	}
	os.Exit(m.Run())
}

func cliACPConformanceConfig(t *testing.T, failure string) map[string]any {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	return map[string]any{
		"extends": "acp", "label": "Fake ACP", "command": []any{exe},
		"env": map[string]any{
			"BYSPACE_PROVIDER_HELPER":  "acp-conformance",
			"BYSPACE_ACP_FAKE_FAILURE": failure,
		},
	}
}

func TestProviderCheckPrintsStableResultsAndLeavesBySpaceStateUntouched(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("BYSPACE_HOME", homeDir)
	st := store.New(homeDir)
	if err := st.UpsertWorkspace(store.WorkspaceRecord{WorkspaceID: "ws-existing", Cwd: homeDir}); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertAgent(store.AgentRecord{ID: "agent-existing", Provider: "pi", Cwd: homeDir, WorkspaceID: "ws-existing"}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.SaveDaemonConfigChecked(map[string]any{
		"providers": map[string]any{"fake": cliACPConformanceConfig(t, "")},
	}); err != nil {
		t.Fatal(err)
	}
	beforeAgents, err := st.ListAgents()
	if err != nil {
		t.Fatal(err)
	}
	beforeWorkspaces, err := st.ListWorkspaces()
	if err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(homeDir, "config.json")
	beforeConfig, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}

	var stdout bytes.Buffer
	if err := runProviderGroupCmd([]string{"check", "fake"}, &stdout); err != nil {
		t.Fatal(err)
	}
	want := `PASS launch
PASS initialize
PASS session
PASS prompt
PASS output
PASS completion
SKIP image - image input was not advertised
SKIP continuation - session load or resume was not advertised
SKIP model - model catalog was not returned
SKIP mode - mode catalog was not returned
SKIP thinking - thinking catalog was not returned
provider fake passed ACP conformance
`
	if stdout.String() != want {
		t.Fatalf("stdout mismatch:\n%s\nwant:\n%s", stdout.String(), want)
	}
	afterAgents, err := st.ListAgents()
	if err != nil {
		t.Fatal(err)
	}
	afterWorkspaces, err := st.ListWorkspaces()
	if err != nil {
		t.Fatal(err)
	}
	afterConfig, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(beforeAgents, afterAgents) || !reflect.DeepEqual(beforeWorkspaces, afterWorkspaces) || !bytes.Equal(beforeConfig, afterConfig) {
		t.Fatalf("conformance changed BySpace state: agents=%v workspaces=%v config=%v", !reflect.DeepEqual(beforeAgents, afterAgents), !reflect.DeepEqual(beforeWorkspaces, afterWorkspaces), !bytes.Equal(beforeConfig, afterConfig))
	}
}

func TestProviderCheckReturnsErrorAfterPrintingFailedStage(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("BYSPACE_HOME", homeDir)
	if _, err := store.New(homeDir).SaveDaemonConfigChecked(map[string]any{
		"providers": map[string]any{"fake": cliACPConformanceConfig(t, "initialize")},
	}); err != nil {
		t.Fatal(err)
	}
	var stdout bytes.Buffer
	err := runProviderGroupCmd([]string{"check", "fake"}, &stdout)
	if err == nil || !strings.Contains(err.Error(), "failed ACP conformance") {
		t.Fatalf("error = %v", err)
	}
	for _, expected := range []string{"PASS launch", "FAIL initialize - acp initialize: acp rpc error: fake initialize failure", "SKIP session", "SKIP prompt"} {
		if !strings.Contains(stdout.String(), expected) {
			t.Fatalf("stdout %q does not contain %q", stdout.String(), expected)
		}
	}
}

func TestProviderCheckRejectsUnknownDisabledAndNonACPProviders(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("BYSPACE_HOME", homeDir)
	if _, err := store.New(homeDir).SaveDaemonConfigChecked(map[string]any{
		"providers": map[string]any{
			"disabled": map[string]any{"extends": "acp", "enabled": false},
			"native":   map[string]any{"extends": "claude"},
		},
	}); err != nil {
		t.Fatal(err)
	}
	for _, tt := range []struct{ id, want string }{
		{id: "missing", want: "not configured"},
		{id: "disabled", want: "disabled"},
		{id: "native", want: "does not extend ACP"},
	} {
		t.Run(tt.id, func(t *testing.T) {
			var stdout bytes.Buffer
			err := runProviderCheckCmd([]string{tt.id}, &stdout)
			if err == nil || !strings.Contains(err.Error(), tt.want) || stdout.Len() != 0 {
				t.Fatalf("error=%v stdout=%q, want %q and no report", err, stdout.String(), tt.want)
			}
		})
	}
}

func runCLIACPConformanceHelper() int {
	decoder := json.NewDecoder(os.Stdin)
	encoder := json.NewEncoder(os.Stdout)
	for {
		var request map[string]any
		if err := decoder.Decode(&request); err != nil {
			if err == io.EOF {
				return 0
			}
			return 2
		}
		id := request["id"]
		method, _ := request["method"].(string)
		if method == "initialize" && os.Getenv("BYSPACE_ACP_FAKE_FAILURE") == "initialize" {
			if err := encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{
				"code": -32000, "message": "fake initialize failure",
			}}); err != nil {
				return 2
			}
			continue
		}
		if method == "session/prompt" {
			if err := encoder.Encode(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{
				"sessionId": "fake-session",
				"update": map[string]any{
					"sessionUpdate": "agent_message_chunk",
					"content":       map[string]any{"type": "text", "text": "fake response"},
				},
			}}); err != nil {
				return 2
			}
		}
		result := map[string]any{}
		switch method {
		case "initialize":
			result = map[string]any{"protocolVersion": 1, "agentCapabilities": map[string]any{}}
		case "session/new":
			result = map[string]any{"sessionId": "fake-session"}
		case "session/prompt":
			result = map[string]any{"stopReason": "end_turn"}
		}
		if err := encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "result": result}); err != nil {
			return 2
		}
	}
}
