// Package cli is byspace's unified entrypoint: the daemon server, embedded web UI,
// E2EE relay server, Pi agent CLI commands, and MCP stdio bridge in one binary.
package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/coder/websocket"

	"github.com/ByteTrue/byspace/internal/daemon"
	"github.com/ByteTrue/byspace/internal/home"
	"github.com/ByteTrue/byspace/internal/relay"
	"github.com/ByteTrue/byspace/internal/server"
	"github.com/ByteTrue/byspace/internal/store"
)

const DefaultDevAddr = "127.0.0.1:6778"

const usageText = `byspace — single-binary AI coding agent host, web workbench, CLI & E2EE relay

  byspace serve [--addr host:port] [--home <dir>] [--relay <ws-url>] [--web-dir <dir>]
                                  run the daemon, Pi agent host, and web UI (default 127.0.0.1:6778)
  byspace web [--addr host:port] [--lan] [--home <dir>] [--web-dir <dir>]
                                  serve the web workbench in a browser alongside the daemon
  byspace relay [--addr host:port] [--web-dir <dir>]
                                  run the high-performance E2EE WebSocket relay (default 0.0.0.0:8787)
  byspace ls [--home <dir>] [--json]
                                  list agents from $BYSPACE_HOME
  byspace run [--addr host:port] [--cwd <dir>] [--model <m>] [--thinking <l>] [--wait] <prompt>
                                  launch a Pi agent turn on the daemon
  byspace logs [--addr host:port] <agent-id>
                                  print an agent's timeline transcript
  byspace wait [--addr host:port] [--timeout <ms>] <agent-id>
                                  wait for an agent's active turn to finish
  byspace heartbeat <create|list|delete> [options]
                                  manage scheduled Pi agent runs and heartbeats
  byspace worktree <create|list> [options]
                                  create and list git worktree workspaces
  byspace pair [--home <dir>] [--relay <host:port>] [--app-url <url>]
                                  print a remote pairing offer URL (#offer=...)
  byspace daemon <status|start|stop|restart|print-plist|print-unit> [options]
                                  manage daemon lifecycle and service definitions
  byspace mcp-bridge              run the self-hosted stdio MCP bridge for child agents
  byspace version                 print version
`

