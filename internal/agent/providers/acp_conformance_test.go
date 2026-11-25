package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func fakeACPConformanceConfig(t *testing.T, features, failure string) map[string]any {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	return map[string]any{
		"extends": "acp",
		"command": []any{exe},
		"env": map[string]any{
			"BYSPACE_PROVIDER_HELPER":    "acp-conformance",
			"BYSPACE_ACP_FAKE_FEATURES":  features,
			"BYSPACE_ACP_FAKE_FAILURE":   failure,
			"BYSPACE_ACP_FAKE_EXIT_FILE": filepath.Join(t.TempDir(), "process-exited"),
			"BYSPACE_ACP_FAKE_CWD_FILE":  filepath.Join(t.TempDir(), "process-cwd"),
		},
	}
}

func acpConformanceResult(t *testing.T, report ACPConformanceReport, name string) ACPCheckResult {
	t.Helper()
	for _, result := range report.Results {
		if result.Name == name {
			return result
		}
	}
	t.Fatalf("missing result %q in %#v", name, report.Results)
	return ACPCheckResult{}
}

func requireACPConformanceStatus(t *testing.T, report ACPConformanceReport, name string, status ACPCheckStatus) {
	t.Helper()
	result := acpConformanceResult(t, report, name)
	if result.Status != status {
		t.Fatalf("%s = %s (%s), want %s; report=%#v", name, result.Status, result.Detail, status, report.Results)
	}
}

func runFakeACPConformance(t *testing.T, config map[string]any) ACPConformanceReport {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	return RunACPConformance(ctx, "fake", config)
}

func TestACPConformanceBaselineStagesAndProcessCleanup(t *testing.T) {
	tests := []struct {
		name    string
		failure string
		failed  string
		launch  bool
	}{
		{name: "pass"},
		{name: "launch", failure: "launch", failed: "launch", launch: true},
		{name: "initialize", failure: "initialize", failed: "initialize"},
		{name: "session", failure: "session", failed: "session"},
		{name: "prompt", failure: "prompt", failed: "completion"},
		{name: "output", failure: "output", failed: "output"},
		{name: "completion", failure: "completion", failed: "completion"},
		{name: "cancelled", failure: "cancelled", failed: "completion"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := fakeACPConformanceConfig(t, "", tt.failure)
			env := config["env"].(map[string]any)
			exitFile := env["BYSPACE_ACP_FAKE_EXIT_FILE"].(string)
			if tt.launch {
				config["command"] = []any{filepath.Join(t.TempDir(), "missing-acp")}
			}
			report := runFakeACPConformance(t, config)
			if tt.failed == "" {
				if !report.Passed() {
					t.Fatalf("baseline failed: %#v", report.Results)
				}
				for _, name := range []string{"launch", "initialize", "session", "prompt", "output", "completion"} {
					requireACPConformanceStatus(t, report, name, ACPCheckPass)
				}
				for _, name := range []string{"image", "continuation", "model", "mode", "thinking"} {
					requireACPConformanceStatus(t, report, name, ACPCheckSkip)
				}
			} else {
				if report.Passed() {
					t.Fatalf("failure %q passed: %#v", tt.failure, report.Results)
				}
				requireACPConformanceStatus(t, report, tt.failed, ACPCheckFail)
			}
			if !tt.launch {
				if _, err := os.Stat(exitFile); err != nil {
					t.Fatalf("provider process was not cleaned up: %v; report=%#v", err, report.Results)
				}
				cwdBytes, err := os.ReadFile(env["BYSPACE_ACP_FAKE_CWD_FILE"].(string))
				if err != nil {
					t.Fatal(err)
				}
				if _, err := os.Stat(strings.TrimSpace(string(cwdBytes))); !os.IsNotExist(err) {
					t.Fatalf("temporary working directory was not removed: %q, err=%v", cwdBytes, err)
				}
			}
		})
	}
}

func TestACPConformanceAdvertisedCapabilitiesPass(t *testing.T) {
	report := runFakeACPConformance(t, fakeACPConformanceConfig(t, "image,continuation,models,modes,thinking", ""))
	if !report.Passed() {
		t.Fatalf("advertised capabilities failed: %#v", report.Results)
	}
	for _, name := range acpConformanceCheckNames {
		requireACPConformanceStatus(t, report, name, ACPCheckPass)
	}
}

