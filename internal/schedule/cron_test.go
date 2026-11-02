package schedule

import (
	"strings"
	"testing"
	"time"
)

func nextRun(t *testing.T, cadence Cadence, after time.Time) time.Time {
	t.Helper()
	next, err := ComputeNextRunAt(cadence, after)
	if err != nil {
		t.Fatalf("ComputeNextRunAt(%+v): %v", cadence, err)
	}
	return next
}

func cron(expression string) Cadence { return Cadence{Type: "cron", Expression: expression} }

// `0 9 * * *` fires once a day at 09:00, not every minute.
func TestDailyCronFiresOncePerDay(t *testing.T) {
	now := time.Date(2026, 10, 21, 8, 30, 0, 0, time.UTC)
	next := nextRun(t, cron("0 9 * * *"), now)
	want := time.Date(2026, 10, 21, 9, 0, 0, 0, time.UTC)
	if !next.Equal(want) {
		t.Fatalf("next = %v, want %v", next, want)
	}
	if after := nextRun(t, cron("0 9 * * *"), next); !after.Equal(want.AddDate(0, 0, 1)) {
		t.Fatalf("second occurrence = %v", after)
	}
}

func TestStepRangeAndListCron(t *testing.T) {
	if next := nextRun(t, cron("*/15 * * * *"), time.Date(2026, 10, 21, 8, 7, 0, 0, time.UTC)); !next.Equal(time.Date(2026, 10, 21, 8, 15, 0, 0, time.UTC)) {
		t.Fatalf("step next = %v", next)
	}
	// Saturday 2026-10-24 → next weekday morning is Monday 09:00.
	if next := nextRun(t, cron("0 9-11 * * 1-5"), time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)); !next.Equal(time.Date(2026, 10, 26, 9, 0, 0, 0, time.UTC)) {
		t.Fatalf("range next = %v", next)
	}
	if next := nextRun(t, cron("0 0 1,15 * *"), time.Date(2026, 10, 2, 0, 0, 0, 0, time.UTC)); !next.Equal(time.Date(2026, 10, 15, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("list next = %v", next)
	}
	if next := nextRun(t, cron("0 0 1 1 *"), time.Date(2026, 10, 21, 0, 0, 0, 0, time.UTC)); !next.Equal(time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("month next = %v", next)
	}
}

// Node matches every field, day-of-month and day-of-week together: `0 0 13 * 5` is Friday the
// 13th. Vixie cron's "either day field" rule would fire on the next Friday (2026-11-20) instead.
func TestDayOfMonthAndWeekdayBothMatch(t *testing.T) {
	next := nextRun(t, cron("0 0 13 * 5"), time.Date(2026, 11, 14, 0, 0, 0, 0, time.UTC))
	if want := time.Date(2027, 8, 13, 0, 0, 0, 0, time.UTC); !next.Equal(want) {
		t.Fatalf("next = %v, want %v (the next Friday the 13th)", next, want)
	}
}

// A cron cadence is read in its time zone: 09:00 in Hong Kong is 01:00 UTC.
func TestCronUsesItsTimeZone(t *testing.T) {
	cadence := Cadence{Type: "cron", Expression: "0 9 * * *", Timezone: "Asia/Hong_Kong"}
	next := nextRun(t, cadence, time.Date(2026, 10, 21, 2, 0, 0, 0, time.UTC))
	if want := time.Date(2026, 10, 22, 1, 0, 0, 0, time.UTC); !next.Equal(want) {
		t.Fatalf("next = %v, want %v", next, want)
	}
}

func TestEveryCadenceAddsTheInterval(t *testing.T) {
	after := time.Date(2026, 10, 21, 2, 0, 0, 0, time.UTC)
	if next := nextRun(t, Cadence{Type: "every", EveryMs: 90_000}, after); !next.Equal(after.Add(90 * time.Second)) {
		t.Fatalf("next = %v", next)
	}
}

// Malformed input is rejected with Node's messages, which the client shows as they come.
func TestInvalidCadenceRejected(t *testing.T) {
	cases := map[string]Cadence{
		"Cron expressions must have 5 fields": cron("0 9 * *"),
		"Invalid cron minute value":           cron("60 * * * *"),
		"Invalid cron hour value":             cron("* 24 * * *"),
		"Invalid cron minute step":            cron("*/0 * * * *"),
		"Invalid cron minute range":           cron("5-1 * * * *"),
		"Invalid cron minute field":           cron("1,,2 * * * *"),
		"Invalid cron time zone: Mars/Base":   {Type: "cron", Expression: "0 9 * * *", Timezone: "Mars/Base"},
		"everyMs must be a positive integer":  {Type: "every"},
	}
	for want, cadence := range cases {
		err := ValidateCadence(cadence)
		if err == nil || err.Error() != want {
			t.Fatalf("ValidateCadence(%+v) = %v, want %q", cadence, err, want)
		}
	}
	for _, expr := range []string{"", "0 9 * * * *", "abc * * * *", "1/2/3 * * * *", "+5 * * * *"} {
		if _, err := ParseCron(expr); err == nil {
			t.Fatalf("%q should have been rejected", expr)
		}
	}
}

// An expression that never matches within a year is an error, not a runaway or a silent park.
func TestCronWithoutAnOccurrenceFails(t *testing.T) {
	_, err := ComputeNextRunAt(cron("0 0 30 2 *"), time.Date(2026, 10, 21, 0, 0, 0, 0, time.UTC))
	if err == nil || !strings.Contains(err.Error(), "Unable to compute next run time") {
		t.Fatalf("err = %v", err)
	}
}