// Main dispatches command-line arguments and returns the process exit code.
func Main(version string, args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		if err := runServe(version, nil, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace:", err)
			return 1
		}
		return 0
	}

	cmd := args[0]
	rest := args[1:]

	switch cmd {
	case "-h", "--help", "help":
		fmt.Fprint(stdout, usageText)
		return 0
	case "-v", "--version", "version":
		fmt.Fprintln(stdout, version)
		return 0
	case "serve":
		if err := runServe(version, rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace serve:", err)
			return 1
		}
		return 0
	case "web":
		if err := runWeb(version, rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace web:", err)
			return 1
		}
		return 0
	case "relay":
		if err := runRelay(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace relay:", err)
			return 1
		}
		return 0
	case "ls":
		if err := runList(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace ls:", err)
			return 1
		}
		return 0
	case "run":
		if err := runAgentPrompt(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace run:", err)
			return 1
		}
		return 0
	case "logs":
		if err := runLogs(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace logs:", err)
			return 1
		}
		return 0
	case "wait":
		if err := runWait(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace wait:", err)
			return 1
		}
		return 0
	case "daemon":
		if err := runDaemonCmd(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace daemon:", err)
			return 1
		}
		return 0
	case "heartbeat", "schedule":
		if err := runHeartbeatCmd(rest, stdout); err != nil {
			fmt.Fprintf(stderr, "byspace %s: %v\n", cmd, err)
			return 1
		}
		return 0
	case "worktree":
		if err := runWorktreeCmd(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace worktree:", err)
			return 1
		}
		return 0
	case "pair":
		if err := runPairCmd(version, rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace pair:", err)
			return 1
		}
		return 0
	case "agent":
		if err := runAgentGroupCmd(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace agent:", err)
			return 1
		}
		return 0
	case "send":
		if err := runAgentSend(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace send:", err)
			return 1
		}
		return 0
	case "stop", "cancel":
		if err := runAgentStop(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace stop:", err)
			return 1
		}
		return 0
	case "archive":
		if err := runAgentArchive(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace archive:", err)
			return 1
		}
		return 0
	case "rm", "delete", "kill":
		if err := runAgentDelete(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace rm:", err)
			return 1
		}
		return 0
	case "inspect":
		if err := runAgentInspect(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace inspect:", err)
			return 1
		}
		return 0
	case "detach":
		if err := runAgentDetach(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace detach:", err)
			return 1
		}
		return 0
	case "update", "mode":
		if err := runAgentUpdate(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace update:", err)
			return 1
		}
		return 0
	case "import":
		if err := runAgentImport(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace import:", err)
			return 1
		}
		return 0
	case "reload":
		if err := runAgentReload(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace reload:", err)
			return 1
		}
		return 0
	case "project":
		if err := runProjectGroupCmd(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace project:", err)
			return 1
		}
		return 0
	case "workspace":
		if err := runWorkspaceGroupCmd(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace workspace:", err)
			return 1
		}
		return 0
	case "terminal":
		if err := runTerminalGroupCmd(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace terminal:", err)
			return 1
		}
		return 0
	case "provider":
		if err := runProviderGroupCmd(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace provider:", err)
			return 1
		}
		return 0
	case "script":
		if err := runScriptGroupCmd(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace script:", err)
			return 1
		}
		return 0
	case "permit":
		if err := runPermitGroupCmd(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace permit:", err)
			return 1
		}
		return 0
	case "clone":
		if err := runCloneCmd(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace clone:", err)
			return 1
		}
		return 0
	case "open":
		if err := runOpenCmd(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace open:", err)
			return 1
		}
		return 0
	case "hooks", "onboard":
		fmt.Fprintf(stdout, "%s: ready\n", cmd)
		return 0
	case "mcp-bridge":
		if err := runMCPBridge(rest, os.Stdin, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace mcp-bridge:", err)
			return 1
		}
		return 0
	default:
		fmt.Fprintf(stderr, "byspace: unknown command %q\n\n%s", cmd, usageText)
		return 1
	}
}

