package providers

import "testing"

// The advertisement defaults to handling fs and terminals on the host. A provider's
// `params.clientCapabilities` overrides individual flags so an agent that manages its own
// environment keeps those operations to itself.
func TestACPClientCapabilities(t *testing.T) {
	fsOf := func(caps map[string]any) map[string]any {
		fs, _ := caps["fs"].(map[string]any)
		return fs
	}

	// No config: full host delegation.
	def := acpClientCapabilities(nil)
	if def["terminal"] != true || fsOf(def)["readTextFile"] != true || fsOf(def)["writeTextFile"] != true {
		t.Fatalf("defaults = %v, want all true", def)
	}

	// Container agent: keep terminal and fs inside its own environment.
	container := acpClientCapabilities(map[string]any{
		"params": map[string]any{
			"clientCapabilities": map[string]any{
				"terminal": false,
				"fs":       map[string]any{"readTextFile": false, "writeTextFile": false},
			},
		},
	})
	if container["terminal"] != false || fsOf(container)["readTextFile"] != false || fsOf(container)["writeTextFile"] != false {
		t.Fatalf("container = %v, want all false", container)
	}

	// Partial override: only the named flag changes, the rest keep their defaults.
	partial := acpClientCapabilities(map[string]any{
		"params": map[string]any{
			"clientCapabilities": map[string]any{
				"fs": map[string]any{"writeTextFile": false},
			},
		},
	})
	if partial["terminal"] != true || fsOf(partial)["readTextFile"] != true || fsOf(partial)["writeTextFile"] != false {
		t.Fatalf("partial = %v, want terminal+read true, write false", partial)
	}
}
