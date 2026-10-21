// Package replaytime normalizes timestamps read from provider transcripts.
//
// Ported from provider-history-timestamps.ts. Each provider writes time in its own shape: Claude uses
// ISO strings, others use a unix epoch number that may be seconds or milliseconds. A reader that only
// accepts one shape loses the others, and the import then stamps every message with the same fallback
// time — the transcript reads correctly but its ordering and its timeline are wrong.
package replaytime

import (
	"strconv"
	"strings"
	"time"
)

// Normalize converts a provider transcript timestamp into RFC3339, or "" when it is unusable.
//
// Three shapes are accepted: an ISO-ish string, a unix epoch in seconds, and a unix epoch in
// milliseconds. The number threshold is 1e12: a value above it is already milliseconds (1e12 ms is
// 2001; 1e12 s is the year 33658), so the comparison distinguishes the two without a unit field.
func Normalize(value any) string {
	switch typed := value.(type) {
	case string:
		return fromString(typed)
	case float64:
		return fromEpoch(typed)
	case int64:
		return fromEpoch(float64(typed))
	case int:
		return fromEpoch(float64(typed))
	}
	return ""
}

// fromString parses the string shapes providers write.
func fromString(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	// A numeric string is an epoch: `encoding/json` gives a string here when the provider quoted the
	// number, and losing it would fall back to the shared fallback time.
	if number, err := strconv.ParseFloat(trimmed, 64); err == nil {
		return fromEpoch(number)
	}
	for _, layout := range []string{
		time.RFC3339Nano,
		time.RFC3339,
		// Some providers write a space instead of the `T`. Same instant.
		"2006-01-02 15:04:05",
		"2006-01-02T15:04:05",
	} {
		if parsed, err := time.Parse(layout, trimmed); err == nil {
			return parsed.UTC().Format(time.RFC3339Nano)
		}
	}
	return ""
}

// fromEpoch renders a unix timestamp, treating a small value as seconds.
func fromEpoch(value float64) string {
	if value <= 0 {
		return ""
	}
	milliseconds := value
	if value < 1e12 {
		milliseconds = value * 1000
	}
	rendered := time.UnixMilli(int64(milliseconds)).UTC()
	// A value far outside a plausible range is a corrupted timestamp, not a date in the year 50000.
	// Returning "" makes the caller use its fallback, which is at least a real time.
	if rendered.Year() < 1970 || rendered.Year() > 3000 {
		return ""
	}
	return rendered.Format(time.RFC3339Nano)
}
