package server

import (
	"reflect"
	"testing"
)

// Narrowing the install targets deletes the copies in the dropped homes. The daemon names what it would destroy and
// waits, instead of deleting directories the request never mentioned.
func TestUnconfirmedRemovals(t *testing.T) {
	ops := []skillOp{
		{Kind: "delete", Name: "byspace"},
		{Kind: "delete", Name: "byspace-advisor"},
		{Kind: "install", Name: "other"},
	}

	// Nothing confirmed: every delete is named, sorted so the question reads the same twice.
	got := unconfirmedRemovals(ops, nil)
	if !reflect.DeepEqual(got, []string{"byspace", "byspace-advisor"}) {
		t.Fatalf("got %v", got)
	}

	// Everything confirmed: nothing left to ask about.
	got = unconfirmedRemovals(ops, []string{"byspace", "byspace-advisor"})
	if len(got) != 0 {
		t.Fatalf("got %v", got)
	}

	// Partial confirmation asks only about the rest.
	got = unconfirmedRemovals(ops, []string{"byspace"})
	if !reflect.DeepEqual(got, []string{"byspace-advisor"}) {
		t.Fatalf("got %v", got)
	}

	// An install-only plan has nothing to confirm.
	if got := unconfirmedRemovals([]skillOp{{Kind: "install", Name: "x"}}, nil); len(got) != 0 {
		t.Fatalf("got %v", got)
	}
}
