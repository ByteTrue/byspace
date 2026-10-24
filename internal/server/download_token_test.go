package server

import (
	"testing"
	"time"
)

// Tokens are only checked on use, so without pruning they accumulate for the life of the
// daemon: every file preview the user ever opened leaves an entry.
func TestPruneDownloadTokensDropsExpired(t *testing.T) {
	srv := &Server{downloadTokens: map[string]downloadTokenEntry{
		"live":    {fileName: "a", expiresAt: time.Now().Add(time.Minute)},
		"expired": {fileName: "b", expiresAt: time.Now().Add(-time.Minute)},
	}}

	srv.pruneDownloadTokensLocked()

	if _, ok := srv.downloadTokens["live"]; !ok {
		t.Fatal("a live token must survive")
	}
	if _, ok := srv.downloadTokens["expired"]; ok {
		t.Fatal("an expired token must be pruned")
	}
}
