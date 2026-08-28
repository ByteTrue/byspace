package cli

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"byspace/internal/daemon"
)

const startupTimeout = 8 * time.Second

func Run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 || args[0] == "help" || args[0] == "--help" || args[0] == "-h" {
		printUsage(stdout)
		return 0
	}
	if args[0] == "agent" {
		return runAgent(args[1:], stdout, stderr)
	}
	if args[0] == "pair" {
		return runPair(args[1:], stdout, stderr)
	}
	if args[0] == "host" {
		return runHost(args[1:], os.Stdin, stdout, stderr)
	}
	if args[0] != "daemon" {
		fmt.Fprintf(stderr, "unknown command %q\n", args[0])
		printUsage(stderr)
		return 2
	}
	if len(args) < 2 {
		fmt.Fprintln(stderr, "daemon subcommand is required")
		printDaemonUsage(stderr)
		return 2
	}

	switch args[1] {
	case "start":
		return runStart(args[2:], stdout, stderr)
	case "status":
		return runStatus(args[2:], stdout, stderr)
	case "stop":
		return runStop(args[2:], stdout, stderr)
	case "help", "--help", "-h":
		printDaemonUsage(stdout)
		return 0
	default:
		fmt.Fprintf(stderr, "unknown daemon subcommand %q\n", args[1])
		printDaemonUsage(stderr)
		return 2
	}
}

func runStart(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("byspace daemon start", flag.ContinueOnError)
	flags.SetOutput(stderr)
	homeFlag := flags.String("home", "", "byspace home directory")
	listenFlag := flags.String("listen", "", "TCP listen address")
	webDirFlag := flags.String("web-dir", "", "built Web asset directory")
	relayURLFlag := flags.String("relay-url", "", "Relay WebSocket origin (ws:// or wss://)")
	foreground := flags.Bool("foreground", false, "run in the foreground")
	jsonOutput := flags.Bool("json", false, "write machine-readable JSON")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if flags.NArg() != 0 {
		fmt.Fprintln(stderr, "daemon start does not accept positional arguments")
		return 2
	}
	home, err := daemon.ResolveHome(*homeFlag)
	if err != nil {
		return printError(stderr, err)
	}
	listen := daemon.ResolveListen(*listenFlag)
	webDir, err := resolveWebDir(*webDirFlag)
	if err != nil {
		return printError(stderr, err)
	}
	relayURL, err := resolveRelayURL(*relayURLFlag)
	if err != nil {
		return printError(stderr, err)
	}

	if *foreground {
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		if err := daemon.Run(ctx, daemon.Options{Home: home, Listen: listen, Output: stdout, WebDir: webDir, RelayURL: relayURL}); err != nil {
			return printError(stderr, fmt.Errorf("start daemon: %w", err))
		}
		return 0
	}

	status, err := startBackground(home, listen, webDir, relayURL)
	if err != nil {
		return printError(stderr, err)
	}
	if *jsonOutput {
		return printJSON(stdout, stderr, status)
	}
	fmt.Fprintf(stdout, "Daemon started (PID %d)\n", *status.PID)
	fmt.Fprintf(stdout, "Listen: %s\n", status.Listen)
	fmt.Fprintf(stdout, "Logs: %s\n", status.LogPath)
	return 0
}

