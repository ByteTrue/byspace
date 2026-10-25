package cli

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/ByteTrue/byspace/internal/home"
	"github.com/ByteTrue/byspace/internal/store"
)

// `byspace onboard` writes a working configuration in one step.
//
// Ported from commands/onboard.ts. The wizard exists because a first run has several decisions
// that all have to be right before anything works — listen address, relay endpoint, CORS origin,
// MCP injection — and discovering them one failure at a time is a bad introduction. Every flag is
// optional; the defaults are what a single-machine setup wants, and running it again with one
// flag changed is how the user fixes it.

// relayEndpoint is the parsed --relay-endpoint value.
type relayEndpoint struct {
	endpoint string
	useTLS   bool
}

// parseRelayEndpoint accepts host[:port] or ws(s)://host[:port].
//
// The scheme implies useTls, and a missing port defaults to 443 for TLS and 80 otherwise — which
// is why the scheme has to be read before the port is defaulted.
func parseRelayEndpoint(raw string) (relayEndpoint, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return relayEndpoint{}, errors.New("--relay-endpoint requires a value")
	}

	scheme := ""
	hostPort := trimmed
	for _, candidate := range []string{"wss", "ws", "https", "http"} {
		prefix := candidate + "://"
		if strings.HasPrefix(trimmed, prefix) {
			scheme = candidate
			hostPort = strings.TrimRight(strings.TrimPrefix(trimmed, prefix), "/")
			break
		}
	}

	defaultPort := func() int {
		if scheme == "ws" || scheme == "http" {
			return 80
		}
		return 443
	}

	var host, portText string
	if strings.HasPrefix(hostPort, "[") {
		// An IPv6 literal keeps its brackets; the port follows the closing bracket.
		end := strings.Index(hostPort, "]")
		if end < 0 {
			return relayEndpoint{}, fmt.Errorf("invalid --relay-endpoint value: %s (expected [host]:port)", raw)
		}
		host = hostPort[:end+1]
		rest := hostPort[end+1:]
		if rest != "" {
			if !strings.HasPrefix(rest, ":") {
				return relayEndpoint{}, fmt.Errorf("invalid --relay-endpoint value: %s (expected [host]:port)", raw)
			}
			portText = rest[1:]
		}
	} else if index := strings.LastIndex(hostPort, ":"); index >= 0 {
		host = hostPort[:index]
		portText = hostPort[index+1:]
		if strings.Contains(host, ":") {
			return relayEndpoint{}, fmt.Errorf(
				"invalid --relay-endpoint value: %s (wrap IPv6 hosts in brackets, e.g. [::1]:8081)", raw)
		}
	} else {
		host = hostPort
	}

	port := defaultPort()
	if portText != "" {
		parsed, err := strconv.Atoi(portText)
		if err != nil || parsed < 1 || parsed > 65535 {
			return relayEndpoint{}, fmt.Errorf(
				"invalid --relay-endpoint value: %s (expected host[:port] or ws(s)://host[:port])", raw)
		}
		port = parsed
	}
	if host == "" {
		return relayEndpoint{}, fmt.Errorf(
			"invalid --relay-endpoint value: %s (expected host[:port] or ws(s)://host[:port])", raw)
	}

	useTLS := port == 443
	if scheme != "" {
		useTLS = scheme == "wss" || scheme == "https"
	}
	return relayEndpoint{endpoint: net.JoinHostPort(strings.Trim(host, "[]"), strconv.Itoa(port)), useTLS: useTLS}, nil
}

