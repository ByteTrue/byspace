package providers

import "testing"

// `opencode models` prints one provider/model per line, but a version notice or warning shares
// stdout on some versions; only a single token containing a slash is a model id.
func TestParseOpenCodeModels(t *testing.T) {
	output := []byte("bytetrueapi/deepseek/deepseek-flash\n" +
		"opencode/big-pickle\n" +
		"\n" +
		"Update available: v2.3.0 (see https://opencode.ai)\n" +
		"bytetrueapi/deepseek/deepseek-flash\n")

	models := parseOpenCodeModels(output)
	if len(models) != 2 {
		t.Fatalf("models = %d, want 2", len(models))
	}
	if models[0].ID != "bytetrueapi/deepseek/deepseek-flash" || models[0].Label != "deepseek-flash" {
		t.Fatalf("first model = %+v", models[0])
	}
	if models[1].ID != "opencode/big-pickle" || models[1].Label != "big-pickle" {
		t.Fatalf("second model = %+v", models[1])
	}
	for _, model := range models {
		if model.Provider != "opencode" || !model.IsSelectable {
			t.Fatalf("model %+v is not a selectable opencode entry", model)
		}
	}
}

// The executable is optional: a name that resolves nowhere must return no models rather than fail
// the snapshot build.
func TestProbeOpenCodeModelsWithoutBinary(t *testing.T) {
	models := ProbeOpenCodeModels(t.Context(), "/nonexistent/opencode-xyz", t.TempDir())
	if len(models) != 0 {
		t.Fatalf("models = %v, want none", models)
	}
}