func runServe(version string, args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	addr := fs.String("addr", defaultListenAddr(), "listen address")
	homeDir := fs.String("home", "", "byspace home directory")
	relayURL := fs.String("relay", os.Getenv("BYSPACE_RELAY_URL"), "optional relay ws:// or wss:// endpoint")
	webDir := fs.String("web-dir", os.Getenv("BYSPACE_WEB_DIR"), "optional static web UI directory")
	if err := fs.Parse(args); err != nil {
		return err
	}

	srv, err := server.New(server.Options{
		HomeDir: *homeDir,
		Version: version,
		WebDir:  *webDir,
		// The MCP bridge injected into agents must call back to this daemon's address.
		ListenAddr: *addr,
	})
	if err != nil {
		return err
	}
	defer srv.Close()

	// BYSPACE_LISTEN accepts tcp, unix socket and windows named pipe forms; see
	// daemon.ParseListenTarget for why sockets matter in restricted environments.
	listenTarget, err := daemon.ParseListenTarget(*addr)
	if err != nil {
		return err
	}
	ln, err := listenTarget.Listen()
	if err != nil {
		return err
	}
	myPID := os.Getpid()
	listenAddr := listenTarget.Address()
	// The lock carries metadata and a heartbeat mtime: a bare pid cannot tell "running" from
	// "crashed and this pid got recycled", which is what left stale locks blocking startup.
	if existing, ok := daemon.ReadPIDLock(srv.HomeDir()); ok && !daemon.IsStale(srv.HomeDir(), existing) && existing.PID != myPID {
		return fmt.Errorf("another byspace daemon is already running (pid %d, started %s)", existing.PID, existing.StartedAt)
	}
	_ = daemon.WritePIDLock(srv.HomeDir(), daemon.PIDLockInfo{PID: myPID, Listen: &listenAddr})
	defer daemon.RemovePID(srv.HomeDir(), myPID)

	heartbeatStop := make(chan struct{})
	defer close(heartbeatStop)
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-heartbeatStop:
				return
			case <-ticker.C:
				daemon.TouchPIDLock(srv.HomeDir())
			}
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// The relay's lifecycle is owned by the server so a settings change takes effect without a
	// restart (see internal/server/relay_runtime.go). A --relay flag is an explicit override: an
	// operator launching the daemon with an endpoint means it, whatever an old config holds.
	if strings.TrimSpace(*relayURL) != "" {
		srv.SetRelayOverride(*relayURL)
		srv.ApplyRelayConfig(ctx)
	}

	httpSrv := &http.Server{Handler: srv}
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(sctx)
	}()

	fmt.Fprintf(stdout, "● byspace daemon (%s) listening on %s [serverId=%s]\n", version, listenTarget.Address(), srv.ServerID())
	err = httpSrv.Serve(ln)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func runWeb(version string, args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("web", flag.ContinueOnError)
	addr := fs.String("addr", defaultListenAddr(), "listen address")
	lan := fs.Bool("lan", false, "expose on 0.0.0.0")
	homeDir := fs.String("home", "", "byspace home directory")
	webDir := fs.String("web-dir", os.Getenv("BYSPACE_WEB_DIR"), "static web UI directory")
	if err := fs.Parse(args); err != nil {
		return err
	}

	listenAddr := *addr
	if *lan {
		_, port, err := net.SplitHostPort(listenAddr)
		if err == nil {
			listenAddr = "0.0.0.0:" + port
		}
	}

	// If a daemon is already answering /health on this address, report its URL instead of failing on EADDRINUSE.
	if st, err := probeHealth(listenAddr); err == nil {
		fmt.Fprintf(stdout, "● byspace web already served on http://%s [serverId=%s]\n", listenAddr, st.ServerID)
		return nil
	}

	return runServe(version, []string{"--addr", listenAddr, "--home", *homeDir, "--web-dir", *webDir}, stdout)
}

func runRelay(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("relay", flag.ContinueOnError)
	addr := fs.String("addr", "0.0.0.0:8787", "relay listen address")
	webDir := fs.String("web-dir", os.Getenv("BYSPACE_WEB_DIR"), "optional static web UI directory")
	if err := fs.Parse(args); err != nil {
		return err
	}

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	srv := relay.NewServer(relay.Options{WebDir: *webDir})
	httpSrv := &http.Server{Handler: srv}
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(sctx)
	}()

	fmt.Fprintf(stdout, "● byspace relay listening on http://%s\n", ln.Addr().String())
	err = httpSrv.Serve(ln)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func runList(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("ls", flag.ContinueOnError)
	homeDir := fs.String("home", "", "byspace home directory")
	asJSON := fs.Bool("json", false, "output JSON")
	asYAML := fs.Bool("yaml", false, "output YAML")
	quiet := fs.Bool("q", false, "output ids only")
	fs.BoolVar(quiet, "quiet", false, "output ids only")
	includeArchived := fs.Bool("a", false, "include archived agents")
	fs.BoolVar(includeArchived, "all", false, "include archived agents")
	var unusedGlobal bool
	fs.BoolVar(&unusedGlobal, "g", false, "global")
	if err := fs.Parse(args); err != nil {
		return err
	}

	resolvedHome, err := home.Resolve(*homeDir)
	if err != nil {
		return err
	}
	st := store.New(resolvedHome)
	agents, err := st.ListAgents()
	if err != nil {
		return err
	}

	// Archived agents are hidden by default: the list is what the user is working on, and a
	// history of every finished agent makes it unreadable. -a brings them back.
	if !*includeArchived {
		visible := make([]store.AgentRecord, 0, len(agents))
		for _, a := range agents {
			if a.ArchivedAt == nil {
				visible = append(visible, a)
			}
		}
		agents = visible
	}

	switch resolveOutputMode(*asJSON, *asYAML, *quiet) {
	case ModeJSON:
		return writeJSON(stdout, agents)
	case ModeYAML:
		return writeYAML(stdout, toYAMLValue(agents))
	case ModeQuiet:
		ids := make([]string, 0, len(agents))
		for _, a := range agents {
			ids = append(ids, a.ID)
		}
		return writeQuiet(stdout, ids)
	}

	if len(agents) == 0 {
		fmt.Fprintln(stdout, "No agents found.")
		return nil
	}
	rows := make([][]string, 0, len(agents))
	for _, a := range agents {
		title := "(untitled)"
		if a.Title != nil && *a.Title != "" {
			title = *a.Title
		}
		rows = append(rows, []string{a.ID, a.Provider, a.LastStatus, title, a.Cwd})
	}
	return renderTable(stdout, []string{"ID", "PROVIDER", "STATUS", "TITLE", "CWD"}, rows)
	return nil
}

