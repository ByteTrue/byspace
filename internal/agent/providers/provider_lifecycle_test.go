package providers

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestMain(m *testing.M) {
	switch os.Getenv("BYSPACE_PROVIDER_HELPER") {
	case "jsonrpc-error":
		runJSONRPCErrorHelper()
		return
	case "claude-prompt":
		runClaudePromptHelper()
		return
	}
	os.Exit(m.Run())
}

func runJSONRPCErrorHelper() {
	failMethod := os.Getenv("BYSPACE_PROVIDER_HELPER_FAIL_METHOD")
	decoder := json.NewDecoder(os.Stdin)
	encoder := json.NewEncoder(os.Stdout)
	for {
		var request map[string]any
		if err := decoder.Decode(&request); err != nil {
			if err == io.EOF {
				os.Exit(0)
			}
			os.Exit(2)
		}
		response := map[string]any{"jsonrpc": "2.0", "id": request["id"], "result": map[string]any{}}
		if request["method"] == failMethod {
			response = map[string]any{
				"jsonrpc": "2.0",
				"id":      request["id"],
				"error":   map[string]any{"code": -32000, "message": "native startup rejected"},
			}
		}
		if err := encoder.Encode(response); err != nil {
			os.Exit(2)
		}
	}
}

func runClaudePromptHelper() {
	encoder := json.NewEncoder(os.Stdout)
	_ = encoder.Encode(map[string]any{"type": "system", "subtype": "init", "session_id": "claude-test"})
	decoder := json.NewDecoder(os.Stdin)
	for {
		var request map[string]any
		if err := decoder.Decode(&request); err != nil {
			if err == io.EOF {
				os.Exit(0)
			}
			os.Exit(2)
		}
		if request["type"] != "user" {
			continue
		}
		_ = encoder.Encode(map[string]any{"type": "assistant", "message": map[string]any{
			"role": "assistant", "content": []any{map[string]any{"type": "text", "text": "done"}},
		}})
		_ = encoder.Encode(map[string]any{"type": "result", "session_id": "claude-test", "result": "done"})
	}
}

func TestACPStartReturnsNativeHandshakeErrors(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{"initialize", "session/new"} {
		t.Run(method, func(t *testing.T) {
			env := append(os.Environ(),
				"BYSPACE_PROVIDER_HELPER=jsonrpc-error",
				"BYSPACE_PROVIDER_HELPER_FAIL_METHOD="+method,
			)
			sess, err := StartACPSession(LaunchConfig{Cwd: t.TempDir(), Env: env}, ProviderSpec{
				ID: "acp-test", Binary: exe,
			}, exe)
			if err == nil || !strings.Contains(err.Error(), "native startup rejected") {
				t.Fatalf("StartACPSession() error = %v, want native rejection", err)
			}
			if sess != nil {
				t.Fatalf("failed start returned usable session %+v", sess)
			}
		})
	}
}

func TestCodexStartReturnsNativeHandshakeErrors(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{"initialize", "thread/start"} {
		t.Run(method, func(t *testing.T) {
			env := append(os.Environ(),
				"BYSPACE_PROVIDER_HELPER=jsonrpc-error",
				"BYSPACE_PROVIDER_HELPER_FAIL_METHOD="+method,
			)
			sess, err := StartCodexSession(LaunchConfig{Cwd: t.TempDir(), Env: env}, exe)
			if err == nil || !strings.Contains(err.Error(), "native startup rejected") {
				t.Fatalf("StartCodexSession() error = %v, want native rejection", err)
			}
			if sess != nil {
				t.Fatalf("failed start returned usable session %+v", sess)
			}
		})
	}
}

func TestOpenCodeStartRejectsFailedOrInvalidSessionCreation(t *testing.T) {
	tests := []struct {
		name    string
		status  int
		body    string
		wantErr string
	}{
		{name: "native error", status: http.StatusInternalServerError, body: "native create rejected", wantErr: "native create rejected"},
		{name: "missing id", status: http.StatusOK, body: "{}", wantErr: "response has no id"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(test.status)
				_, _ = w.Write([]byte(test.body))
			}))
			defer server.Close()
			sess, err := newHTTPOpenCodeSession(LaunchConfig{Cwd: t.TempDir()}, server.URL)
			if err == nil || !strings.Contains(err.Error(), test.wantErr) {
				t.Fatalf("newHTTPOpenCodeSession() error = %v, want %q", err, test.wantErr)
			}
			if sess != nil {
				t.Fatalf("failed start returned usable session %+v", sess)
			}
		})
	}
}
