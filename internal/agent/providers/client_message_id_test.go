package providers

import (
	"os"
	"strings"
	"testing"
)

func TestTakeClientMessageIDConsumesOnce(t *testing.T) {
	var id string
	if got := takeClientMessageID(&id); got != "" {
		t.Fatalf("empty id: got %q", got)
	}
	id = "  client-1  "
	if got := takeClientMessageID(&id); got != "client-1" {
		t.Fatalf("trimmed id: got %q", got)
	}
	if got := takeClientMessageID(&id); got != "" {
		t.Fatalf("second take must be empty, got %q", got)
	}
}

func TestUserMessageStampsClientID(t *testing.T) {
	item := userMessage("hi", "client-1")
	if item.Type != "user_message" || item.Text != "hi" {
		t.Fatalf("wrong row: %+v", item)
	}
	if item.ClientMessageID != "client-1" || item.MessageID != "client-1" {
		t.Fatalf("client id not stamped: %+v", item)
	}

	// Without a client id the row must not invent one: the client would then match a row that
	// was never submitted.
	plain := userMessage("hi", "")
	if plain.ClientMessageID != "" || plain.MessageID != "" {
		t.Fatalf("invented id: %+v", plain)
	}
}

// Every provider has to stamp the client id on the user row it appends, or the client keeps its
// optimistic bubble and never settles the submission. Mock and pi build that row themselves and
// are covered by their own tests; the rest go through the helper, which this guards.
func TestEveryProviderStampsClientMessageID(t *testing.T) {
	for _, file := range []string{"claude.go", "codex.go", "opencode.go", "acp.go"} {
		src, err := os.ReadFile(file)
		if err != nil {
			t.Fatalf("read %s: %v", file, err)
		}
		if !strings.Contains(string(src), "userMessage(message, clientMsgID)") {
			t.Errorf("%s never calls userMessage, so its user row carries no client id", file)
		}
	}
}
