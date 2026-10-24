package cli

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
)

// runDaemonReload re-reads config.json inside the running daemon.
//
// The daemon resolves most settings per use, so a reload is mostly about reporting: the command
// answers what took effect, what needs a restart, and what the environment is overriding. Its
// purpose is the third list — without it an edit that silently loses to BYSPACE_* looks applied.
func runDaemonReload(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("daemon reload", flag.ContinueOnError)
	addr := fs.String("addr", "", "daemon address (default "+defaultListenAddr()+")")
	if err := fs.Parse(args); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	ws, err := dialDaemonWS(ctx, *addr)
	if err != nil {
		return err
	}
	defer ws.CloseNow()
	if err := sendSessionReq(ctx, ws, map[string]any{
		"type":      "daemon.config.reload.request",
		"requestId": "cli_reload_1",
	}); err != nil {
		return err
	}
	payload, err := waitSessionResp(ctx, ws, "daemon.config.reload.response", "")
	if err != nil {
		return err
	}
	printPathList(stdout, "applied", payload["appliedPaths"])
	printPathList(stdout, "restart required", payload["restartRequiredPaths"])
	printPathList(stdout, "overridden by the environment", payload["overrideControlledPaths"])
	if len(asStringSlice(payload["appliedPaths"])) == 0 &&
		len(asStringSlice(payload["restartRequiredPaths"])) == 0 &&
		len(asStringSlice(payload["overrideControlledPaths"])) == 0 {
		fmt.Fprintln(stdout, "no changes")
	}
	return nil
}

// printPathList writes one indented line per changed setting, skipping empty lists so a reload that
// changed nothing stays quiet.
func printPathList(stdout io.Writer, label string, raw any) {
	paths := asStringSlice(raw)
	if len(paths) == 0 {
		return
	}
	fmt.Fprintf(stdout, "%s (%d)\n", label, len(paths))
	for _, path := range paths {
		fmt.Fprintf(stdout, "  %s\n", path)
	}
}

func asStringSlice(raw any) []string {
	switch typed := raw.(type) {
	case []string:
		return typed
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			if text, ok := item.(string); ok {
				out = append(out, text)
			}
		}
		return out
	}
	return nil
}

// runDaemonSetPassword sets the daemon password through the same RPC the settings page uses.
//
// Reading the password here rather than taking it as an argument keeps it out of the shell
// history and out of `ps`; the daemon hashes it, so the plaintext never reaches disk.
func runDaemonSetPassword(args []string, stdin io.Reader, stdout io.Writer) error {
	fs := flag.NewFlagSet("daemon set-password", flag.ContinueOnError)
	addr := fs.String("addr", "", "daemon address (default "+defaultListenAddr()+")")
	clear := fs.Bool("clear", false, "remove the password instead of setting one")
	if err := fs.Parse(args); err != nil {
		return err
	}

	var password string
	if *clear {
		password = ""
	} else {
		reader := bufio.NewReader(stdin)
		first, err := readPasswordLine(reader, "New daemon password: ", stdout)
		if err != nil {
			return err
		}
		if strings.TrimSpace(first) == "" {
			return errors.New("a password cannot be empty; use --clear to remove it")
		}
		second, err := readPasswordLine(reader, "Repeat password: ", stdout)
		if err != nil {
			return err
		}
		if first != second {
			return errors.New("the passwords do not match")
		}
		password = first
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	ws, err := dialDaemonWS(ctx, *addr)
	if err != nil {
		return err
	}
	defer ws.CloseNow()
	// nil clears; the daemon distinguishes "absent" from "explicitly null".
	var passwordValue any
	if !*clear {
		passwordValue = password
	}
	if err := sendSessionReq(ctx, ws, map[string]any{
		"type":      "set_daemon_config_request",
		"requestId": "cli_setpw_1",
		"config":    map[string]any{"auth": map[string]any{"password": passwordValue}},
	}); err != nil {
		return err
	}
	payload, err := waitSessionResp(ctx, ws, "set_daemon_config_response", "")
	if err != nil {
		return err
	}
	if msg, ok := payload["error"].(string); ok && strings.TrimSpace(msg) != "" {
		return errors.New(msg)
	}
	if *clear {
		fmt.Fprintln(stdout, "password cleared")
		return nil
	}
	fmt.Fprintln(stdout, "password set")
	return nil
}

// readPasswordLine prompts and reads one line.
//
// Reading a line from stdin rather than the terminal is deliberate: a hidden prompt needs
// golang.org/x/term, and this command's job is to not put the password in argv, which a pipe
// satisfies just as well.
func readPasswordLine(reader *bufio.Reader, prompt string, stdout io.Writer) (string, error) {
	fmt.Fprint(stdout, prompt)
	line, err := reader.ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return "", err
	}
	return strings.TrimRight(line, "\r\n"), nil
}

// stdinOrDefault lets the command be driven from a pipe in tests.
func stdinOrDefault(input io.Reader) io.Reader {
	if input != nil {
		return input
	}
	return os.Stdin
}
