// Package ssh provides the `-H ssh://user@host` transport for the CLI.
//
// Ported from protocol/ssh-transport.ts and cli/ssh-tunnel.ts. The CLI connects to a daemon that
// is only reachable from another machine; instead of asking the user to keep a terminal open
// running `ssh -L`, it opens a local listener backed by `ssh -W`, which proxies stdio.
package ssh

import (
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// DefaultDaemonPort is the daemon port assumed when the URI does not name one.
const DefaultDaemonPort = 6777

// Target is where to tunnel to.
type Target struct {
	Host string
	// SSHPort is the port ssh itself connects to; zero means the ssh default.
	SSHPort int
	// DaemonPort is the daemon port on the far side.
	DaemonPort int
}

// ValidatePort checks a port number.
func ValidatePort(value int, label string) (int, error) {
	if value < 1 || value > 65535 {
		return 0, fmt.Errorf("%s must be between 1 and 65535", label)
	}
	return value, nil
}

// ValidateHost rejects a host that would be read as an ssh option or that contains whitespace.
//
// A host starting with `-` is an option injection: `ssh -oProxyCommand=...` in the host position
// is not a host at all. The TypeScript parser checks the same thing for the same reason.
func ValidateHost(host string) (string, error) {
	normalized := strings.TrimSpace(host)
	if normalized == "" {
		return "", errors.New("SSH host is required")
	}
	if strings.ContainsAny(normalized, " \t\n\r") || strings.HasPrefix(normalized, "-") {
		return "", errors.New("SSH host is invalid")
	}
	return normalized, nil
}

// ParseURI parses `ssh://[user@]host[:port][?daemonPort=N]`.
func ParseURI(value string) (Target, error) {
	parsed, err := url.Parse(value)
	if err != nil {
		return Target{}, fmt.Errorf("invalid SSH host URI: %w", err)
	}
	if parsed.Scheme != "ssh" {
		return Target{}, errors.New("invalid SSH host URI: expected the ssh scheme")
	}
	if parsed.User != nil {
		if _, hasPassword := parsed.User.Password(); hasPassword {
			// A password in the URI would land in shell history and process listings, and ssh cannot use
			// one without an askpass helper anyway.
			return Target{}, errors.New("invalid SSH host URI: passwords are not accepted")
		}
	}
	if path := parsed.Path; path != "" && path != "/" {
		return Target{}, errors.New("invalid SSH host URI: unexpected path")
	}
	if parsed.Fragment != "" {
		return Target{}, errors.New("SSH host URI does not support fragments")
	}

	query := parsed.Query()
	for key := range query {
		if key != "daemonPort" {
			return Target{}, fmt.Errorf("unsupported SSH host option: %s", key)
		}
	}
	daemonPort := DefaultDaemonPort
	if values := query["daemonPort"]; len(values) > 0 {
		if len(values) > 1 {
			return Target{}, errors.New("daemonPort may only be specified once")
		}
		parsedPort, portErr := strconv.Atoi(values[0])
		if portErr != nil {
			return Target{}, fmt.Errorf("daemon port must be a number, got %q", values[0])
		}
		daemonPort, portErr = ValidatePort(parsedPort, "Daemon port")
		if portErr != nil {
			return Target{}, portErr
		}
	}

	hostname := parsed.Hostname()
	if hostname == "" {
		return Target{}, errors.New("SSH host is required")
	}
	hostname, err = ValidateHost(hostname)
	if err != nil {
		return Target{}, err
	}
	if username := parsed.User.Username(); username != "" {
		hostname, err = ValidateHost(username + "@" + hostname)
		if err != nil {
			return Target{}, err
		}
	}

	target := Target{Host: hostname, DaemonPort: daemonPort}
	if port := parsed.Port(); port != "" {
		parsedPort, portErr := strconv.Atoi(port)
		if portErr != nil {
			return Target{}, fmt.Errorf("SSH port must be a number, got %q", port)
		}
		target.SSHPort, portErr = ValidatePort(parsedPort, "SSH port")
		if portErr != nil {
			return Target{}, portErr
		}
	}
	return target, nil
}

// BuildArgs composes the ssh command line.
//
// `-W` proxies stdio to a port on the far side, which is simpler than `-L` and needs no port
// allocation here. The options disable everything interactive: BatchMode fails instead of
// prompting (a prompt would hang the CLI with no terminal), ConnectTimeout bounds the wait,
// ClearAllForwardings keeps the user's own forwarding out of this connection, and
// ExitOnForwardFailure makes a failed proxy an error rather than a silent no-op.
func BuildArgs(target Target) ([]string, error) {
	host, err := ValidateHost(target.Host)
	if err != nil {
		return nil, err
	}
	daemonPort, err := ValidatePort(target.DaemonPort, "Daemon port")
	if err != nil {
		return nil, err
	}

	args := []string{
		"-T",
		"-o", "BatchMode=yes",
		"-o", "ConnectTimeout=10",
		"-o", "ClearAllForwardings=yes",
		"-o", "ExitOnForwardFailure=yes",
	}
	if target.SSHPort != 0 {
		sshPort, portErr := ValidatePort(target.SSHPort, "SSH port")
		if portErr != nil {
			return nil, portErr
		}
		args = append(args, "-p", strconv.Itoa(sshPort))
	}
	args = append(args, "-W", fmt.Sprintf("127.0.0.1:%d", daemonPort), host)
	return args, nil
}
