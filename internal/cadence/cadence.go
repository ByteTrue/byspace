// Package cadence converts between human durations and five-field cron.
//
// Ported from protocol/schedule/cadence.ts. `--every 15m` has to become a cron expression for the
// schedule engine, and only some intervals can be represented faithfully: `*/7 * * * *` means "every
// 7 minutes past every hour, restarting at each hour", which is not the same as "every 7 minutes".
// The conversion refuses those instead of silently producing a schedule that drifts.
package cadence

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// ErrUnrepresentable reports an interval five-field cron cannot express.
var ErrUnrepresentable = errors.New("interval cannot be represented faithfully by five-field cron")

// ParseDuration reads a human duration: "15m", "2h", "30s", "1d", or a bare number of minutes.
//
// A bare number is minutes rather than milliseconds: a user typing `--every 15` means fifteen
// minutes, and treating it as 15 ms would schedule a job sixty times a second.
func ParseDuration(value string) (time.Duration, error) {
	trimmed := strings.ToLower(strings.TrimSpace(value))
	if trimmed == "" {
		return 0, fmt.Errorf("a duration is required")
	}

	// A plain number is minutes.
	if number, err := strconv.ParseFloat(trimmed, 64); err == nil {
		if number <= 0 {
			return 0, fmt.Errorf("a duration must be positive")
		}
		return time.Duration(number * float64(time.Minute)), nil
	}

	// Split the digits from the unit; `time.ParseDuration` handles most units but not days.
	index := 0
	for index < len(trimmed) && (trimmed[index] >= '0' && trimmed[index] <= '9' || trimmed[index] == '.') {
		index++
	}
	digits, unit := trimmed[:index], trimmed[index:]
	if digits == "" || unit == "" {
		return 0, fmt.Errorf("%q is not a duration", value)
	}
	number, err := strconv.ParseFloat(digits, 64)
	if err != nil || number <= 0 {
		return 0, fmt.Errorf("%q is not a positive duration", value)
	}

	multiplier, ok := map[string]time.Duration{
		"ms": time.Millisecond,
		"s":  time.Second,
		"m":  time.Minute,
		"h":  time.Hour,
		"d":  24 * time.Hour,
		"w":  7 * 24 * time.Hour,
	}[unit]
	if !ok {
		return 0, fmt.Errorf("%q has an unknown unit %q", value, unit)
	}
	return time.Duration(number * float64(multiplier)), nil
}

// EveryMsToFiveFieldCron converts an interval to cron, or reports that it cannot.
//
// Only intervals that divide evenly into the field they land in are accepted: 7 minutes is not,
// because `*/7 * * * *` restarts counting at every hour boundary and the real gap becomes 5 minutes
// once per hour. A schedule that silently drifts is worse than a refusal that says why.
func EveryMsToFiveFieldCron(everyMs int64) (string, error) {
	if everyMs <= 0 {
		return "", fmt.Errorf("an interval must be positive")
	}
	if everyMs%60000 != 0 {
		return "", ErrUnrepresentable
	}
	minutes := everyMs / 60000
	if minutes < 60 && 60%minutes == 0 {
		return fmt.Sprintf("*/%d * * * *", minutes), nil
	}
	if minutes == 60 {
		return "0 * * * *", nil
	}
	if minutes%60 != 0 {
		return "", ErrUnrepresentable
	}
	hours := minutes / 60
	if hours < 24 && 24%hours == 0 {
		return fmt.Sprintf("0 */%d * * *", hours), nil
	}
	if hours == 24 {
		return "0 0 * * *", nil
	}
	return "", ErrUnrepresentable
}

// CompileEveryPreset parses a duration string and converts it to cron.
//
// This is what `--every 15m` does. The error names the reason so the caller can tell the user to use
// `--cron` for a calendar schedule.
func CompileEveryPreset(value string) (string, error) {
	duration, err := ParseDuration(value)
	if err != nil {
		return "", err
	}
	cron, err := EveryMsToFiveFieldCron(duration.Milliseconds())
	if err != nil {
		return "", fmt.Errorf("%s: %w; use --cron for calendar schedules", value, err)
	}
	return cron, nil
}
