package cli

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"byspace/internal/daemon"
	"byspace/internal/hub"
)

type hubRPCResponse struct {
	RequestID string     `json:"requestId"`
	Status    hub.Status `json:"status"`
	Warning   string     `json:"warning"`
}

func runHub(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(stderr, "hub subcommand is required")
		printHubUsage(stderr)
		return 2
	}
	switch args[0] {
	case "login":
		return runHubLogin(args[1:], stdout, stderr)
	case "connect":
		return runHubConnect(args[1:], stdout, stderr)
	case "status":
		return runHubStatus(args[1:], stdout, stderr)
	case "disconnect":
		return runHubDisconnect(args[1:], stdout, stderr)
	case "help", "--help", "-h":
		printHubUsage(stdout)
		return 0
	default:
		fmt.Fprintf(stderr, "unknown hub subcommand %q\n", args[0])
		printHubUsage(stderr)
		return 2
	}
}

func runHubLogin(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("byspace hub login", flag.ContinueOnError)
	flags.SetOutput(stderr)
	homeFlag := flags.String("home", "", "byspace home directory")
	args = moveFirstPositionalToEnd(args)
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if flags.NArg() != 1 {
		fmt.Fprintln(stderr, "hub login requires one Hub origin")
		return 2
	}
	home, err := daemon.ResolveHome(*homeFlag)
	if err != nil {
		return printError(stderr, err)
	}
	origin, err := hub.NormalizeOrigin(flags.Arg(0))
	if err != nil {
		return printError(stderr, err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	client := hub.NewAPIClient()
	authorization, err := client.StartAuthorization(ctx, origin)
	if err != nil {
		return printError(stderr, err)
	}
	fmt.Fprintf(stderr, "Open %s and enter code %s\n", authorization.VerificationURI, authorization.UserCode)
	expiresAt, err := time.Parse(time.RFC3339, authorization.ExpiresAt)
	if err != nil {
		return printError(stderr, errors.New("Hub CLI authorization expiry is invalid"))
	}
	interval := authorization.Interval
	for {
		remaining := time.Until(expiresAt)
		if remaining <= 0 {
			return printError(stderr, errors.New("Hub CLI login expired"))
		}
		delay := time.Duration(interval) * time.Second
		if delay > remaining {
			delay = remaining
		}
		if !waitContext(ctx, delay) {
			return printError(stderr, errors.New("Hub CLI login canceled"))
		}
		poll, err := client.PollAuthorization(ctx, origin, authorization.DeviceCode)
		if err != nil {
			return printError(stderr, err)
		}
		switch poll.Status {
		case "authorized":
			credential, err := hub.NewHumanCredential(origin, poll.OrganizationID, poll.Credential, time.Now())
			if err != nil {
				return printError(stderr, err)
			}
			if err := hub.SaveHumanCredential(home, credential); err != nil {
				return printError(stderr, err)
			}
			fmt.Fprintf(stdout, "Logged in to %s\n", origin)
			return 0
		case "pending", "slow_down":
			interval = poll.Interval
		case "denied":
			return printError(stderr, errors.New("Hub CLI login was denied"))
		case "expired":
			return printError(stderr, errors.New("Hub CLI login expired"))
		case "disclosed":
			return printError(stderr, errors.New("Hub CLI login was already completed"))
		}
	}
}

func runHubConnect(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("byspace hub connect", flag.ContinueOnError)
	flags.SetOutput(stderr)
	homeFlag := flags.String("home", "", "byspace home directory")
	jsonOutput := flags.Bool("json", false, "write machine-readable JSON")
	args = moveFirstPositionalToEnd(args)
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if flags.NArg() != 1 {
		fmt.Fprintln(stderr, "hub connect requires one Hub origin")
		return 2
	}
	home, err := daemon.ResolveHome(*homeFlag)
	if err != nil {
		return printError(stderr, err)
	}
	origin, err := hub.NormalizeOrigin(flags.Arg(0))
	if err != nil {
		return printError(stderr, err)
	}
	credential, err := hub.LoadHumanCredential(home, origin)
	if err != nil {
		return printError(stderr, fmt.Errorf("load Hub login for %s: %w", origin, err))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	token, err := hub.NewAPIClient().IssueEnrollmentToken(ctx, origin, credential.Credential)
	if err != nil {
		return printError(stderr, err)
	}
	response, err := requestLocalHub(ctx, home, "hub.management.daemon.connect.request", "hub.management.daemon.connect.response", map[string]any{
		"hubUrl": origin, "token": token.Token,
	})
	if err != nil {
		return printError(stderr, err)
	}
	return printHubStatus(response.Status, *jsonOutput, stdout, stderr)
}

func runHubStatus(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("byspace hub status", flag.ContinueOnError)
	flags.SetOutput(stderr)
	homeFlag := flags.String("home", "", "byspace home directory")
	jsonOutput := flags.Bool("json", false, "write machine-readable JSON")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if flags.NArg() != 0 {
		fmt.Fprintln(stderr, "hub status does not accept positional arguments")
		return 2
	}
	home, err := daemon.ResolveHome(*homeFlag)
	if err != nil {
		return printError(stderr, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	response, err := requestLocalHub(ctx, home, "hub.management.daemon.get_status.request", "hub.management.daemon.get_status.response", nil)
	if err != nil {
		return printError(stderr, err)
	}
	return printHubStatus(response.Status, *jsonOutput, stdout, stderr)
}

func runHubDisconnect(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("byspace hub disconnect", flag.ContinueOnError)
	flags.SetOutput(stderr)
	homeFlag := flags.String("home", "", "byspace home directory")
	force := flags.Bool("force", false, "remove local authority without remote revocation")
	jsonOutput := flags.Bool("json", false, "write machine-readable JSON")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if flags.NArg() != 0 {
		fmt.Fprintln(stderr, "hub disconnect does not accept positional arguments")
		return 2
	}
	home, err := daemon.ResolveHome(*homeFlag)
	if err != nil {
		return printError(stderr, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	response, err := requestLocalHub(ctx, home, "hub.management.daemon.disconnect.request", "hub.management.daemon.disconnect.response", map[string]any{"force": *force})
	if err != nil {
		return printError(stderr, err)
	}
	if response.Warning != "" {
		fmt.Fprintf(stderr, "Warning: %s\n", response.Warning)
	}
	return printHubStatus(response.Status, *jsonOutput, stdout, stderr)
}

func requestLocalHub(ctx context.Context, home, requestType, responseType string, fields map[string]any) (hubRPCResponse, error) {
	client, err := connectLocalDaemon(ctx, home)
	if err != nil {
		return hubRPCResponse{}, err
	}
	defer client.socket.CloseNow()
	requestID := newRequestID()
	message := map[string]any{"type": requestType, "requestId": requestID}
	for key, value := range fields {
		message[key] = value
	}
	if err := client.write(ctx, message); err != nil {
		return hubRPCResponse{}, fmt.Errorf("send Hub daemon request: %w", err)
	}
	envelope, err := client.readResponse(ctx, responseType, requestID, nil)
	if err != nil {
		return hubRPCResponse{}, fmt.Errorf("read Hub daemon response: %w", err)
	}
	var response hubRPCResponse
	if err := json.Unmarshal(envelope.Message.Payload, &response); err != nil {
		return hubRPCResponse{}, fmt.Errorf("decode Hub daemon response: %w", err)
	}
	return response, nil
}

func printHubStatus(status hub.Status, jsonOutput bool, stdout, stderr io.Writer) int {
	if jsonOutput {
		return printJSON(stdout, stderr, status)
	}
	origin := "-"
	if status.HubOrigin != nil {
		origin = *status.HubOrigin
	}
	daemonID := "-"
	if status.DaemonID != nil {
		daemonID = *status.DaemonID
	}
	fmt.Fprintf(stdout, "%s\t%s\t%s\n", status.State, origin, daemonID)
	return 0
}

func moveFirstPositionalToEnd(args []string) []string {
	if len(args) == 0 || strings.HasPrefix(args[0], "-") {
		return args
	}
	return append(append([]string{}, args[1:]...), args[0])
}

func waitContext(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func printHubUsage(output io.Writer) {
	fmt.Fprintln(output, "Usage: byspace hub <login|connect|status|disconnect> [options]")
}