func runAgentPrompt(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("run", flag.ContinueOnError)
	addr := fs.String("addr", defaultListenAddr(), "daemon address")
	cwd := fs.String("cwd", "", "working directory")
	model := fs.String("model", "", "model identifier")
	thinking := fs.String("thinking", "", "thinking level")
	wait := fs.Bool("wait", true, "wait for turn completion")
	if err := fs.Parse(args); err != nil {
		return err
	}
	prompt := strings.TrimSpace(strings.Join(fs.Args(), " "))
	if prompt == "" {
		return errors.New("prompt is required")
	}
	workDir := *cwd
	if workDir == "" {
		workDir, _ = os.Getwd()
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	ws, err := dialDaemonWS(ctx, *addr)
	if err != nil {
		return err
	}
	defer ws.CloseNow()

	cfg := map[string]any{
		"provider": "pi",
		"cwd":      workDir,
	}
	if *model != "" {
		cfg["model"] = *model
	}
	if *thinking != "" {
		cfg["thinkingOptionId"] = *thinking
	}

	if err := sendSessionReq(ctx, ws, map[string]any{
		"type":          "create_agent_request",
		"requestId":     "cli_create",
		"initialPrompt": prompt,
		"config":        cfg,
	}); err != nil {
		return err
	}

	created, err := waitSessionResp(ctx, ws, "status", "agent_created")
	if err != nil {
		return err
	}
	agentID, _ := created["agentId"].(string)
	if !*wait {
		fmt.Fprintln(stdout, agentID)
		return nil
	}

	if err := sendSessionReq(ctx, ws, map[string]any{
		"type":      "wait_for_finish_request",
		"requestId": "cli_wait",
		"agentId":   agentID,
		"timeoutMs": 55000,
	}); err != nil {
		return err
	}
	waitResp, err := waitSessionResp(ctx, ws, "wait_for_finish_response", "")
	if err != nil {
		return err
	}
	// `lastMessage` carries the assistant's final text; `final` is the full agent snapshot
	// (protocol contract), so read the text from the dedicated field.
	if text, _ := waitResp["lastMessage"].(string); strings.TrimSpace(text) != "" {
		fmt.Fprintln(stdout, text)
		return nil
	}
	fmt.Fprintln(stdout, agentID)
	return nil
}

func runLogs(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("logs", flag.ContinueOnError)
	addr := fs.String("addr", defaultListenAddr(), "daemon address")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("agent-id is required")
	}
	agentID := fs.Arg(0)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	ws, err := dialDaemonWS(ctx, *addr)
	if err != nil {
		return err
	}
	defer ws.CloseNow()

	if err := sendSessionReq(ctx, ws, map[string]any{
		"type":      "fetch_agent_timeline_request",
		"requestId": "cli_logs",
		"agentId":   agentID,
	}); err != nil {
		return err
	}

	resp, err := waitSessionResp(ctx, ws, "fetch_agent_timeline_response", "")
	if err != nil {
		return err
	}
	entries, _ := resp["entries"].([]any)
	for _, rawEntry := range entries {
		entry, ok := rawEntry.(map[string]any)
		if !ok {
			continue
		}
		item, _ := entry["item"].(map[string]any)
		itemType, _ := item["type"].(string)
		text, _ := item["text"].(string)
		name, _ := item["name"].(string)
		if name != "" {
			fmt.Fprintf(stdout, "[%s:%s] %s\n", itemType, name, text)
		} else {
			fmt.Fprintf(stdout, "[%s] %s\n", itemType, text)
		}
	}
	return nil
}

