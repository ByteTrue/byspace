package providers

import (
	"strings"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// takeClientMessageID consumes the id SetNextClientMessageID recorded, so a later turn cannot
// inherit it. Providers call it under their own lock.
func takeClientMessageID(id *string) string {
	trimmed := strings.TrimSpace(*id)
	*id = ""
	return trimmed
}

// userMessage builds the row for a prompt, stamping the client id when there is one.
//
// The id has to come back on the provider's own row: the client renders the bubble optimistically
// from it, then reconciles — or drops its copy — when the row arrives. A row without it is a
// second bubble and a submission that never settles. MessageID mirrors it because the client keys
// the rewind trigger on `capabilities && messageId`, and a user row the provider took ownership of
// needs something to rewind to.
func userMessage(text string, clientID string) sdk.TimelineItem {
	item := sdk.TimelineItem{Type: "user_message", Text: text}
	if clientID != "" {
		item.MessageID = clientID
		item.ClientMessageID = clientID
	}
	return item
}
