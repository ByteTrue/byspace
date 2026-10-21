package server

import "testing"

// The code is what lets the UI offer the right next step; everything reporting UNKNOWN made a
// merge conflict look like an unexplained failure.
func TestClassifyCheckoutError(t *testing.T) {
	cases := map[string]string{
		"fatal: not a git repository (or any of the parent directories): .git": CheckoutErrNotGitRepo,
		"error: Your local changes would be overwritten by merge":              CheckoutErrNotAllowed,
		"error: refusing to merge unrelated histories":                         CheckoutErrNotAllowed,
		"Auto-merging f\nCONFLICT (content): Merge conflict in f":              CheckoutErrMergeConflict,
		"error: Merging is not possible because you have unmerged files.":      CheckoutErrMergeConflict,
		"something unexpected": CheckoutErrUnknown,
	}
	for msg, want := range cases {
		if got := classifyCheckoutError(msg); got != want {
			t.Fatalf("classify(%q) = %q, want %q", msg, got, want)
		}
	}
}

// The payload shape must stay what the protocol expects.
func TestCheckoutErrShape(t *testing.T) {
	got := checkoutErr("fatal: not a git repository")
	if got["code"] != CheckoutErrNotGitRepo {
		t.Fatalf("code = %v", got["code"])
	}
	if got["message"] != "fatal: not a git repository" {
		t.Fatalf("message = %v", got["message"])
	}
}