func runWait(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("wait", flag.ContinueOnError)
	addr := fs.String("addr", defaultListenAddr(), "daemon address")
	timeoutMs := fs.Int("timeout", 30000, "timeout in milliseconds")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("agent-id is required")
	}
	agentID := fs.Arg(0)

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(*timeoutMs+5000)*time.Millisecond)
	defer cancel()

	ws, err := dialDaemonWS(ctx, *addr)
	if err != nil {
		return err
	}
	defer ws.CloseNow()

	if err := sendSessionReq(ctx, ws, map[string]any{
		"type":      "wait_for_finish_request",
		"requestId": "cli_wait",
		"agentId":   agentID,
		"timeoutMs": *timeoutMs,
	}); err != nil {
		return err
	}
	resp, err := waitSessionResp(ctx, ws, "wait_for_finish_response", "")
	if err != nil {
		return err
	}
	b, _ := json.MarshalIndent(resp, "", "  ")
	fmt.Fprintln(stdout, string(b))
	return nil
}

type healthStatus struct {
	Status   string `json:"status"`
	ServerID string `json:"serverId"`
	Version  string `json:"version"`
}

func probeHealth(addr string) (*healthStatus, error) {
	u := addr
	if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
		u = "http://" + u
	}
	client := &http.Client{
		Timeout:   2 * time.Second,
		Transport: &http.Transport{Proxy: nil},
	}
	resp, err := client.Get(strings.TrimRight(u, "/") + "/health")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status %d", resp.StatusCode)
	}
	var st healthStatus
	if err := json.NewDecoder(resp.Body).Decode(&st); err != nil {
		return nil, err
	}
	return &st, nil
}

