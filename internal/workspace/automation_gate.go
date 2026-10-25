package workspace

import (
	"fmt"

	"github.com/ByteTrue/byspace/internal/store"
)

// Workspace automation gate, ported from workspace-automation-gate.ts.
//
// A worktree checked out from someone else's pull request contains a `byspace.json` written by
// that person. Running its setup commands or scripts is running their code — the same trust
// boundary as `npm install` from an untrusted branch, except it happens on a button press with no
// prompt. So a workspace created from a change request remembers where it came from and refuses
// automation until the user says otherwise.

// AutomationBlockedError reports why automation was refused.
type AutomationBlockedError struct {
	Source store.UntrustedSource
}

func (e AutomationBlockedError) Error() string {
	noun := "PR"
	if e.Source.Forge == "gitlab" {
		noun = "MR"
	}
	return fmt.Sprintf(
		"Scripts are blocked for %s #%d from %s. Run setup to allow them.",
		noun, e.Source.Number, e.Source.HeadRepository,
	)
}
