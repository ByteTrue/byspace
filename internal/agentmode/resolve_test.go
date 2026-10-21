package agentmode

import (
	"errors"
	"strings"
	"testing"
)

func strPtr(value string) *string { return &value }

// A mode is a provider-specific posture with provider-specific ids, so copying one across providers
// hands the child a mode its provider does not recognise.
func TestCrossProviderInheritanceIsRefused(t *testing.T) {
	parent := &Parent{Provider: "claude", ModeID: strPtr("acceptEdits")}
	_, err := Resolve(Input{
		Provider:       "codex",
		Parent:         parent,
		AvailableModes: []string{"plan", "auto"},
	})
	if !errors.Is(err, ErrModeNotInheritable) {
		t.Fatalf("err = %v", err)
	}
	// The message has to tell the caller what to do and what is available.
	for _, want := range []string{"acceptEdits", "claude", "codex", "Pass an explicit mode", "plan, auto"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("message missing %q: %v", want, err)
		}
	}
}

// An unattended parent keeps its intent (run without asking) even though the id does not survive.
func TestUnattendedBridgesAcrossProviders(t *testing.T) {
	got, err := Resolve(Input{
		Provider:             "codex",
		Parent:               &Parent{Provider: "claude", ModeID: strPtr("acceptEdits"), Unattended: true},
		AvailableModes:       []string{"plan", "unattended"},
		TargetUnattendedMode: strPtr("unattended"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || *got != "unattended" {
		t.Fatalf("mode = %v", got)
	}
}

// Within one provider the id means the same thing.
func TestSameProviderInherits(t *testing.T) {
	got, err := Resolve(Input{
		Provider:       "claude",
		Parent:         &Parent{Provider: "claude", ModeID: strPtr("acceptEdits")},
		AvailableModes: []string{"plan", "acceptEdits"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || *got != "acceptEdits" {
		t.Fatalf("mode = %v", got)
	}
}

// An explicit mode is validated when the provider's modes are known, and passes through when they
// are not: refusing an unknown set would block every provider whose modes we have not probed.
func TestExplicitModeValidation(t *testing.T) {
	if _, err := Resolve(Input{Provider: "claude", Requested: strPtr("plan"), AvailableModes: []string{"plan", "default"}}); err != nil {
		t.Fatalf("a valid mode was refused: %v", err)
	}
	if _, err := Resolve(Input{Provider: "claude", Requested: strPtr("nope"), AvailableModes: []string{"plan"}}); err == nil {
		t.Fatal("an invalid mode must be refused when the set is known")
	}
	// nil = unknown: pass through.
	if got, err := Resolve(Input{Provider: "claude", Requested: strPtr("anything")}); err != nil || got == nil {
		t.Fatalf("an unvalidated mode should pass through: %v %v", got, err)
	}
}

// An empty non-nil slice means the provider has no modes, which is a different answer from unknown.
func TestProviderWithoutModes(t *testing.T) {
	got, err := Resolve(Input{
		Provider:       "mine",
		Parent:         &Parent{Provider: "claude", ModeID: strPtr("plan")},
		AvailableModes: []string{},
	})
	if err != nil || got != nil {
		t.Fatalf("got %v %v", got, err)
	}
}

// No parent and not unattended: the provider's default.
func TestNoParentNoUnattended(t *testing.T) {
	got, err := Resolve(Input{Provider: "claude", AvailableModes: []string{"plan"}})
	if err != nil || got != nil {
		t.Fatalf("got %v %v", got, err)
	}
	// Unattended with a target unattended mode picks it.
	got, err = Resolve(Input{Provider: "claude", Unattended: true, TargetUnattendedMode: strPtr("unattended")})
	if err != nil || got == nil || *got != "unattended" {
		t.Fatalf("got %v %v", got, err)
	}
}

// A nil mode is never unattended.
func TestIsUnattended(t *testing.T) {
	modes := map[string]bool{"unattended": true}
	if IsUnattended(nil, modes) {
		t.Fatal("a nil mode is not unattended")
	}
	if !IsUnattended(strPtr("unattended"), modes) {
		t.Fatal("unattended should be unattended")
	}
	if IsUnattended(strPtr("plan"), modes) {
		t.Fatal("plan is not unattended")
	}
}
