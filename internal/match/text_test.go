package match

import "testing"

// Tiers are the contract: callers sort ascending and never invent a scale.
func TestMatchTiers(t *testing.T) {
	cases := []struct {
		query, text string
		wantTier    int
	}{
		{"byspace", "byspace", TierExact},
		{"byspace", "the byspace app", TierWholeWord},
		{"bysp", "byspace", TierPrefix},
		{"app", "by appspace", TierWordStart},
		{"spac", "byspace", TierSubstring},
		{"bsc", "byspace", TierSubsequence},
	}
	for _, tc := range cases {
		got := Match(tc.query, tc.text, nil)
		if got == nil {
			t.Fatalf("%q in %q should match", tc.query, tc.text)
		}
		if got.Tier != tc.wantTier {
			t.Fatalf("%q in %q -> tier %d, want %d", tc.query, tc.text, got.Tier, tc.wantTier)
		}
	}
}

func TestMatchNoMatch(t *testing.T) {
	if got := Match("zzzz", "byspace", nil); got != nil {
		t.Fatalf("expected no match, got %+v", got)
	}
}

// A four-character token only forgives a transposition: a free substitution would turn "main"
// into "mail", "maid" and "rain".
func TestPolicyForToken(t *testing.T) {
	if p := PolicyForToken("abc"); p != nil {
		t.Fatalf("three-character tokens must match exactly, got %+v", p)
	}
	p := PolicyForToken("main")
	if p == nil || p.MaxEdits != 1 || !p.TranspositionsOnly {
		t.Fatalf("four-character tokens get transpositions only, got %+v", p)
	}
	p = PolicyForToken("maina")
	if p == nil || p.MaxEdits != 1 || p.TranspositionsOnly {
		t.Fatalf("five-character tokens get one edit, got %+v", p)
	}
	// Seven characters is still within the one-edit band; eight crosses into two.
	p = PolicyForToken("maintai")
	if p == nil || p.MaxEdits != 1 || p.TranspositionsOnly {
		t.Fatalf("seven-character tokens get one edit, got %+v", p)
	}
	p = PolicyForToken("maintian")
	if p == nil || p.MaxEdits != 2 || p.TranspositionsOnly {
		t.Fatalf("long tokens get two edits, got %+v", p)
	}
}

// Subsequence wins over fuzzy, which is why the daemon leaves subsequence on for path search:
// `mian` is a subsequence of `main branch` before typo tolerance is consulted at all.
func TestMatchSubsequenceBeatsFuzzy(t *testing.T) {
	got := Match("mian", "main branch", PolicyForToken("mian"))
	if got == nil || got.Tier != TierSubsequence {
		t.Fatalf("expected subsequence, got %+v", got)
	}
}

// A typo that is not a subsequence does reach the fuzzy tier.
func TestMatchFuzzyTransposition(t *testing.T) {
	got := Match("mian", "mianfile", PolicyForToken("mian"))
	if got == nil {
		t.Fatal("expected a match")
	}
	// `mian` is a prefix of `mianfile`, so it resolves before fuzzy — assert the fuzzy tier
	// directly through a word the query cannot reach any other way.
	fuzzy := scoreFuzzy("hlelo", "say hello there", PolicyForToken("hlelo"))
	if fuzzy == nil || fuzzy.Tier != TierFuzzy {
		t.Fatalf("expected a fuzzy match for a transposition, got %+v", fuzzy)
	}
}

// Path matching must see through separators: a compacted query still finds the path.
func TestMatchPathIgnoresSeparators(t *testing.T) {
	got := MatchPath("packagesappsrc", "packages/app/src")
	if got == nil {
		t.Fatal("expected a compacted match across separators")
	}
	// The reported offset must map back to the original string, not the compacted one.
	if got.Offset < 0 || got.Offset >= len("packages/app/src") {
		t.Fatalf("offset %d is outside the original path", got.Offset)
	}
}