func TestACPConformanceSelectionRequiresNegotiatedState(t *testing.T) {
	for _, name := range []string{"model", "mode", "thinking"} {
		t.Run(name, func(t *testing.T) {
			features := map[string]string{"model": "models", "mode": "modes", "thinking": "thinking"}[name]
			report := runFakeACPConformance(t, fakeACPConformanceConfig(t, features, name+"-unacknowledged"))
			requireACPConformanceStatus(t, report, name, ACPCheckFail)
		})
	}
}

func TestACPConformanceSelectionRejectsPrepopulatedState(t *testing.T) {
	config := fakeACPConformanceConfig(t, "models", "model-prepopulated")
	spec, _ := ProviderSpecForLaunch("fake", config)
	session, err := startACPSession(context.Background(), LaunchConfig{
		Provider: "fake", ProviderConfig: config, Cwd: t.TempDir(), Env: acpConformanceEnvironment(config),
	}, spec, "")
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	if _, err := session.SetModel(context.Background(), "fake", "model-b"); err != nil {
		t.Fatalf("priming negotiated model: %v", err)
	}
	session.mu.Lock()
	if session.negotiatedSelectionRevisions["model"] == 0 {
		t.Fatal("priming selection did not produce negotiated state")
	}
	// The next check selects model-b again, but only a fresh confirmation may pass it.
	session.model = "model-a"
	session.mu.Unlock()
	report := newACPConformanceReport("fake")
	runACPSelectionCheck(context.Background(), report, session, "model")
	requireACPConformanceStatus(t, *report, "model", ACPCheckFail)
}

func TestACPConformanceSingletonCatalogsSkipSelection(t *testing.T) {
	session := &ACPSession{
		nativeModels: []sdk.Model{{ID: "only-model"}},
		nativeModes:  []ModeDefinition{{ID: "only-mode"}},
		configOptions: []any{map[string]any{
			"id": "thought_level", "category": "thought_level", "currentValue": "low",
			"options": []any{map[string]any{"value": "low", "name": "Low"}},
		}},
	}
	report := newACPConformanceReport("fake")
	for _, kind := range []string{"model", "mode", "thinking"} {
		runACPSelectionCheck(context.Background(), report, session, kind)
		requireACPConformanceStatus(t, *report, kind, ACPCheckSkip)
	}
}

func TestACPConformanceAdvertisedFailuresFailIndividually(t *testing.T) {
	for _, name := range []string{"image", "continuation", "model", "mode", "thinking"} {
		t.Run(name, func(t *testing.T) {
			features := map[string]string{
				"image": "image", "continuation": "continuation", "model": "models",
				"mode": "modes", "thinking": "thinking",
			}[name]
			report := runFakeACPConformance(t, fakeACPConformanceConfig(t, features, name))
			requireACPConformanceStatus(t, report, name, ACPCheckFail)
			if report.Passed() {
				t.Fatalf("advertised %s failure passed: %#v", name, report.Results)
			}
		})
	}
}

