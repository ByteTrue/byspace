package providers

import "testing"

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
