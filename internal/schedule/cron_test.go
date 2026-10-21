package schedule

import (
	"testing"
	"time"
)

func mustCron(t *testing.T, expr string) *parsedCron {
	t.Helper()
	parsed, err := ParseCron(expr)
	if err != nil {
		t.Fatalf("ParseCron(%q): %v", expr, err)
	}
	return parsed
}

// `0 9 * * *` must fire once a day at 09:00, not every minute. The old implementation returned
// "next minute" for anything it did not recognise, which turned a daily schedule into 1440 runs.
func TestDailyCronFiresOncePerDay(t *testing.T) {
	parsed := mustCron(t, "0 9 * * *")
	now := time.Date(2026, 10, 21, 8, 30, 0, 0, time.UTC)

	next, err := parsed.Next(now)
	if err != nil {
		t.Fatal(err)
	}
	want := time.Date(2026, 10, 21, 9, 0, 0, 0, time.UTC)
	if !next.Equal(want) {
		t.Fatalf("next = %v, want %v", next, want)
	}

	// The following occurrence is a day later, not a minute later.
	after, err := parsed.Next(next)
	if err != nil {
		t.Fatal(err)
	}
	if !after.Equal(want.AddDate(0, 0, 1)) {
		t.Fatalf("second occurrence = %v", after)
	}
}

func TestStepCron(t *testing.T) {
	parsed := mustCron(t, "*/15 * * * *")
	now := time.Date(2026, 10, 21, 8, 7, 0, 0, time.UTC)
	next, _ := parsed.Next(now)
	if !next.Equal(time.Date(2026, 10, 21, 8, 15, 0, 0, time.UTC)) {
		t.Fatalf("next = %v", next)
	}
}

// Ranges and lists are the common way to express "weekday mornings".
func TestRangeAndListCron(t *testing.T) {
	parsed := mustCron(t, "0 9-11 * * 1-5")
	// Saturday 2026-10-24 → next is Monday 09:00.
	now := time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)
	next, err := parsed.Next(now)
	if err != nil {
		t.Fatal(err)
	}
	want := time.Date(2026, 10, 26, 9, 0, 0, 0, time.UTC)
	if !next.Equal(want) {
		t.Fatalf("next = %v, want %v", next, want)
	}

	list := mustCron(t, "0 0 1,15 * *")
	next, _ = list.Next(time.Date(2026, 10, 2, 0, 0, 0, 0, time.UTC))
	if !next.Equal(time.Date(2026, 10, 15, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("list next = %v", next)
	}
}

// Cron's day rule: when both day fields are restricted, either matching is enough.
func TestDayOfMonthOrWeekday(t *testing.T) {
	parsed := mustCron(t, "0 0 13 * 5")
	// 2026-11-13 is a Friday and the 13th; 2026-11-06 is a Friday but not the 13th.
	// Both must match. Start just after the 6th to see the next one.
	now := time.Date(2026, 11, 6, 1, 0, 0, 0, time.UTC)
	next, err := parsed.Next(now)
	if err != nil {
		t.Fatal(err)
	}
	if next.Day() != 13 || next.Month() != time.November {
		t.Fatalf("next = %v, want 2026-11-13 00:00", next)
	}
}

// Month jumps must not scan minute by minute through weeks of non-matching days.
func TestMonthRestriction(t *testing.T) {
	parsed := mustCron(t, "0 0 1 1 *")
	now := time.Date(2026, 10, 21, 0, 0, 0, 0, time.UTC)
	next, err := parsed.Next(now)
	if err != nil {
		t.Fatal(err)
	}
	if !next.Equal(time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("next = %v", next)
	}
}

// A malformed expression must be rejected, not silently reinterpreted.
func TestInvalidCronRejected(t *testing.T) {
	for _, expr := range []string{
		"", "0 9 * *", "0 9 * * * *", "60 * * * *", "* 24 * * *",
		"*/0 * * * *", "5-1 * * * *", "abc * * * *", "1,,2 * * * *",
		"1/2/3 * * * *",
	} {
		if _, err := ParseCron(expr); err == nil {
			t.Fatalf("%q should have been rejected", expr)
		}
	}
}

// An unparseable cron must not fall back to "every minute": that is exactly the runaway the old
// implementation produced.
func TestComputeNextRunAtRejectsBadCron(t *testing.T) {
	now := time.Date(2026, 10, 21, 9, 0, 0, 0, time.UTC)
	if got := computeNextRunAt(now, Cadence{Type: "cron", Expression: "not a cron"}); got != nil {
		t.Fatalf("expected no next-run time for a bad expression, got %v", *got)
	}
}
