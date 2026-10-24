package workspace

import (
	"strings"
	"testing"

	"github.com/ByteTrue/byspace/internal/store"
)

// A worktree from someone else's PR carries their byspace.json; running it is running their code.
func TestAutomationBlockedForCrossRepositoryChangeRequest(t *testing.T) {
	src := &store.UntrustedSource{
		Kind: "change_request", Forge: "github", Number: 42, HeadRepository: "attacker/fork",
	}
	if !src.IsBlocked() {
		t.Fatal("a cross-repository change request must block automation")
	}
	msg := AutomationBlockedError{Source: *src}.Error()
	for _, want := range []string{"PR", "#42", "attacker/fork", "Run setup"} {
		if !strings.Contains(msg, want) {
			t.Fatalf("message %q is missing %q: the user needs to know what they are trusting", msg, want)
		}
	}
}

// A change request from the same repository is already trusted: the user has that code checked out.
func TestAutomationAllowedWhenHeadRepositoryUnknown(t *testing.T) {
	src := &store.UntrustedSource{Kind: "change_request", Forge: "github", Number: 7}
	if src.IsBlocked() {
		t.Fatal("a same-repository change request must not block")
	}
	if (*store.UntrustedSource)(nil).IsBlocked() {
		t.Fatal("nil source must not block")
	}
}

// GitLab calls it an MR; the message must use the vocabulary the user sees in that product.
func TestAutomationBlockedMessageUsesForgeNoun(t *testing.T) {
	msg := AutomationBlockedError{Source: store.UntrustedSource{
		Kind: "change_request", Forge: "gitlab", Number: 9, HeadRepository: "team/fork",
	}}.Error()
	if !strings.Contains(msg, "MR #9") {
		t.Fatalf("expected MR wording for gitlab: %q", msg)
	}
}
