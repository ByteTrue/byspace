package cadence

import (
	"errors"
	"testing"
	"time"
)

// A bare number is minutes: `--every 15` means fifteen minutes, and reading it as 15 ms would
// schedule a job sixty times a second.
func TestParseDurationUnits(t *testing.T) {
	cases := map[string]time.Duration{
		"15":   15 * time.Minute,
		"30s":  30 * time.Second,
		"15m":  15 * time.Minute,
		"2h":   2 * time.Hour,
		"1d":   24 * time.Hour,
		"1w":   7 * 24 * time.Hour,
		" 5m ": 5 * time.Minute,
		"1.5h": 90 * time.Minute,
	}
	for input, want := range cases {
		got, err := ParseDuration(input)
		if err != nil {
			t.Fatalf("%q: %v", input, err)
		}
		if got != want {
			t.Fatalf("%q = %v, want %v", input, got, want)
		}
	}
}

// Zero, negative and nonsense all have to fail: a schedule with no interval fires constantly.
func TestParseDurationRejections(t *testing.T) {
	for _, input := range []string{"", "0", "-5", "0m", "abc", "5x", "m", "5"} {
		if input == "5" {
			continue // a bare number is valid
		}
		if _, err := ParseDuration(input); err == nil {
			t.Fatalf("%q should be rejected", input)
		}
	}
}

// Only intervals that divide evenly into their field are accepted: `*/7 * * * *` restarts counting
// at every hour, so the real gap is 5 minutes once per hour. A drifting schedule is worse than a
// refusal.
func TestEveryMsToCron(t *testing.T) {
	cases := map[int64]string{
		60_000:        "*/1 * * * *",
		5 * 60_000:    "*/5 * * * *",
		15 * 60_000:   "*/15 * * * *",
		30 * 60_000:   "*/30 * * * *",
		60 * 60_000:   "0 * * * *",
		2 * 3600_000:  "0 */2 * * *",
		6 * 3600_000:  "0 */6 * * *",
		12 * 3600_000: "0 */12 * * *",
		24 * 3600_000: "0 0 * * *",
	}
	for everyMs, want := range cases {
		got, err := EveryMsToFiveFieldCron(everyMs)
		if err != nil {
			t.Fatalf("%d: %v", everyMs, err)
		}
		if got != want {
			t.Fatalf("%d = %q, want %q", everyMs, got, want)
		}
	}
}

func TestEveryMsToCronRejectsUnrepresentable(t *testing.T) {
	for _, everyMs := range []int64{
		7 * 60_000,   // 60 % 7 != 0
		90 * 60_000,  // 1.5 hours, neither a minute divisor nor an hour divisor
		5 * 3600_000, // 24 % 5 != 0
		36 * 3600_000,
		90_000, // sub-minute
		0,
		-60_000,
	} {
		if cron, err := EveryMsToFiveFieldCron(everyMs); err == nil {
			t.Fatalf("%d should be rejected, got %q", everyMs, cron)
		}
	}
}

// The refusal has to tell the user what to do instead, not just that it failed.
func TestCompileEveryPresetExplains(t *testing.T) {
	cron, err := CompileEveryPreset("15m")
	if err != nil || cron != "*/15 * * * *" {
		t.Fatalf("%q %v", cron, err)
	}

	_, err = CompileEveryPreset("7m")
	if err == nil {
		t.Fatal("7m should be rejected")
	}
	if !errors.Is(err, ErrUnrepresentable) {
		t.Fatalf("error should wrap ErrUnrepresentable: %v", err)
	}
	if !contains(err.Error(), "--cron") {
		t.Fatalf("the error should point at --cron: %v", err)
	}
}

// contains is a substring test.
func contains(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
