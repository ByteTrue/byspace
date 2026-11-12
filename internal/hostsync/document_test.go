package hostsync

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"strings"
	"testing"
	"time"
)

var t0 = time.Date(2026, 11, 12, 0, 0, 0, 0, time.UTC)

func data(s string) json.RawMessage { return json.RawMessage(s) }

func mustChange(t *testing.T, d *Document, c Change, author string, now time.Time) Record {
	t.Helper()
	r, err := d.Apply(c, author, now)
	if err != nil {
		t.Fatalf("apply %+v: %v", c, err)
	}
	return r
}

func mustMerge(t *testing.T, d *Document, rs []Record) {
	t.Helper()
	if err := d.Merge(rs); err != nil {
		t.Fatalf("merge: %v", err)
	}
}

func hostLabel(t *testing.T, d *Document, id string) string {
	t.Helper()
	r, ok := d.Get(KindHost, id)
	if !ok {
		return "<missing>"
	}
	if r.Deleted {
		return "<deleted>"
	}
	var v struct {
		Label string `json:"label"`
	}
	if err := json.Unmarshal(r.Data, &v); err != nil {
		t.Fatalf("decode %s: %v", id, err)
	}
	return v.Label
}

// The spec's acceptance case: two daemons are cut off, each edits a different host, and after
// they exchange both edits survive. A whole-document last-writer-wins would drop one of them.
func TestPartitionedEditsToDifferentHostsBothSurvive(t *testing.T) {
	laptop, vps := NewDocument(), NewDocument()
	seed := mustChange(t, laptop, Change{Kind: KindHost, ID: "srv_a", Data: data(`{"label":"a0"}`)}, "srv_laptop", t0)
	seed2 := mustChange(t, laptop, Change{Kind: KindHost, ID: "srv_b", Data: data(`{"label":"b0"}`)}, "srv_laptop", t0)
	mustMerge(t, vps, []Record{seed, seed2})

	mustChange(t, laptop, Change{Kind: KindHost, ID: "srv_a", Data: data(`{"label":"a-laptop"}`)}, "srv_laptop", t0)
	mustChange(t, vps, Change{Kind: KindHost, ID: "srv_b", Data: data(`{"label":"b-vps"}`)}, "srv_vps", t0)

	mustMerge(t, laptop, vps.Records())
	mustMerge(t, vps, laptop.Records())

	for _, d := range []*Document{laptop, vps} {
		if got := hostLabel(t, d, "srv_a"); got != "a-laptop" {
			t.Fatalf("srv_a = %q, want a-laptop", got)
		}
		if got := hostLabel(t, d, "srv_b"); got != "b-vps" {
			t.Fatalf("srv_b = %q, want b-vps", got)
		}
	}
}

// Same record edited on both sides: every replica must pick the same winner whatever order the
// exchanges happen in. The edit made after seeing more history (higher logical version) wins.
func TestConcurrentEditsToSameHostConverge(t *testing.T) {
	a, b := NewDocument(), NewDocument()
	seed := mustChange(t, a, Change{Kind: KindHost, ID: "srv_x", Data: data(`{"label":"x0"}`)}, "srv_a", t0)
	mustMerge(t, b, []Record{seed})

	// a edits twice, b once: a's second edit has the higher version.
	mustChange(t, a, Change{Kind: KindHost, ID: "srv_x", Data: data(`{"label":"a1"}`)}, "srv_a", t0)
	mustChange(t, a, Change{Kind: KindHost, ID: "srv_x", Data: data(`{"label":"a2"}`)}, "srv_a", t0)
	mustChange(t, b, Change{Kind: KindHost, ID: "srv_x", Data: data(`{"label":"b1"}`)}, "srv_b", t0)

	ab, ba := a.Clone(), b.Clone()
	mustMerge(t, ab, b.Records())
	mustMerge(t, ba, a.Records())
	if hostLabel(t, ab, "srv_x") != "a2" || hostLabel(t, ba, "srv_x") != "a2" {
		t.Fatalf("diverged: ab=%q ba=%q, want a2 on both", hostLabel(t, ab, "srv_x"), hostLabel(t, ba, "srv_x"))
	}
}

