package workspace

import (
	"encoding/json"
	"strings"
	"testing"
)

// The protocol declares requestId as a required string on every checkout_status variant, including the
// broadcast `checkout_status_update`, which has no request to name. With `omitempty` an empty id vanished
// from the JSON entirely and the client rejected the whole message — every checkout status update was
// dropped, so the Changes pane and the PR strip never populated.
func TestCheckoutStatusAlwaysCarriesRequestID(t *testing.T) {
	encoded, err := json.Marshal(CheckoutStatus{IsGit: false})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), `"requestId":""`) {
		t.Fatalf("requestId omitted from a broadcast: %s", encoded)
	}
}
