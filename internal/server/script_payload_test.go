package server

import "testing"

// WorkspaceScriptPayloadSchema names the fields scriptName/type/hostname/port/lifecycle/health.
// Sending name/status instead makes the whole response fail client-side validation, so the
// script panel shows nothing at all.
func TestWorkspaceScriptPayloadMatchesProtocol(t *testing.T) {
	entry := &workspaceScript{
		WorkspaceID: "wks_1",
		Name:        "dev",
		Command:     "vite",
		Status:      "running",
		StartedAt:   "2026-01-01T00:00:00Z",
	}
	payload := workspaceScriptPayload(entry)

	if payload["scriptName"] != "dev" {
		t.Fatalf("expected scriptName, got %+v", payload)
	}
	if _, ok := payload["name"]; ok {
		t.Fatal("`name` is not part of the schema; `scriptName` is")
	}
	if payload["lifecycle"] != "running" {
		t.Fatalf("LifecycleSchema is running|stopped, got %v", payload["lifecycle"])
	}
	for _, key := range []string{"hostname", "port", "localProxyUrl", "publicProxyUrl", "proxyUrl", "health", "exitCode", "terminalId"} {
		if _, ok := payload[key]; !ok {
			t.Fatalf("missing required key %q in %+v", key, payload)
		}
	}
}

func TestWorkspaceScriptPayloadStoppedLifecycle(t *testing.T) {
	payload := workspaceScriptPayload(&workspaceScript{Name: "build", Status: "failed"})
	// A failed run is not "running"; the enum has no "failed".
	if payload["lifecycle"] != "stopped" {
		t.Fatalf("expected stopped lifecycle for a failed script, got %v", payload["lifecycle"])
	}
}
