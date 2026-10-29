package cli

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/home"
	"github.com/ByteTrue/byspace/internal/server"
	"github.com/ByteTrue/byspace/internal/store"
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

// reportRelayStatus prints whether this daemon is reachable from outside.
//
// Ported from selectRelayStatus. The answer decides whether the phone can connect at all, and
// "disabled" versus "configured but not connected" are different problems with different fixes —
// printing one line for both leaves the user guessing which they have.
//
// live is the daemon's own answer from /health, and it wins. Config is intent: a daemon started
// with `--relay` dials an endpoint that never reaches config.json, so reading the file reported
// the old address for a daemon that was connected elsewhere. Config is still the fallback, for a
// daemon too old to report its state.
func reportRelayStatus(stdout io.Writer, homeFlag string, live *relayHealth) {
	if live != nil {
		reportLiveRelayStatus(stdout, live)
		return
	}

	resolvedHome, err := home.Resolve(homeFlag)
	if err != nil {
		return
	}
	config := store.New(resolvedHome).LoadDaemonConfig()
	// Read it through the same resolver the runtime uses, so `status` reports where the daemon
	// actually connects rather than whatever literal the file happens to carry. Checking
	// `publicEndpoint` by hand said "enabled but no publicEndpoint configured" for the common home
	// that only stores `enabled: true`, while the daemon was connecting to the hosted relay fine.
	relay := server.ResolveRelayConfig(config)
	if !relay.Enabled {
		fmt.Fprintln(stdout, "relay     disabled")
		return
	}
	endpoint := relay.ClientRelayEndpoint()
	if strings.TrimSpace(endpoint) == "" {
		// Configured but incomplete: the daemon will never connect, and the user needs to know the
		// endpoint is what is missing rather than assuming the network is at fault.
		fmt.Fprintln(stdout, "relay     enabled but no endpoint configured")
		return
	}
	scheme := "ws"
	if relay.ClientRelayUseTLS() {
		scheme = "wss"
	}
	fmt.Fprintf(stdout, "relay     %s://%s\n", scheme, endpoint)
}

// reportLiveRelayStatus prints the daemon's own answer.
//
// "connected" and "configured but never reached" are separated because the first means a phone can
// pair right now and the second means nothing will work until the endpoint or the network does.
func reportLiveRelayStatus(stdout io.Writer, live *relayHealth) {
	if !live.Enabled {
		fmt.Fprintln(stdout, "relay     disabled")
		return
	}
	endpoint := strings.TrimSpace(live.Endpoint)
	if endpoint == "" {
		fmt.Fprintln(stdout, "relay     enabled but no endpoint configured")
		return
	}
	scheme := "ws"
	if live.UseTLS {
		scheme = "wss"
	}
	if connected := strings.TrimSpace(live.Connected); connected != "" {
		if connected != endpoint {
			// A --relay override: the flag is the whole configuration for this run, so say what it
			// reached rather than what the file asked for.
			fmt.Fprintf(stdout, "relay     %s://%s (override)\n", scheme, connected)
			return
		}
		fmt.Fprintf(stdout, "relay     %s://%s\n", scheme, endpoint)
		return
	}
	fmt.Fprintf(stdout, "relay     %s://%s (not connected)\n", scheme, endpoint)
}

// readPromptText resolves the message text and agent id from the three input forms.
//
// Precedence: --prompt-file, then --prompt, then the positional argument. A file is what a script
// uses when the message would blow past the shell's argument limit or contains quoting that is not
// worth escaping; `-` reads stdin for a pipeline.
func readPromptText(positional []string, promptFlag, promptFile string) (string, string, error) {
	agentID := ""
	if len(positional) > 0 {
		agentID = positional[0]
	}

	if file := strings.TrimSpace(promptFile); file != "" {
		if agentID == "" {
			return "", "", errors.New("usage: byspace send --prompt-file <path> <agent-id>")
		}
		var raw []byte
		var err error
		if file == "-" {
			raw, err = io.ReadAll(os.Stdin)
		} else {
			raw, err = os.ReadFile(file)
		}
		if err != nil {
			return "", "", err
		}
		text := strings.TrimSpace(string(raw))
		if text == "" {
			return "", "", fmt.Errorf("%s is empty", file)
		}
		return text, agentID, nil
	}

	if text := strings.TrimSpace(promptFlag); text != "" {
		if agentID == "" {
			return "", "", errors.New("usage: byspace send --prompt <text> <agent-id>")
		}
		return text, agentID, nil
	}

	if agentID == "" || len(positional) < 2 {
		return "", "", errors.New("usage: byspace send [options] <agent-id> <prompt>")
	}
	return strings.Join(positional[1:], " "), agentID, nil
}