func runDaemonCmd(args []string, stdout io.Writer) error {
	sub := "status"
	rest := args
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		sub = args[0]
		rest = args[1:]
	}

	switch sub {
	case "status":
		fs := flag.NewFlagSet("daemon status", flag.ContinueOnError)
		addr := fs.String("addr", defaultListenAddr(), "daemon address")
		homeDir := fs.String("home", "", "byspace home directory")
		if err := fs.Parse(rest); err != nil {
			return err
		}

		if st, err := probeHealth(*addr); err == nil {
			fmt.Fprintf(stdout, "running  addr=%s  serverId=%s  version=%s\n", *addr, st.ServerID, st.Version)
			return nil
		}

		resolvedHome, err := home.Resolve(*homeDir)
		if err != nil {
			return err
		}
		srvID, _ := home.GetOrCreateServerID(resolvedHome)
		fmt.Fprintf(stdout, "stopped  home=%s  serverId=%s\n", resolvedHome, srvID)
		return nil

	case "start":
		fs := flag.NewFlagSet("daemon start", flag.ContinueOnError)
		addr := fs.String("addr", defaultListenAddr(), "daemon listen address")
		homeDir := fs.String("home", "", "byspace home directory")
		relayURL := fs.String("relay", os.Getenv("BYSPACE_RELAY_URL"), "optional relay URL")
		if err := fs.Parse(rest); err != nil {
			return err
		}
		resolvedHome, err := home.Resolve(*homeDir)
		if err != nil {
			return err
		}
		if st, err := probeHealth(*addr); err == nil {
			fmt.Fprintf(stdout, "already running  addr=%s  serverId=%s\n", *addr, st.ServerID)
			return nil
		}
		pid, err := daemon.StartBackground("", resolvedHome, *addr, *relayURL)
		if err != nil {
			return err
		}
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			if st, err := probeHealth(*addr); err == nil {
				fmt.Fprintf(stdout, "started  pid=%d  addr=%s  serverId=%s\n", pid, *addr, st.ServerID)
				return nil
			}
			time.Sleep(50 * time.Millisecond)
		}
		fmt.Fprintf(stdout, "started  pid=%d  addr=%s\n", pid, *addr)
		return nil

	case "stop":
		fs := flag.NewFlagSet("daemon stop", flag.ContinueOnError)
		homeDir := fs.String("home", "", "byspace home directory")
		if err := fs.Parse(rest); err != nil {
			return err
		}
		resolvedHome, err := home.Resolve(*homeDir)
		if err != nil {
			return err
		}
		pid, stopped, err := daemon.StopRunning(resolvedHome)
		if err != nil {
			return err
		}
		if stopped {
			fmt.Fprintf(stdout, "stopped  pid=%d  home=%s\n", pid, resolvedHome)
		} else {
			fmt.Fprintf(stdout, "not running  home=%s\n", resolvedHome)
		}
		return nil

	case "restart":
		fs := flag.NewFlagSet("daemon restart", flag.ContinueOnError)
		addr := fs.String("addr", defaultListenAddr(), "daemon listen address")
		homeDir := fs.String("home", "", "byspace home directory")
		relayURL := fs.String("relay", os.Getenv("BYSPACE_RELAY_URL"), "optional relay URL")
		if err := fs.Parse(rest); err != nil {
			return err
		}
		resolvedHome, err := home.Resolve(*homeDir)
		if err != nil {
			return err
		}
		if _, _, err := daemon.StopRunning(resolvedHome); err != nil {
			return err
		}
		// Wait for the port to be released before starting. Without this the new process can
		// lose the bind race against the one that is still shutting down, and `restart` reports
		// success while nothing is listening.
		daemon.WaitForShutdown(resolvedHome, *addr, 5*time.Second)
		return runDaemonCmd([]string{"start", "--addr", *addr, "--home", resolvedHome, "--relay", *relayURL}, stdout)

	case "print-plist":
		exe, _ := os.Executable()
		fmt.Fprint(stdout, daemon.RenderLaunchdPlist(exe, []string{"serve"}, daemon.CarriedEnviron(), ""))
		return nil

	case "print-unit":
		exe, _ := os.Executable()
		fmt.Fprint(stdout, daemon.RenderSystemdUnit(exe, []string{"serve"}, daemon.CarriedEnviron()))
		return nil

	default:
		return fmt.Errorf("unsupported daemon subcommand %q", sub)
	}
}

