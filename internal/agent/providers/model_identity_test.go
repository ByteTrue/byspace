package providers

import "testing"

func TestResolveModelIdentityLetsCodexConfigChooseBareModelProvider(t *testing.T) {
	provider, model, err := ResolveModelIdentity("codex", "gsmagpie/deepseek/deepseek-flash", nil)
	if err != nil {
		t.Fatal(err)
	}
	if provider != "" || model != "gsmagpie/deepseek/deepseek-flash" {
		t.Fatalf("provider=%q model=%q", provider, model)
	}
	provider, model, err = ResolveModelIdentity("codex", "magpie/gsmagpie/deepseek/deepseek-flash", nil)
	if err != nil || provider != "magpie" || model != "gsmagpie/deepseek/deepseek-flash" {
		t.Fatalf("explicit provider=%q model=%q err=%v", provider, model, err)
	}
}
