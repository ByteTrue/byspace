package schedule

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Cron expression parsing, ported from @bytetrue/protocol/schedule/cron-expression.
//
// The previous implementation understood only "*/N" in the minute field and returned "next
// minute" for everything else — so `0 9 * * *` fired every minute instead of once a day. A
// schedule that fires 1440 times where the user asked for once is worse than one that refuses to
// parse.

type cronBounds struct {
	min, max int
	name     string
}

var cronFields = []cronBounds{
	{0, 59, "minute"},
	{0, 23, "hour"},
	{1, 31, "day-of-month"},
	{1, 12, "month"},
	{0, 6, "day-of-week"},
}

// cronMatcher is one parsed field.
type cronMatcher map[int]bool

func (m cronMatcher) matches(value int) bool { return m[value] }

// parsedCron is a full five-field expression.
type parsedCron struct {
	minute, hour, dayOfMonth, month, dayOfWeek cronMatcher
}

// ParseCron parses a five-field cron expression.
func ParseCron(expr string) (*parsedCron, error) {
	fields := strings.Fields(strings.TrimSpace(expr))
	if len(fields) != 5 {
		return nil, fmt.Errorf("invalid cron expression %q: expected 5 fields, got %d", expr, len(fields))
	}
	matchers := make([]cronMatcher, 5)
	for i, field := range fields {
		m, err := parseCronField(field, cronFields[i])
		if err != nil {
			return nil, err
		}
		matchers[i] = m
	}
	return &parsedCron{
		minute:     matchers[0],
		hour:       matchers[1],
		dayOfMonth: matchers[2],
		month:      matchers[3],
		dayOfWeek:  matchers[4],
	}, nil
}

// parseCronField handles a comma-separated list of `*`, `N`, `A-B`, each with an optional /step.
func parseCronField(source string, bounds cronBounds) (cronMatcher, error) {
	trimmed := strings.TrimSpace(source)
	if trimmed == "" {
		return nil, fmt.Errorf("invalid cron %s field", bounds.name)
	}
	out := make(cronMatcher, bounds.max-bounds.min+1)

	for _, rawPart := range strings.Split(trimmed, ",") {
		part := strings.TrimSpace(rawPart)
		if part == "" {
			return nil, fmt.Errorf("invalid cron %s field", bounds.name)
		}
		base, step, err := splitCronStep(part, bounds)
		if err != nil {
			return nil, err
		}

		switch {
		case base == "*":
			for value := bounds.min; value <= bounds.max; value += step {
				out[value] = true
			}
		case strings.Contains(base, "-"):
			startText, endText, _ := strings.Cut(base, "-")
			start, err1 := strconv.Atoi(strings.TrimSpace(startText))
			end, err2 := strconv.Atoi(strings.TrimSpace(endText))
			if err1 != nil || err2 != nil || start < bounds.min || end > bounds.max || start > end {
				return nil, fmt.Errorf("invalid cron %s range %q", bounds.name, base)
			}
			for value := start; value <= end; value += step {
				out[value] = true
			}
		default:
			value, err := strconv.Atoi(base)
			if err != nil || value < bounds.min || value > bounds.max {
				return nil, fmt.Errorf("invalid cron %s value %q", bounds.name, base)
			}
			out[value] = true
		}
	}
	return out, nil
}

// splitCronStep separates the base from an optional /step.
func splitCronStep(part string, bounds cronBounds) (base string, step int, err error) {
	pieces := strings.Split(part, "/")
	if len(pieces) > 2 {
		return "", 0, fmt.Errorf("invalid cron %s step", bounds.name)
	}
	base = strings.TrimSpace(pieces[0])
	step = 1
	if len(pieces) == 2 {
		stepText := strings.TrimSpace(pieces[1])
		parsed, convErr := strconv.Atoi(stepText)
		if convErr != nil || parsed <= 0 || strconv.Itoa(parsed) != stepText {
			return "", 0, fmt.Errorf("invalid cron %s step %q", bounds.name, stepText)
		}
		step = parsed
	}
	if base == "" {
		return "", 0, fmt.Errorf("invalid cron %s field", bounds.name)
	}
	return base, step, nil
}

// Next returns the next time the expression matches, strictly after `now`.
//
// Scans minute by minute over a bounded horizon. Cron's day-of-month/day-of-week interaction is
// "either matches when both are restricted", which minute-by-minute evaluation reproduces
// exactly and a bitmask arithmetic version gets wrong.
func (c *parsedCron) Next(now time.Time) (time.Time, error) {
	cursor := now.Truncate(time.Minute).Add(time.Minute)
	// Four years covers Feb 29 on a specific weekday; anything beyond that is a schedule that
	// will never fire again, which the caller should hear about.
	limit := cursor.AddDate(4, 0, 0)
	domRestricted := !isEveryValue(c.dayOfMonth, 1, 31)
	dowRestricted := !isEveryValue(c.dayOfWeek, 0, 6)

	for cursor.Before(limit) {
		if !c.month.matches(int(cursor.Month())) {
			// Jump to the first day of the next month rather than stepping 40 000 minutes.
			cursor = time.Date(cursor.Year(), cursor.Month(), 1, 0, 0, 0, 0, cursor.Location()).AddDate(0, 1, 0)
			continue
		}
		if !c.dayMatches(cursor, domRestricted, dowRestricted) {
			cursor = time.Date(cursor.Year(), cursor.Month(), cursor.Day(), 0, 0, 0, 0, cursor.Location()).AddDate(0, 0, 1)
			continue
		}
		if !c.hour.matches(cursor.Hour()) {
			cursor = time.Date(cursor.Year(), cursor.Month(), cursor.Day(), cursor.Hour(), 0, 0, 0, cursor.Location()).Add(time.Hour)
			continue
		}
		if !c.minute.matches(cursor.Minute()) {
			cursor = cursor.Add(time.Minute)
			continue
		}
		return cursor, nil
	}
	return time.Time{}, fmt.Errorf("cron expression never matches within four years")
}

// dayMatches applies cron's day rule: when both day fields are restricted the day matches if
// either does; otherwise the restricted one decides.
func (c *parsedCron) dayMatches(t time.Time, domRestricted, dowRestricted bool) bool {
	dom := c.dayOfMonth.matches(t.Day())
	dow := c.dayOfWeek.matches(int(t.Weekday()))
	if domRestricted && dowRestricted {
		return dom || dow
	}
	return dom && dow
}

// isEveryValue reports whether a matcher covers every value in [min,max].
func isEveryValue(m cronMatcher, min, max int) bool {
	for value := min; value <= max; value++ {
		if !m.matches(value) {
			return false
		}
	}
	return true
}