func runStatus(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("byspace daemon status", flag.ContinueOnError)
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
		fmt.Fprintln(stderr, "daemon status does not accept positional arguments")
		return 2
	}
	home, err := daemon.ResolveHome(*homeFlag)
	if err != nil {
		return printError(stderr, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	status, err := daemon.Inspect(ctx, home)
	if err != nil {
		return printError(stderr, err)
	}
	if *jsonOutput {
		return printJSON(stdout, stderr, status)
	}
	printStatus(stdout, status)
	return 0
}

func runStop(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("byspace daemon stop", flag.ContinueOnError)
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
		fmt.Fprintln(stderr, "daemon stop does not accept positional arguments")
		return 2
	}
	home, err := daemon.ResolveHome(*homeFlag)
	if err != nil {
		return printError(stderr, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	stopped, status, err := daemon.Stop(ctx, home)
	if err != nil {
		return printError(stderr, err)
	}
	result := struct {
		Action string        `json:"action"`
		Status daemon.Status `json:"status"`
	}{Action: "not_running", Status: status}
	if stopped {
		result.Action = "stopped"
	}
	if *jsonOutput {
		return printJSON(stdout, stderr, result)
	}
	if stopped {
		fmt.Fprintln(stdout, "Daemon stopped")
	} else {
		fmt.Fprintln(stdout, "Daemon is not running")
	}
	return 0
}

func startBackground(home, listen, webDir, relayURL string) (daemon.Status, error) {
	if err := daemon.EnsureHome(home); err != nil {
		return daemon.Status{}, err
	}
	preflightCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	preflight, err := daemon.Inspect(preflightCtx, home)
	cancel()
	if err != nil {
		return daemon.Status{}, err
	}
	switch preflight.LocalDaemon {
	case "running":
		return daemon.Status{}, fmt.Errorf("byspace daemon is already running (PID %d)", pointerValue(preflight.PID))
	case "unresponsive":
		return daemon.Status{}, fmt.Errorf("existing daemon ownership is unresponsive: %s", preflight.Note)
	case "invalid_pid":
		return daemon.Status{}, errors.New(preflight.Note)
	}

	executable, err := os.Executable()
	if err != nil {
		return daemon.Status{}, fmt.Errorf("resolve byspace executable: %w", err)
	}
	logFile, err := os.OpenFile(daemon.LogPath(home), os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0o600)
	if err != nil {
		return daemon.Status{}, fmt.Errorf("open daemon log: %w", err)
	}
	defer logFile.Close()
	if err := os.Chmod(daemon.LogPath(home), 0o600); err != nil {
		return daemon.Status{}, fmt.Errorf("secure daemon log: %w", err)
	}

	commandArgs := []string{"daemon", "start", "--foreground", "--home", home, "--listen", listen}
	if webDir != "" {
		commandArgs = append(commandArgs, "--web-dir", webDir)
	}
	if relayURL != "" {
		commandArgs = append(commandArgs, "--relay-url", relayURL)
	}
	command := exec.Command(executable, commandArgs...)
	command.Stdin = nil
	command.Stdout = logFile
	command.Stderr = logFile
	detach(command)
	if err := command.Start(); err != nil {
		return daemon.Status{}, fmt.Errorf("spawn daemon: %w", err)
	}
	pid := command.Process.Pid
	ctx, cancel := context.WithTimeout(context.Background(), startupTimeout)
	defer cancel()
	status, childReaped, err := waitForBackgroundReady(ctx, home, pid, command)
	if err != nil {
		if !childReaped {
			terminateAndWait(command)
		}
		_ = daemon.CleanupFailedStart(home, pid)
		return daemon.Status{}, fmt.Errorf("daemon failed to start: %w%s", err, logSuffix(home))
	}
	if err := command.Process.Release(); err != nil {
		terminateAndWait(command)
		_ = daemon.CleanupFailedStart(home, pid)
		return daemon.Status{}, fmt.Errorf("release background daemon process: %w", err)
	}
	return status, nil
}

func waitForBackgroundReady(ctx context.Context, home string, expectedPID int, command *exec.Cmd) (daemon.Status, bool, error) {
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		status, err := daemon.Inspect(ctx, home)
		if err == nil && status.LocalDaemon == "running" {
			if status.PID != nil && *status.PID == expectedPID {
				return status, false, nil
			}
			return daemon.Status{}, false, errors.New("another daemon won the startup race")
		}
		exited, exitErr := pollChildExit(command)
		if exited {
			return daemon.Status{}, true, fmt.Errorf("daemon exited before becoming ready: %w", exitErr)
		}
		select {
		case <-ctx.Done():
			return daemon.Status{}, false, fmt.Errorf("wait for daemon readiness: %w", ctx.Err())
		case <-ticker.C:
		}
	}
}

func terminateAndWait(command *exec.Cmd) {
	_ = command.Process.Signal(os.Interrupt)
	waitResult := make(chan error, 1)
	go func() {
		waitResult <- command.Wait()
	}()
	select {
	case <-waitResult:
	case <-time.After(2 * time.Second):
		_ = command.Process.Kill()
		<-waitResult
	}
}

func printStatus(output io.Writer, status daemon.Status) {
	fmt.Fprintf(output, "Server ID: %s\n", status.ServerID)
	fmt.Fprintf(output, "Local Daemon: %s\n", status.LocalDaemon)
	fmt.Fprintf(output, "Home: %s\n", status.Home)
	fmt.Fprintf(output, "Listen: %s\n", status.Listen)
	if status.PID == nil {
		fmt.Fprintln(output, "PID: -")
	} else {
		fmt.Fprintf(output, "PID: %d\n", *status.PID)
	}
	fmt.Fprintf(output, "Logs: %s\n", status.LogPath)
	if status.Note != "" {
		fmt.Fprintf(output, "Note: %s\n", status.Note)
	}
}

func printJSON(stdout, stderr io.Writer, value any) int {
	encoder := json.NewEncoder(stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		return printError(stderr, err)
	}
	return 0
}

func printError(stderr io.Writer, err error) int {
	fmt.Fprintf(stderr, "Error: %s\n", err)
	return 1
}

func printUsage(output io.Writer) {
	fmt.Fprintln(output, "Usage: byspace <daemon|agent|host|pair> [subcommand] [options]")
}

func printDaemonUsage(output io.Writer) {
	fmt.Fprintln(output, "Usage: byspace daemon <start|status|stop> [options]")
}

func resolveRelayURL(explicit string) (string, error) {
	candidate := strings.TrimSpace(explicit)
	if candidate == "" {
		candidate = strings.TrimSpace(os.Getenv("BYSPACE_RELAY_URL"))
	}
	if candidate == "" {
		return "", nil
	}
	parsed, err := daemon.ParseRelayURL(candidate)
	if err != nil {
		return "", err
	}
	return parsed.String(), nil
}

func resolveWebDir(explicit string) (string, error) {
	candidate := explicit
	if candidate == "" {
		candidate = os.Getenv("BYSPACE_WEB_DIR")
	}
	if candidate != "" {
		absolute, err := filepath.Abs(candidate)
		if err != nil {
			return "", fmt.Errorf("resolve Web asset directory: %w", err)
		}
		return absolute, nil
	}
	workingDirectory, err := os.Getwd()
	if err != nil {
		return "", nil
	}
	candidate = filepath.Join(workingDirectory, "packages", "app", "dist")
	info, err := os.Stat(filepath.Join(candidate, "index.html"))
	if err == nil && info.Mode().IsRegular() {
		return candidate, nil
	}
	return "", nil
}

func pointerValue(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

func logSuffix(home string) string {
	data, err := os.ReadFile(daemon.LogPath(home))
	if err != nil {
		return ""
	}
	text := strings.TrimSpace(string(data))
	if text == "" {
		return ""
	}
	const max = 4096
	if len(text) > max {
		text = text[len(text)-max:]
	}
	return "\nRecent daemon log:\n" + text
}
