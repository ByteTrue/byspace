package replaytime

import (
	"strings"
	"testing"
)

// Each provider writes time in its own shape; losing one stamps every message with the same fallback
// time, which reads correctly but has the wrong order.
func TestNormalizeShapes(t *testing.T) {
	cases := []struct {
		in   any
		want string
	}{
		{"2026-03-01T12:40:00Z", "2026-03-01T12:40:00Z"},
		{"2026-03-01T12:40:00.123456789Z", "2026-03-01T12:40:00.123456789Z"},
		// Seconds.
		{float64(1772368800), "2026-03-01T12:40:00Z"},
		// Milliseconds: the same instant, and the threshold is what tells them apart.
		{float64(1772368800000), "2026-03-01T12:40:00Z"},
		{int64(1772368800), "2026-03-01T12:40:00Z"},
		// A numeric string is still an epoch.
		{"1772368800", "2026-03-01T12:40:00Z"},
		// A space instead of the `T` is the same instant.
		{"2026-03-01 12:40:00", "2026-03-01T12:40:00Z"},
	}
	for _, c := range cases {
		if got := Normalize(c.in); got != c.want {
			t.Fatalf("Normalize(%v) = %q, want %q", c.in, got, c.want)
		}
	}
}

// An unusable value returns "" so the caller can use its own fallback rather than a wrong date.
func TestNormalizeRejections(t *testing.T) {
	for _, in := range []any{nil, "", "   ", "not a time", "2026-13-45T99:99:99Z", float64(0), float64(-5), 0} {
		if got := Normalize(in); got != "" {
			t.Fatalf("Normalize(%v) = %q, want empty", in, got)
		}
	}
}

// A value far outside a plausible range is a corrupted timestamp, not the year 50000.
func TestNormalizeRejectsAbsurdEpochs(t *testing.T) {
	if got := Normalize(float64(1e15)); got != "" {
		t.Fatalf("absurd epoch = %q", got)
	}
}

// The output is always RFC3339 with a UTC zone, so downstream sorting compares strings correctly.
func TestNormalizeAlwaysUTC(t *testing.T) {
	got := Normalize("2026-03-01T10:00:00+08:00")
	if !strings.HasSuffix(got, "Z") {
		t.Fatalf("not UTC: %q", got)
	}
	if got != "2026-03-01T02:00:00Z" {
		t.Fatalf("got %q", got)
	}
}
