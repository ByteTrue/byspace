package server

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

func TestACPOnboardingResourceIsStableAndNotAnOrdinarySkill(t *testing.T) {
	home := t.TempDir()
	first, err := materializeACPOnboardingResource(home)
	if err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(first) || !strings.HasSuffix(first, filepath.Join("byspace-provider-adapter", "SKILL.md")) {
		t.Fatalf("unexpected resource path %q", first)
	}
	if err := os.WriteFile(first, []byte("stale"), 0o644); err != nil {
		t.Fatal(err)
	}
	second, err := materializeACPOnboardingResource(home)
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatalf("resource moved: %q -> %q", first, second)
	}
	data, err := os.ReadFile(second)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) == "stale" || !strings.Contains(string(data), "read on demand") {
		t.Fatal("resource was not refreshed")
	}
	assertACPOnboardingCommandSequence(t, string(data))
	reference, err := os.ReadFile(filepath.Join(filepath.Dir(second), "references", "acp-config.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(reference), "`fs.readTextFile` and `fs.writeTextFile` default to `false`; `terminal` defaults to `true`") ||
		strings.Contains(string(reference), "| `order`") {
		t.Fatal("ACP reference does not match the negotiated capability defaults and supported fields")
	}
	if slices.Contains(listBundledSkills(extractBundledSkills()), "byspace-provider-adapter") {
		t.Fatal("ACP onboarding resource must not appear in ordinary skill discovery")
	}
	if _, err := os.Stat(filepath.Join(home, ".agents", "skills")); !os.IsNotExist(err) {
		t.Fatal("materialization wrote an agent skill directory")
	}
}

type acpOnboardingRecordingSink struct {
	backlogSink
	frame string
}

func (s *acpOnboardingRecordingSink) SendText(_ context.Context, frame string) error {
	s.frame = frame
	return nil
}

func TestACPOnboardingPromptUsesTheCorrelatedResponsePayload(t *testing.T) {
	sink := new(acpOnboardingRecordingSink)
	server := &Server{homeDir: t.TempDir()}
	server.handleACPOnboardingPrompt(context.Background(), sink, "request-1")
	var response struct {
		Message struct {
			Type    string `json:"type"`
			Payload struct {
				RequestID string  `json:"requestId"`
				Prompt    *string `json:"prompt"`
				Error     *string `json:"error"`
			} `json:"payload"`
		} `json:"message"`
	}
	if err := json.Unmarshal([]byte(sink.frame), &response); err != nil {
		t.Fatal(err)
	}
	if response.Message.Type != "provider.acp.get_onboarding_prompt.response" ||
		response.Message.Payload.RequestID != "request-1" ||
		response.Message.Payload.Prompt == nil ||
		response.Message.Payload.Error != nil {
		t.Fatalf("unexpected response: %s", sink.frame)
	}
	path, err := materializeACPOnboardingResource(server.homeDir)
	if err != nil {
		t.Fatal(err)
	}
	prompt := *response.Message.Payload.Prompt
	if !filepath.IsAbs(path) || !strings.Contains(prompt, strconv.Quote(path)) {
		t.Fatalf("prompt does not contain absolute guide path %q: %q", path, prompt)
	}
	assertACPOnboardingCommandSequence(t, prompt)
}

func assertACPOnboardingCommandSequence(t *testing.T, text string) {
	t.Helper()
	previous := -1
	for _, command := range []string{"byspace provider add acp", "byspace daemon reload", "byspace provider diagnostic", "byspace provider check"} {
		index := strings.Index(text, command)
		if index <= previous {
			t.Fatalf("command %q is missing or out of order in %q", command, text)
		}
		previous = index
	}
}

func TestACPOnboardingResourceFailureReturnsNoPath(t *testing.T) {
	home := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(home, []byte("file"), 0o644); err != nil {
		t.Fatal(err)
	}
	path, err := materializeACPOnboardingResource(home)
	if err == nil || path != "" {
		t.Fatalf("expected an actionable materialization failure, got path=%q err=%v", path, err)
	}
}