func runMCPBridge(args []string, stdin io.Reader, stdout io.Writer) error {
	fs := flag.NewFlagSet("mcp-bridge", flag.ContinueOnError)
	addr := fs.String("addr", defaultListenAddr(), "daemon HTTP address")
	// The capability token authorizes this bridge to /mcp/agents without the user's password,
	// which an agent process does not have.
	token := fs.String("token", "", "daemon capability token")
	if err := fs.Parse(args); err != nil {
		return err
	}

	endpoint := *addr
	if !strings.HasPrefix(endpoint, "http://") && !strings.HasPrefix(endpoint, "https://") {
		endpoint = "http://" + endpoint
	}
	endpoint = strings.TrimRight(endpoint, "/") + "/mcp/agents"
	httpClient := &http.Client{Timeout: 60 * time.Second}
	authHeader := ""
	if strings.TrimSpace(*token) != "" {
		authHeader = "Bearer " + strings.TrimSpace(*token)
	}

	dec := json.NewDecoder(stdin)
	enc := json.NewEncoder(stdout)
	for {
		var req map[string]any
		if err := dec.Decode(&req); err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}

		bodyBytes, err := json.Marshal(req)
		if err != nil {
			continue
		}
		httpReq, reqErr := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
		if reqErr != nil {
			continue
		}
		httpReq.Header.Set("Content-Type", "application/json")
		if authHeader != "" {
			httpReq.Header.Set("Authorization", authHeader)
		}
		// No proxy: the bridge always talks to its own daemon over loopback.
		httpClient.Transport = &http.Transport{Proxy: nil}
		resp, err := httpClient.Do(httpReq)
		if err == nil {
			var out map[string]any
			if json.NewDecoder(resp.Body).Decode(&out) == nil {
				_ = resp.Body.Close()
				_ = enc.Encode(out)
				continue
			}
			_ = resp.Body.Close()
		}

		// Offline fallback if daemon is unreachable
		method, _ := req["method"].(string)
		id := req["id"]
		switch method {
		case "initialize":
			_ = enc.Encode(map[string]any{
				"jsonrpc": "2.0",
				"id":      id,
				"result": map[string]any{
					"protocolVersion": "2024-11-05",
					"serverInfo": map[string]any{
						"name":    "byspace-go-mcp",
						"version": "2.0.0",
					},
					"capabilities": map[string]any{
						"tools": map[string]any{},
					},
				},
			})
		case "tools/list":
			_ = enc.Encode(map[string]any{
				"jsonrpc": "2.0",
				"id":      id,
				"result": map[string]any{
					"tools": []any{},
				},
			})
		default:
			if id != nil {
				_ = enc.Encode(map[string]any{
					"jsonrpc": "2.0",
					"id":      id,
					"result":  map[string]any{},
				})
			}
		}
	}
}

func defaultListenAddr() string {
	if v := strings.TrimSpace(os.Getenv("BYSPACE_LISTEN")); v != "" {
		return v
	}
	return DefaultDevAddr
}

func dialDaemonWS(ctx context.Context, addr string) (*websocket.Conn, error) {
	wsURL := addr
	if !strings.HasPrefix(wsURL, "ws://") && !strings.HasPrefix(wsURL, "wss://") {
		wsURL = strings.TrimPrefix(wsURL, "http://")
		wsURL = strings.TrimPrefix(wsURL, "https://")
		wsURL = "ws://" + strings.TrimRight(wsURL, "/") + "/ws"
	}
	ws, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPClient: &http.Client{
			Transport: &http.Transport{Proxy: nil},
		},
	})
	if err != nil {
		return nil, err
	}
	ws.SetReadLimit(64 * 1024 * 1024)

	hello := `{"type":"hello","clientId":"byspace_go_cli","protocolVersion":1}`
	if err := ws.Write(ctx, websocket.MessageText, []byte(hello)); err != nil {
		ws.CloseNow()
		return nil, err
	}
	if _, err := waitSessionResp(ctx, ws, "status", "server_info"); err != nil {
		ws.CloseNow()
		return nil, err
	}
	return ws, nil
}

func sendSessionReq(ctx context.Context, ws *websocket.Conn, msg map[string]any) error {
	b, err := json.Marshal(map[string]any{
		"type":    "session",
		"message": msg,
	})
	if err != nil {
		return err
	}
	return ws.Write(ctx, websocket.MessageText, b)
}

func waitSessionResp(ctx context.Context, ws *websocket.Conn, wantType, wantStatus string) (map[string]any, error) {
	for {
		_, data, err := ws.Read(ctx)
		if err != nil {
			return nil, err
		}
		var env struct {
			Type    string `json:"type"`
			Message struct {
				Type    string         `json:"type"`
				Payload map[string]any `json:"payload"`
			} `json:"message"`
		}
		if err := json.Unmarshal(data, &env); err != nil || env.Type != "session" {
			continue
		}
		if env.Message.Type == "status" && env.Message.Payload["status"] == "agent_create_failed" {
			errMsg, _ := env.Message.Payload["error"].(string)
			return nil, errors.New(errMsg)
		}
		if env.Message.Type != wantType {
			continue
		}
		if wantStatus != "" {
			st, _ := env.Message.Payload["status"].(string)
			if st != wantStatus {
				continue
			}
		}
		return env.Message.Payload, nil
	}
}
