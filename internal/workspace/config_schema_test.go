package workspace

import "testing"

// The daemon reads this file to run setup and scripts, so a wrong shape silently disables them
// long after the edit that caused it.
func TestValidateProjectConfigAcceptsValid(t *testing.T) {
	valid := []map[string]any{
		{},
		{"setup": "npm ci"},
		{"setup": []any{"npm ci", "npm run build"}},
		{"scripts": map[string]any{"dev": "vite"}},
		{"scripts": map[string]any{"dev": map[string]any{"command": "vite", "type": "service"}}},
		// The editor round-trips whatever it read and the app writes "service"; the daemon only
		// special-cases that one value, so any other string must still save.
		{"scripts": map[string]any{"dev": map[string]any{"command": "vite", "type": "server"}}},
		{"port": float64(3000)},
	}
	for i, cfg := range valid {
		if err := ValidateProjectConfig(cfg); err != nil {
			t.Fatalf("case %d should be valid: %v", i, err)
		}
	}
}

func TestValidateProjectConfigRejectsBadShapes(t *testing.T) {
	invalid := []map[string]any{
		{"setup": float64(1)},
		{"setup": []any{"ok", float64(2)}},
		{"setup": ""},
		{"scripts": "npm run dev"},
		{"scripts": map[string]any{"dev": map[string]any{}}},
		{"scripts": map[string]any{"dev": map[string]any{"command": ""}}},
		{"scripts": map[string]any{"dev": map[string]any{"command": "vite", "type": float64(1)}}},
		{"scripts": map[string]any{"dev": ""}},
		{"port": "3000"},
	}
	for i, cfg := range invalid {
		if err := ValidateProjectConfig(cfg); err == nil {
			t.Fatalf("case %d should have been rejected: %#v", i, cfg)
		}
	}
}

// The messages must name the field, or the editor can only say "invalid".
func TestValidateProjectConfigMessagesAreSpecific(t *testing.T) {
	err := ValidateProjectConfig(map[string]any{
		"scripts": map[string]any{"web": map[string]any{"command": "vite", "type": float64(1)}},
	})
	if err == nil {
		t.Fatal("expected an error")
	}
	if got := err.Error(); got == "" || !containsAll(got, "scripts.web.type", "string") {
		t.Fatalf("message is not specific: %q", got)
	}
}

func containsAll(haystack string, needles ...string) bool {
	for _, needle := range needles {
		found := false
		for i := 0; i+len(needle) <= len(haystack); i++ {
			if haystack[i:i+len(needle)] == needle {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}
