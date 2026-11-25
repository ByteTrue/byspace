package providers

import (
	"context"
	"testing"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

func TestACPNegotiatedImageCapability(t *testing.T) {
	for _, tt := range []struct {
		name         string
		capabilities map[string]any
		want         bool
	}{
		{name: "omitted means unsupported"},
		{name: "explicitly unsupported", capabilities: map[string]any{"promptCapabilities": map[string]any{"image": false}}},
		{name: "supported", capabilities: map[string]any{"promptCapabilities": map[string]any{"image": true}}, want: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			s := &ACPSession{agentCapabilities: tt.capabilities}
			if got := s.Capabilities().SupportsImages; got != tt.want {
				t.Fatalf("SupportsImages = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestACPPromptRejectsImagesBeforeStartingTurnWhenUnsupported(t *testing.T) {
	s := &ACPSession{}
	err := s.Prompt(context.Background(), "hello", []sdk.ImageContent{{Data: "image-data"}})
	if err == nil || err.Error() != "ACP agent does not support image input" {
		t.Fatalf("Prompt error = %v", err)
	}
	if s.turnCounter != 0 || s.activeTurnID != "" || s.status == "running" {
		t.Fatalf("rejected prompt started a turn: counter=%d turn=%q status=%q", s.turnCounter, s.activeTurnID, s.status)
	}
}

func TestACPClientCapabilities(t *testing.T) {
	fsOf := func(caps map[string]any) map[string]any {
		fs, _ := caps["fs"].(map[string]any)
		return fs
	}
	config := func(read, write, terminal any) map[string]any {
		return map[string]any{"params": map[string]any{"clientCapabilities": map[string]any{
			"terminal": terminal,
			"fs":       map[string]any{"readTextFile": read, "writeTextFile": write},
		}}}
	}
	tests := []struct {
		name                  string
		config                map[string]any
		read, write, terminal bool
	}{
		{name: "filesystem defaults off", read: false, write: false, terminal: true},
		{name: "read opt in", config: config(true, nil, nil), read: true, write: false, terminal: true},
		{name: "write opt in", config: config(nil, true, nil), read: false, write: true, terminal: true},
		{name: "both opt in", config: config(true, true, nil), read: true, write: true, terminal: true},
		{name: "terminal override", config: config(nil, nil, false), read: false, write: false, terminal: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := acpClientCapabilities(tt.config)
			if fsOf(got)["readTextFile"] != tt.read || fsOf(got)["writeTextFile"] != tt.write || got["terminal"] != tt.terminal {
				t.Fatalf("capabilities = %v, want read=%v write=%v terminal=%v", got, tt.read, tt.write, tt.terminal)
			}
		})
	}
}