// Equal versions from different authors: the tie must break the same way on both sides.
func TestEqualVersionTieBreaksDeterministically(t *testing.T) {
	a, b := NewDocument(), NewDocument()
	ra := mustChange(t, a, Change{Kind: KindHost, ID: "srv_x", Data: data(`{"label":"from-a"}`)}, "srv_a", t0)
	rb := mustChange(t, b, Change{Kind: KindHost, ID: "srv_x", Data: data(`{"label":"from-b"}`)}, "srv_b", t0)
	if ra.Version != rb.Version {
		t.Fatalf("setup: versions %d %d should be equal", ra.Version, rb.Version)
	}
	mustMerge(t, a, []Record{rb})
	mustMerge(t, b, []Record{ra})
	if hostLabel(t, a, "srv_x") != hostLabel(t, b, "srv_x") {
		t.Fatalf("tie diverged: %q vs %q", hostLabel(t, a, "srv_x"), hostLabel(t, b, "srv_x"))
	}
}

// A deletion made while another replica was offline must not be undone when that replica comes
// back with its stale copy.
func TestDeletionIsNotResurrectedByStaleReplica(t *testing.T) {
	a, b := NewDocument(), NewDocument()
	seed := mustChange(t, a, Change{Kind: KindHost, ID: "srv_x", Data: data(`{"label":"x"}`)}, "srv_a", t0)
	mustMerge(t, b, []Record{seed})

	mustChange(t, a, Change{Kind: KindHost, ID: "srv_x", Delete: true}, "srv_a", t0)
	mustMerge(t, a, b.Records()) // b still has the live copy
	if got := hostLabel(t, a, "srv_x"); got != "<deleted>" {
		t.Fatalf("after stale merge srv_x = %q, want deleted", got)
	}
	mustMerge(t, b, a.Records())
	if got := hostLabel(t, b, "srv_x"); got != "<deleted>" {
		t.Fatalf("deletion did not propagate: %q", got)
	}
}

// Host tombstones go after 90 days; member tombstones stay forever so a removed daemon cannot be
// synced back in by a replica that never heard of the removal.
func TestPurgeKeepsMemberTombstonesForever(t *testing.T) {
	d := NewDocument()
	mustChange(t, d, Change{Kind: KindHost, ID: "srv_h", Data: data(`{"label":"h"}`)}, "srv_a", t0)
	mustChange(t, d, Change{Kind: KindHost, ID: "srv_h", Delete: true}, "srv_a", t0)
	mustChange(t, d, Change{Kind: KindMember, ID: "srv_m", Data: data(`{"publicKey":"k"}`)}, "srv_a", t0)
	mustChange(t, d, Change{Kind: KindMember, ID: "srv_m", Delete: true}, "srv_a", t0)

	d.Purge(t0.Add(89 * 24 * time.Hour))
	if _, ok := d.Get(KindHost, "srv_h"); !ok {
		t.Fatal("host tombstone purged before 90 days")
	}
	d.Purge(t0.Add(91 * 24 * time.Hour))
	if _, ok := d.Get(KindHost, "srv_h"); ok {
		t.Fatal("host tombstone kept after 90 days")
	}
	if r, ok := d.Get(KindMember, "srv_m"); !ok || !r.Deleted {
		t.Fatal("member tombstone must be kept forever")
	}
}

// A removed member stays removed even if some replica re-adds it with a higher version.
func TestRemovedMemberCannotBeSyncedBack(t *testing.T) {
	a, b := NewDocument(), NewDocument()
	seed := mustChange(t, a, Change{Kind: KindMember, ID: "srv_m", Data: data(`{"publicKey":"k"}`)}, "srv_a", t0)
	mustMerge(t, b, []Record{seed})
	mustChange(t, a, Change{Kind: KindMember, ID: "srv_m", Delete: true}, "srv_a", t0)
	// b keeps editing the member it still believes in, pushing its version past the tombstone.
	for i := 0; i < 5; i++ {
		mustChange(t, b, Change{Kind: KindMember, ID: "srv_m", Data: data(`{"publicKey":"k2"}`)}, "srv_b", t0)
	}
	mustMerge(t, a, b.Records())
	mustMerge(t, b, a.Records())
	for name, d := range map[string]*Document{"a": a, "b": b} {
		if r, ok := d.Get(KindMember, "srv_m"); !ok || !r.Deleted {
			t.Fatalf("%s: removed member came back", name)
		}
	}
	if _, err := a.Apply(Change{Kind: KindMember, ID: "srv_m", Data: data(`{"publicKey":"k3"}`)}, "srv_a", t0); !errors.Is(err, ErrMemberRemoved) {
		t.Fatalf("re-adding a removed member: err = %v, want ErrMemberRemoved", err)
	}
}

