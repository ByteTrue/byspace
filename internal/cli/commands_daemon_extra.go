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

	"github.com/ByteTrue/byspace/internal/daemon"
	"github.com/ByteTrue/byspace/internal/home"
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

// daemonControl asks the daemon on addr to restart or stop itself and reports whether it acked.
//
// The ask goes over the RPC instead of a signal because the process serving the daemon is not always
// a `serve` process: in the desktop app the daemon runs inside `byspace tray`, and only that process
// can bring the daemon back. No ack means an older build or no daemon, so the caller signals instead.
//
// COMPAT(daemonControlRPC): daemons before v0.25 never ack this ask; remove the signal fallback at
// the call sites after 2027-06-01.
func daemonControl(addr, reason string, restart bool) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	ws, err := dialDaemonWS(ctx, addr)
	if err != nil {
		return false
	}
	defer ws.CloseNow()
	msgType, wantStatus := "shutdown_server_request", "shutdown_requested"
	if restart {
		msgType, wantStatus = "restart_server_request", "restart_requested"
	}
	if err := sendSessionReq(ctx, ws, map[string]any{
		"type":      msgType,
		"requestId": "cli_daemon_control_1",
		"reason":    reason,
	}); err != nil {
		return false
	}
	_, err = waitSessionResp(ctx, ws, "status", wantStatus)
	return err == nil
}

// runningDaemonAddr finds this home's daemon and returns the address that answers, plus the pid the
// lock records when it is alive.
//
// The serverId check is what keeps the command from signalling someone else's daemon: a daemon on
// the same port that reports a different home is not ours to stop, and an id that cannot be read is
// not proof either.
func runningDaemonAddr(explicit, homeDir string) (string, int) {
	st, err := probeRecordedDaemon(explicit, homeDir)
	if err != nil {
		return "", 0
	}
	srvID, err := home.GetOrCreateServerID(homeDir)
	if err != nil || srvID == "" || st.ServerID != srvID {
		return "", 0
	}
	if lock, ok := daemon.ReadPIDLock(homeDir); ok && daemon.ProcessAlive(lock.PID) {
		return st.addr, lock.PID
	}
	return st.addr, 0
}

// awaitDaemonStop waits until addr stops answering /health.
func awaitDaemonStop(addr string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if _, err := probeHealth(addr); err != nil {
			return true
		}
		time.Sleep(100 * time.Millisecond)
	}
	return false
}

// awaitDaemonRestart waits for a live daemon with a different pid than pidBefore to answer on addr.
//
// Health alone is not proof: the answer can come from the process that was asked to restart before
// it did anything, and the lock is briefly absent while it hands over. Only a live, different pid
// means the replacement is up.
func awaitDaemonRestart(addr, homeDir string, pidBefore int, timeout time.Duration) (int, bool) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if _, err := probeHealth(addr); err == nil {
			if pid, alive := daemon.ReadPID(homeDir); alive && pid != pidBefore {
				return pid, true
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	return 0, false
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
