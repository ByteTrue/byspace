package cli

import (
	"encoding/base64"
	"fmt"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// multiFlag collects a repeatable flag value.
//
// `--label a=1 --label b=2` needs an accumulator; the stdlib has no built-in one and a comma-split
// would break a value containing a comma.
type multiFlag []string

func (m *multiFlag) String() string { return strings.Join(*m, ",") }

func (m *multiFlag) Set(value string) error {
	*m = append(*m, value)
	return nil
}

// parseKeyValueFlags turns `key=value` pairs into a map.
//
// Rejected rather than guessed: a flag typed as `--env FOO` with no `=` is a mistake the user wants
// to hear about, and quietly setting FOO to the empty string would run the agent with a broken
// environment.
func parseKeyValueFlags(values []string, flagName string) (map[string]string, error) {
	if len(values) == 0 {
		return nil, nil
	}
	out := make(map[string]string, len(values))
	for _, raw := range values {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" {
			return nil, fmt.Errorf("--%s needs a key=value pair", flagName)
		}
		index := strings.IndexByte(trimmed, '=')
		if index <= 0 {
			return nil, fmt.Errorf("--%s %q is not key=value", flagName, trimmed)
		}
		key := strings.TrimSpace(trimmed[:index])
		if key == "" {
			return nil, fmt.Errorf("--%s %q has an empty key", flagName, trimmed)
		}
		// Everything after the first `=` is the value, so a value may contain `=`.
		out[key] = trimmed[index+1:]
	}
	return out, nil
}

// defaultWaitBudgetMs is how long `byspace run --wait` waits when no timeout was given.
//
// Five minutes is the node CLI's default: long enough for a real task, short enough that a stuck
// agent does not hold the terminal forever.
const defaultWaitBudgetMs = 5 * 60 * 1000

// waitBudget converts `--wait-timeout` into the wait request's millisecond budget.
//
// Zero means "the default", not "wait forever": an unbounded wait on a dead provider never returns,
// and the user's only recourse is Ctrl-C with no indication of what happened.
func waitBudget(timeout time.Duration) int64 {
	if timeout <= 0 {
		return defaultWaitBudgetMs
	}
	return timeout.Milliseconds()
}

// readImageForPrompt loads an image as base64 with its media type.
//
// The daemon takes base64 because the prompt travels over the same JSON channel as the text; reading
// and encoding here keeps the CLI from needing a second upload endpoint. The media type is derived
// from the extension, with a sniff fallback — a wrong type makes the model reject the image.
func readImageForPrompt(path string) (string, string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", "", err
	}
	mediaType := mime.TypeByExtension(strings.ToLower(filepath.Ext(path)))
	if mediaType == "" {
		mediaType = http.DetectContentType(raw)
	}
	// Only the family the daemon accepts. Anything else is a mistake worth reporting: a PDF or a
	// text file sent as an "image" fails deep inside the provider with a confusing message.
	if !strings.HasPrefix(mediaType, "image/") {
		return "", "", fmt.Errorf("%s is %s, not an image", path, mediaType)
	}
	return base64.StdEncoding.EncodeToString(raw), mediaType, nil
}
