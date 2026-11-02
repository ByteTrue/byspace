package schedule

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
	// Cron cadences carry an IANA time zone. Windows has no system zone database, so without the
	// embedded copy every schedule with a time zone fails to compute its next run there.
	_ "time/tzdata"
)

// Cron expression parsing, ported from @bytetrue/protocol/schedule/cron-expression, and next-run
// computation, ported from server/schedule/cron.ts. Error messages match Node's: the client shows
// them as they come.

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

var (
	cronRangePattern  = regexp.MustCompile(`^(\d+)-(\d+)$`)
	cronNumberPattern = regexp.MustCompile(`^\d+$`)
)

// ParseCron parses a five-field cron expression.
func ParseCron(expr string) (*parsedCron, error) {
	fields := strings.Fields(strings.TrimSpace(expr))
	if len(fields) != 5 {
		return nil, errors.New("Cron expressions must have 5 fields")
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
// A step on a single value is accepted and ignored, as in Node.
func parseCronField(source string, bounds cronBounds) (cronMatcher, error) {
	trimmed := strings.TrimSpace(source)
	if trimmed == "" {
		return nil, fmt.Errorf("Invalid cron %s field", bounds.name)
	}
	out := make(cronMatcher, bounds.max-bounds.min+1)

	for _, rawPart := range strings.Split(trimmed, ",") {
		part := strings.TrimSpace(rawPart)
		if part == "" {
			return nil, fmt.Errorf("Invalid cron %s field", bounds.name)
		}
		base, step, err := splitCronStep(part, bounds)
		if err != nil {
			return nil, err
		}

		if base == "*" {
			for value := bounds.min; value <= bounds.max; value += step {
				out[value] = true
			}
			continue
		}
		if match := cronRangePattern.FindStringSubmatch(base); match != nil {
			start, _ := strconv.Atoi(match[1])
			end, _ := strconv.Atoi(match[2])
			if start > end || start < bounds.min || end > bounds.max {
				return nil, fmt.Errorf("Invalid cron %s range", bounds.name)
			}
			for value := start; value <= end; value += step {
				out[value] = true
			}
			continue
		}
		if !cronNumberPattern.MatchString(base) {
			return nil, fmt.Errorf("Invalid cron %s value", bounds.name)
		}
		value, convErr := strconv.Atoi(base)
		if convErr != nil || value < bounds.min || value > bounds.max {
			return nil, fmt.Errorf("Invalid cron %s value", bounds.name)
		}
		out[value] = true
	}
	return out, nil
}

// splitCronStep separates the base from an optional /step.
func splitCronStep(part string, bounds cronBounds) (base string, step int, err error) {
	pieces := strings.Split(part, "/")
	if len(pieces) > 2 {
		return "", 0, fmt.Errorf("Invalid cron %s step", bounds.name)
	}
	base = pieces[0]
	step = 1
	if len(pieces) == 2 {
		stepText := strings.TrimSpace(pieces[1])
		parsed, convErr := strconv.Atoi(stepText)
		if convErr != nil || parsed <= 0 || strconv.Itoa(parsed) != stepText {
			return "", 0, fmt.Errorf("Invalid cron %s step", bounds.name)
		}
		step = parsed
	}
	return base, step, nil
}

// loadCronZone resolves a cadence's IANA time zone.
func loadCronZone(timeZone string) (*time.Location, error) {
	// "Local" is the host's zone, which is not a time zone name a schedule can carry.
	if timeZone == "Local" {
		return nil, fmt.Errorf("Invalid cron time zone: %s", timeZone)
	}
	loc, err := time.LoadLocation(timeZone)
	if err != nil {
		return nil, fmt.Errorf("Invalid cron time zone: %s", timeZone)
	}
	return loc, nil
}

// ValidateCadence rejects a cadence that cannot be stored: a malformed cron expression or time zone,
// or an interval that is not a positive number of milliseconds.
//
// Ported from validateScheduleCadence plus the protocol schema the Node store parses every record
// with: a zero interval would fire on every tick.
func ValidateCadence(cadence Cadence) error {
	switch cadence.Type {
	case "every":
		if cadence.EveryMs <= 0 {
			return errors.New("everyMs must be a positive integer")
		}
		return nil
	case "cron":
		if _, err := ParseCron(cadence.Expression); err != nil {
			return err
		}
		if cadence.Timezone != "" {
			if _, err := loadCronZone(cadence.Timezone); err != nil {
				return err
			}
		}
		return nil
	default:
		return fmt.Errorf("Invalid schedule cadence type: %q", cadence.Type)
	}
}

// cronHorizonMinutes bounds the next-run search, as in Node: a year of minutes.
const cronHorizonMinutes = 366 * 24 * 60

// ComputeNextRunAt returns the next fire time strictly after `after`.
//
// Ported from computeNextRunAt. A cron expression is evaluated in its time zone (UTC when it has
// none), minute by minute, and every field must match — day-of-month and day-of-week included, so
// `0 0 13 * 5` is Friday the 13th, not every 13th plus every Friday.
func ComputeNextRunAt(cadence Cadence, after time.Time) (time.Time, error) {
	if cadence.Type == "every" {
		return after.Add(time.Duration(cadence.EveryMs) * time.Millisecond), nil
	}
	cron, err := ParseCron(cadence.Expression)
	if err != nil {
		return time.Time{}, err
	}
	loc := time.UTC
	if cadence.Timezone != "" {
		if loc, err = loadCronZone(cadence.Timezone); err != nil {
			return time.Time{}, err
		}
	}
	cursor := after.UTC().Truncate(time.Minute).Add(time.Minute)
	for index := 0; index < cronHorizonMinutes; index++ {
		local := cursor.In(loc)
		if cron.minute.matches(local.Minute()) &&
			cron.hour.matches(local.Hour()) &&
			cron.dayOfMonth.matches(local.Day()) &&
			cron.month.matches(int(local.Month())) &&
			cron.dayOfWeek.matches(int(local.Weekday())) {
			return cursor, nil
		}
		cursor = cursor.Add(time.Minute)
	}
	return time.Time{}, fmt.Errorf("Unable to compute next run time for cron expression: %s", cadence.Expression)
}
