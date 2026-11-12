package hostsync

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestStorePersistsAcrossReopen(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir, "srv_a")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Exchange(nil, []Change{{Kind: KindHost, ID: "srv_x", Data: json.RawMessage(`{"label":"x"}`)}}); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(dir, "srv_a")
	if err != nil {
		t.Fatal(err)
	}
	got, err := reopened.Exchange(nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != "srv_x" || got[0].Author != "srv_a" || got[0].Version != 1 {
		t.Fatalf("reopened replica = %+v", got)
	}
}

// A rejected exchange must leave both memory and disk as they were.
func TestStoreRejectedExchangeChangesNothing(t *testing.T) {
	dir := t.TempDir()
	s, _ := Open(dir, "srv_a")
	if _, err := s.Exchange(nil, []Change{{Kind: KindHost, ID: "srv_x", Data: json.RawMessage(`{"label":"x"}`)}}); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(filepath.Join(dir, Filename))

	_, err := s.Exchange(nil, []Change{
		{Kind: KindHost, ID: "srv_y", Data: json.RawMessage(`{"label":"y"}`)},
		{Kind: KindHost, ID: "srv_z", Data: json.RawMessage(`{"password":"p"}`)},
	})
	if err == nil {
		t.Fatal("exchange with a credential field succeeded")
	}
	after, _ := os.ReadFile(filepath.Join(dir, Filename))
	if string(before) != string(after) {
		t.Fatal("rejected exchange rewrote the file")
	}
	got, _ := s.Exchange(nil, nil)
	if len(got) != 1 {
		t.Fatalf("rejected exchange left %d records in memory, want 1", len(got))
	}
}

// A damaged file must not be treated as an empty replica.
func TestStoreRefusesUnreadableFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, Filename), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(dir, "srv_a"); err == nil {
		t.Fatal("Open accepted an unreadable replica")
	}
}

// A client change made on a stale view still beats the stale records it carried in the same call.
func TestStoreChangeOutranksRecordsInSameExchange(t *testing.T) {
	s, _ := Open(t.TempDir(), "srv_a")
	stale := Record{Kind: KindHost, ID: "srv_x", Version: 40, Author: "srv_b", Data: json.RawMessage(`{"label":"stale"}`)}
	got, err := s.Exchange([]Record{stale}, []Change{{Kind: KindHost, ID: "srv_x", Data: json.RawMessage(`{"label":"mine"}`)}})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || string(got[0].Data) != `{"label":"mine"}` || got[0].Version != 41 {
		t.Fatalf("got %+v, want the client change at version 41", got)
	}
}
