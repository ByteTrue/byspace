package workspace

import (
	"errors"
	"fmt"
	"testing"
)

// The client switches on these codes to offer the right next step: a branch already checked out
// means "pick another name", an unknown branch means "fetch first". One generic code made every
// failure look the same.
func TestToWorktreeWireError(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{
			"missing checkout target",
			fmt.Errorf("wrapped: %w", MissingCheckoutTargetError{}),
			WorktreeErrMissingCheckoutTarget,
		},
		{
			"branch already checked out",
			errors.New("fatal: 'feat' is already checked out at '/x'"),
			WorktreeErrBranchAlreadyCheckedOut,
		},
		{
			"branch already used by worktree",
			errors.New("fatal: 'feat' is already used by worktree at '/x'"),
			WorktreeErrBranchAlreadyCheckedOut,
		},
		{
			"unknown branch",
			errors.New("fatal: invalid reference: nope"),
			WorktreeErrUnknownBranch,
		},
		{
			"unknown revision",
			errors.New("fatal: ambiguous argument 'nope': unknown revision"),
			WorktreeErrUnknownBranch,
		},
		{
			"anything else",
			errors.New("disk full"),
			WorktreeErrUnknown,
		},
	}
	for _, tc := range cases {
		code, msg := ToWorktreeWireError(tc.err)
		if code != tc.want {
			t.Fatalf("%s: code = %q, want %q", tc.name, code, tc.want)
		}
		if msg != tc.err.Error() {
			t.Fatalf("%s: message = %q", tc.name, msg)
		}
	}

	if code, msg := ToWorktreeWireError(nil); code != WorktreeErrUnknown || msg != "" {
		t.Fatalf("nil error: %q %q", code, msg)
	}
}

// A wrapped MissingCheckoutTargetError must still be recognised: the git layer wraps errors.
func TestToWorktreeWireErrorUnwraps(t *testing.T) {
	wrapped := fmt.Errorf("outer: %w", fmt.Errorf("inner: %w", MissingCheckoutTargetError{}))
	if code, _ := ToWorktreeWireError(wrapped); code != WorktreeErrMissingCheckoutTarget {
		t.Fatalf("code = %q", code)
	}
}