// The synced data must never carry credentials: the replica sits on every daemon.
func TestRejectsCredentialFields(t *testing.T) {
	cases := []string{
		`{"label":"x","password":"p"}`,
		`{"connections":[{"type":"relay","token":"t"}]}`,
		`{"nested":{"Bearer":"b"}}`,
		`{"apiKey":"k"}`,
		`{"secretKey":"s"}`,
	}
	for _, c := range cases {
		d := NewDocument()
		if _, err := d.Apply(Change{Kind: KindHost, ID: "srv_x", Data: data(c)}, "srv_a", t0); !errors.Is(err, ErrCredentialField) {
			t.Errorf("Apply(%s) err = %v, want ErrCredentialField", c, err)
		}
		r := Record{Kind: KindHost, ID: "srv_x", Version: 1, Author: "srv_a", Data: data(c)}
		if err := d.Merge([]Record{r}); !errors.Is(err, ErrCredentialField) {
			t.Errorf("Merge(%s) err = %v, want ErrCredentialField", c, err)
		}
	}
	// Public keys are not credentials.
	d := NewDocument()
	mustChange(t, d, Change{Kind: KindHost, ID: "srv_x", Data: data(`{"daemonPublicKeyB64":"pk","label":"x"}`)}, "srv_a", t0)
}

func TestRejectsOversizedDocumentAndLeavesItUnchanged(t *testing.T) {
	d := NewDocument()
	mustChange(t, d, Change{Kind: KindHost, ID: "srv_keep", Data: data(`{"label":"keep"}`)}, "srv_a", t0)
	before := len(d.Records())
	big := fmt.Sprintf(`{"label":%q}`, strings.Repeat("x", MaxDocumentBytes))
	if _, err := d.Apply(Change{Kind: KindHost, ID: "srv_big", Data: data(big)}, "srv_a", t0); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("err = %v, want ErrTooLarge", err)
	}
	if got := len(d.Records()); got != before {
		t.Fatalf("records = %d after rejected apply, want %d", got, before)
	}
	r := Record{Kind: KindHost, ID: "srv_big", Version: 99, Author: "srv_b", Data: data(big)}
	if err := d.Merge([]Record{r}); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("merge err = %v, want ErrTooLarge", err)
	}
	if _, ok := d.Get(KindHost, "srv_big"); ok {
		t.Fatal("oversized merge left a partial write")
	}
}

func TestRejectsUnknownKindAndEmptyID(t *testing.T) {
	d := NewDocument()
	if _, err := d.Apply(Change{Kind: "settings", ID: "x", Data: data(`{}`)}, "srv_a", t0); err == nil {
		t.Fatal("unknown kind accepted")
	}
	if _, err := d.Apply(Change{Kind: KindHost, ID: " ", Data: data(`{}`)}, "srv_a", t0); err == nil {
		t.Fatal("empty id accepted")
	}
	if _, err := d.Apply(Change{Kind: KindHost, ID: "x", Data: data(`[1,2]`)}, "srv_a", t0); err == nil {
		t.Fatal("non-object data accepted")
	}
}

// Merge is order-independent and idempotent: three replicas exchanging in random orders all end
// with the same records.
func TestMergeConvergesInAnyOrder(t *testing.T) {
	rng := rand.New(rand.NewSource(7))
	authors := []string{"srv_a", "srv_b", "srv_c"}
	docs := []*Document{NewDocument(), NewDocument(), NewDocument()}
	for step := 0; step < 300; step++ {
		i := rng.Intn(3)
		id := fmt.Sprintf("srv_%d", rng.Intn(6))
		kind := KindHost
		if rng.Intn(5) == 0 {
			kind = KindRule
		}
		c := Change{Kind: kind, ID: id, Data: data(fmt.Sprintf(`{"label":"%s-%d"}`, authors[i], step))}
		if rng.Intn(4) == 0 {
			c = Change{Kind: kind, ID: id, Delete: true}
		}
		mustChange(t, docs[i], c, authors[i], t0)
		if rng.Intn(3) == 0 {
			j := rng.Intn(3)
			mustMerge(t, docs[j], docs[i].Records())
		}
	}
	// Final full exchange in a shuffled order, twice to prove idempotence.
	for round := 0; round < 2; round++ {
		for _, p := range rng.Perm(9) {
			from, to := p/3, p%3
			mustMerge(t, docs[to], docs[from].Records())
		}
	}
	want, _ := json.Marshal(docs[0].Records())
	for i := 1; i < 3; i++ {
		got, _ := json.Marshal(docs[i].Records())
		if string(got) != string(want) {
			t.Fatalf("replica %d diverged", i)
		}
	}
}