// runOnboard writes the configuration.
func runOnboard(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("onboard", flag.ContinueOnError)
	homeDir := fs.String("home", "", "byspace home directory")
	listen := fs.String("listen", "", "daemon listen address")
	port := fs.Int("port", 0, "daemon port")
	relayOn := fs.Bool("relay", false, "enable the relay")
	noRelay := fs.Bool("no-relay", false, "disable the relay")
	relayEndpointFlag := fs.String("relay-endpoint", "", "self-hosted relay (host[:port] or ws(s)://host[:port])")
	webOrigin := fs.String("web-origin", "", "allowed CORS origin for a separately hosted web UI")
	injectMCP := fs.Bool("mcp", true, "inject the built-in MCP server into agents")
	// A separate variable: registering two flags on one *bool makes the second registration
	// overwrite the first's default, which silently turned injection off.
	noMCP := fs.Bool("no-mcp", false, "do not inject the built-in MCP server")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *noMCP {
		*injectMCP = false
	}

	// Contradictory combinations are rejected rather than resolved by precedence: silently
	// picking one leaves the user with a config they did not ask for.
	if *listen != "" && *port != 0 {
		return errors.New("cannot use --listen and --port together")
	}
	if *noRelay && *relayEndpointFlag != "" {
		return errors.New("cannot use --no-relay together with --relay-endpoint")
	}

	resolvedHome, err := home.Resolve(*homeDir)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(resolvedHome, 0o700); err != nil {
		return err
	}

	st := store.New(resolvedHome)
	patch := map[string]any{}

	if *listen != "" {
		patch["bindAddress"] = *listen
	} else if *port != 0 {
		patch["bindAddress"] = fmt.Sprintf("127.0.0.1:%d", *port)
	}

	// --relay-endpoint implies the relay: the user is pointing at their own, so the hosted
	// default and the enable prompt are moot.
	switch {
	case *relayEndpointFlag != "":
		target, parseErr := parseRelayEndpoint(*relayEndpointFlag)
		if parseErr != nil {
			return parseErr
		}
		relayConfig := map[string]any{"enabled": true, "endpoint": target.endpoint, "useTls": target.useTLS}
		patch["relay"] = relayConfig
	case *noRelay:
		patch["relay"] = map[string]any{"enabled": false}
	case *relayOn:
		patch["relay"] = map[string]any{"enabled": true}
	}

	if *webOrigin != "" {
		existing := daemonConfigSection(st, "cors")
		origins, _ := existing["allowedOrigins"].([]any)
		merged := make([]any, 0, len(origins)+1)
		seen := false
		for _, origin := range origins {
			if text, ok := origin.(string); ok && text == *webOrigin {
				seen = true
			}
			merged = append(merged, origin)
		}
		if !seen {
			merged = append(merged, *webOrigin)
		}
		patch["cors"] = map[string]any{"allowedOrigins": merged}
	}

	mcpSection := daemonConfigSection(st, "mcp")
	enabled, _ := mcpSection["enabled"].(bool)
	inject, _ := mcpSection["injectIntoAgents"].(bool)
	if !*injectMCP {
		enabled = false
		inject = false
	} else if _, wasSet := mcpSection["enabled"]; !wasSet {
		// Default on: the orchestration tools are the reason to run BySpace at all.
		enabled = true
		inject = true
	}
	patch["mcp"] = map[string]any{"enabled": enabled, "injectIntoAgents": inject}

	st.SaveDaemonConfig(patch)

	fmt.Fprintf(stdout, "bySpace home: %s\n", resolvedHome)
	fmt.Fprintf(stdout, "config:       %s\n", filepath.Join(resolvedHome, "config.json"))
	if address, ok := patch["bindAddress"].(string); ok {
		fmt.Fprintf(stdout, "listen:       %s\n", address)
	}
	if relay, ok := patch["relay"].(map[string]any); ok {
		if on, _ := relay["enabled"].(bool); on {
			endpoint, _ := relay["endpoint"].(string)
			fmt.Fprintf(stdout, "relay:        enabled %s\n", endpoint)
		} else {
			fmt.Fprintln(stdout, "relay:        disabled")
		}
	}
	fmt.Fprintf(stdout, "mcp:          enabled=%v injectIntoAgents=%v\n", enabled, inject)
	fmt.Fprintln(stdout)
	fmt.Fprintln(stdout, "Next: byspace daemon start, then open the web UI.")
	return nil
}

// daemonConfigSection reads one top-level section of the stored config.
func daemonConfigSection(st *store.Store, key string) map[string]any {
	cfg := st.LoadDaemonConfig()
	if cfg == nil {
		return map[string]any{}
	}
	section, ok := cfg[key].(map[string]any)
	if !ok {
		return map[string]any{}
	}
	return section
}