func runACPConformanceHelper() int {
	if noBrowserFile := os.Getenv("BYSPACE_ACP_FAKE_NO_BROWSER_FILE"); noBrowserFile != "" {
		_ = os.WriteFile(noBrowserFile, []byte(os.Getenv("NO_BROWSER")), 0o600)
	}
	if cwdFile := os.Getenv("BYSPACE_ACP_FAKE_CWD_FILE"); cwdFile != "" {
		cwd, _ := os.Getwd()
		_ = os.WriteFile(cwdFile, []byte(cwd), 0o600)
	}
	exitFile := os.Getenv("BYSPACE_ACP_FAKE_EXIT_FILE")
	defer func() {
		if exitFile != "" {
			_ = os.WriteFile(exitFile, []byte("exited"), 0o600)
		}
	}()
	features := map[string]bool{}
	for _, feature := range strings.Split(os.Getenv("BYSPACE_ACP_FAKE_FEATURES"), ",") {
		features[feature] = true
	}
	failure := os.Getenv("BYSPACE_ACP_FAKE_FAILURE")
	continued := false
	modelRequests := 0
	decoder := json.NewDecoder(os.Stdin)
	encoder := json.NewEncoder(os.Stdout)
	respondError := func(id any, operation string) error {
		return encoder.Encode(map[string]any{
			"jsonrpc": "2.0", "id": id,
			"error": map[string]any{"code": -32000, "message": "fake " + operation + " failure"},
		})
	}
	catalog := func() map[string]any {
		result := map[string]any{"sessionId": "acp-conformance-session"}
		if features["models"] {
			result["models"] = map[string]any{
				"currentModelId": "model-a",
				"availableModels": []any{
					map[string]any{"modelId": "model-a", "name": "Model A"},
					map[string]any{"modelId": "model-b", "name": "Model B"},
				},
			}
		}
		if features["modes"] {
			result["modes"] = map[string]any{
				"currentModeId": "mode-a",
				"availableModes": []any{
					map[string]any{"id": "mode-a", "name": "Mode A"},
					map[string]any{"id": "mode-b", "name": "Mode B"},
				},
			}
		}
		if features["thinking"] {
			result["configOptions"] = []any{map[string]any{
				"id": "thought_level", "category": "thought_level", "currentValue": "low",
				"options": []any{
					map[string]any{"value": "low", "name": "Low"},
					map[string]any{"value": "high", "name": "High"},
				},
			}}
		}
		return result
	}

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
		params, _ := request["params"].(map[string]any)
		var err error
		switch method {
		case "initialize":
			if failure == "hang" {
				var ignored any
				_ = decoder.Decode(&ignored)
				return 0
			}
			if failure == "initialize" {
				err = respondError(id, "initialize")
				if err != nil {
					return 2
				}
				continue
			}
			capabilities := map[string]any{"promptCapabilities": map[string]any{}}
			if features["image"] {
				capabilities["promptCapabilities"] = map[string]any{"image": true}
			}
			if features["continuation"] {
				capabilities["loadSession"] = true
			}
			err = encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "result": map[string]any{
				"protocolVersion": 1, "agentCapabilities": capabilities,
			}})
		case "session/new":
			if failure == "session" {
				err = respondError(id, "session")
			} else {
				err = encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "result": catalog()})
			}
		case "session/load", "session/resume":
			continued = true
			if failure == "continuation" {
				err = respondError(id, "continuation")
			} else {
				err = encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "result": catalog()})
			}
		case "session/prompt":
			hasImage := false
			blocks, _ := params["prompt"].([]any)
			for _, raw := range blocks {
				block, _ := raw.(map[string]any)
				if block["type"] == "image" {
					hasImage = true
				}
			}
			if hasImage && failure == "image" || !hasImage && failure == "prompt" {
				err = respondError(id, "prompt")
				break
			}
			if failure != "output" {
				text := "fake ACP response"
				if continued {
					text = "continued ACP response"
				}
				if hasImage {
					text = "fake image response"
				}
				if err = encoder.Encode(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{
					"sessionId": "acp-conformance-session",
					"update": map[string]any{
						"sessionUpdate": "agent_message_chunk",
						"content":       map[string]any{"type": "text", "text": text},
					},
				}}); err != nil {
					return 2
				}
			}
			result := map[string]any{"stopReason": "end_turn"}
			if failure == "completion" {
				result = map[string]any{}
			} else if failure == "cancelled" {
				result = map[string]any{"stopReason": "cancelled"}
			}
			err = encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
		case "session/set_model":
			modelRequests++
			if failure == "model" {
				err = respondError(id, "model")
			} else {
				if failure != "model-unacknowledged" && (failure != "model-prepopulated" || modelRequests == 1) {
					options := []any{map[string]any{
						"id": "model", "category": "model", "currentValue": params["modelId"],
					}}
					if features["thinking"] {
						options = append(options, map[string]any{
							"id": "thought_level", "category": "thought_level", "currentValue": "low",
							"options": []any{map[string]any{"value": "low"}, map[string]any{"value": "high"}},
						})
					}
					if err = encoder.Encode(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{
						"sessionId": "acp-conformance-session",
						"update":    map[string]any{"sessionUpdate": "config_option_update", "configOptions": options},
					}}); err != nil {
						return 2
					}
				}
				err = encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "result": map[string]any{}})
			}
		case "session/set_mode":
			if failure == "mode" {
				err = respondError(id, "mode")
			} else {
				if failure != "mode-unacknowledged" {
					if err = encoder.Encode(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{
						"sessionId": "acp-conformance-session",
						"update":    map[string]any{"sessionUpdate": "current_mode_update", "currentModeId": params["modeId"]},
					}}); err != nil {
						return 2
					}
				}
				err = encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "result": map[string]any{}})
			}
		case "session/set_config_option":
			if failure == "thinking" {
				err = respondError(id, "thinking")
			} else {
				result := map[string]any{}
				if failure != "thinking-unacknowledged" {
					result["configOptions"] = []any{map[string]any{
						"id": "thought_level", "category": "thought_level", "currentValue": params["value"],
					}}
				}
				err = encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
			}
		default:
			err = encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "result": map[string]any{}})
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 2
		}
	}
}
