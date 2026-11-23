package providers

import (
	"bytes"
	"encoding/json"
	"testing"
)

type acpPermissionWriter struct{ bytes.Buffer }

func (w *acpPermissionWriter) Close() error { return nil }

func TestACPPermissionReturnsExactNativeOption(t *testing.T) {
	writer := &acpPermissionWriter{}
	s := &ACPSession{provider: "generic-acp", stdin: writer, pendingPermissions: map[string]map[string]any{}, permissionRPCIDs: map[string]any{}, eventSubscribers: map[int]func(map[string]any){}}
	var event map[string]any
	s.eventSubscribers[1] = func(e map[string]any) { event = e }
	s.handleNotificationOrRequest("session/request_permission", 7, map[string]any{"params": map[string]any{
		"sessionId": "s1",
		"toolCall":  map[string]any{"toolCallId": "q1", "title": "Choose a fix", "kind": "switch_mode"},
		"options": []any{
			map[string]any{"optionId": "narrow", "name": "Narrow fix", "kind": "allow_once"},
			map[string]any{"optionId": "protocol", "name": "Protocol fix", "kind": "allow_once"},
			map[string]any{"optionId": "skip", "name": "Skip", "kind": "reject_once"},
		},
	}})
	request, _ := event["request"].(map[string]any)
	actions, _ := request["actions"].([]map[string]any)
	if event["type"] != "permission_requested" || request["kind"] != "mode" || len(actions) != 3 || actions[1]["id"] != "protocol" {
		t.Fatalf("request = %#v", event)
	}
	if err := s.RespondToPermission("acp_perm_7", map[string]any{"behavior": "allow", "selectedActionId": "missing"}); err == nil {
		t.Fatal("unknown native option was accepted")
	}
	if len(s.PendingPermissions()) != 1 {
		t.Fatal("invalid response resolved the pending request")
	}
	if err := s.RespondToPermission("acp_perm_7", map[string]any{"behavior": "allow", "selectedActionId": "protocol"}); err != nil {
		t.Fatal(err)
	}
	var response map[string]any
	if err := json.Unmarshal(writer.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	result, _ := response["result"].(map[string]any)
	outcome, _ := result["outcome"].(map[string]any)
	if outcome["outcome"] != "selected" || outcome["optionId"] != "protocol" {
		t.Fatalf("native response = %s", writer.String())
	}
}

func TestACPPermissionDenyCanSelectNativeReject(t *testing.T) {
	writer := &acpPermissionWriter{}
	s := &ACPSession{stdin: writer, pendingPermissions: map[string]map[string]any{}, permissionRPCIDs: map[string]any{"r": 9}, eventSubscribers: map[int]func(map[string]any){}}
	s.pendingPermissions["r"] = map[string]any{"metadata": map[string]any{"options": []any{map[string]any{"optionId": "no", "kind": "reject_once"}}}}
	if err := s.RespondToPermission("r", map[string]any{"behavior": "deny"}); err != nil {
		t.Fatal(err)
	}
	var response map[string]any
	_ = json.Unmarshal(writer.Bytes(), &response)
	outcome, _ := response["result"].(map[string]any)["outcome"].(map[string]any)
	if outcome["outcome"] != "selected" || outcome["optionId"] != "no" {
		t.Fatalf("deny response = %s", writer.String())
	}
}
