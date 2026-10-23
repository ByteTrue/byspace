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
	"github.com/ByteTrue/byspace/internal/agent/providers"
	"github.com/ByteTrue/byspace/internal/execres"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
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
  byspace attach <agent-id>          stream a running agent's output
  byspace ls [--home <dir>] [--json|--yaml|-q]
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

	// A bare path opens that project, the way `code .` does. Checked before the switch so the
	// convenience applies to every invocation, and only for an existing directory so a typo
	// still reports "unknown command" rather than a confusing open failure.
	if !knownCommand(cmd) && isPathLikeArg(cmd) {
		if resolved, resolveErr := resolveExistingDirectory(cmd); resolveErr == nil {
			if err := runOpenCmd([]string{resolved}, stdout); err != nil {
				fmt.Fprintln(stderr, "byspace open:", err)
				return 1
			}
			return 0
		}
	}

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
	case "attach":
		if err := runAttach(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace attach:", err)
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
		if err := runDaemonCmd(version, rest, stdout); err != nil {
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
	case "onboard":
		if err := runOnboard(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace onboard:", err)
			return 1
		}
		return 0
	case "hooks":
		if err := runHooks(rest, stdout); err != nil {
			fmt.Fprintln(stderr, "byspace hooks:", err)
			return 1
		}
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
	// The flags the node daemon accepts. Each one changes what the daemon does; accepting it and
	// ignoring it would be worse than rejecting it, because the user believes it worked.
	noWebUI := fs.Bool("no-web-ui", false, "do not serve the bundled web UI")
	webUI := fs.Bool("web-ui", false, "serve the bundled web UI (the default)")
	noInjectMCP := fs.Bool("no-inject-mcp", false, "do not inject the BySpace MCP server into created agents")
	relayUseTLS := fs.Bool("relay-use-tls", false, "use wss:// for the relay and pairing offers")
	if err := fs.Parse(args); err != nil {
		return err
	}

	srv, err := server.New(server.Options{
		HomeDir: *homeDir,
		Version: version,
		WebDir:  *webDir,
		// The MCP bridge injected into agents must call back to this daemon's address.
		ListenAddr:          *addr,
		DisableWebUI:        *noWebUI && !*webUI,
		DisableMCPInjection: *noInjectMCP,
		RelayUseTLS:         *relayUseTLS,
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
	exeName := ""
	if exe, exeErr := os.Executable(); exeErr == nil {
		exeName = filepath.Base(exe)
	}
	_ = daemon.WritePIDLock(srv.HomeDir(), daemon.PIDLockInfo{
		PID:     myPID,
		Listen:  &listenAddr,
		ExeName: exeName,
	})
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
}

func runAgentPrompt(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("run", flag.ContinueOnError)
	addr := fs.String("addr", "", "daemon address (default "+defaultListenAddr()+")")
	cwd := fs.String("cwd", "", "working directory")
	model := fs.String("model", "", "model identifier")
	thinking := fs.String("thinking", "", "thinking level")
	wait := fs.Bool("wait", true, "wait for turn completion")
	// The node CLI spells "do not wait" as --detach / --background; --wait=false also works.
	detach := fs.Bool("detach", false, "start the agent and return immediately (implies --wait=false)")
	background := fs.Bool("background", false, "alias for --detach")
	fs.BoolVar(detach, "d", false, "alias for --detach / --background")
	// The rest of the flags the node CLI accepts. Without them `byspace run` could only start an
	// agent in the current directory with the default provider, so anything else needed the app.
	provider := fs.String("provider", "", "agent provider (default: the daemon's)")
	workspaceID := fs.String("workspace", "", "run inside an existing workspace")
	mode := fs.String("mode", "", "provider mode (see: byspace agent mode <id>)")
	title := fs.String("title", "", "agent title")
	role := fs.String("role", "", "agent role")
	waitTimeout := fs.Duration("wait-timeout", 0, "how long to wait when --wait is set")
	// --output-schema asks the daemon for a JSON object with these properties. It also changes what
	// run prints: the model's reply is the object, not prose, and printing prose (or the agent id)
	// makes the flag useless to a script.
	outputSchema := fs.String("output-schema", "", "JSON Schema the reply must satisfy (object or @file)")
	// Worktree group. The three modes are what `create_agent_request.worktree` accepts; exposing
	// them here is what lets a CLI user get the same isolation the app's "new worktree" button
	// gives, instead of every agent sharing the main checkout.
	worktreeMode := fs.String("worktree-mode", "", "branch-off | checkout-branch | checkout-pr")
	worktreeSlug := fs.String("worktree-slug", "", "worktree directory name (default: derived from the branch)")
	newBranch := fs.String("new-branch", "", "branch to create (with --worktree-mode branch-off)")
	baseBranch := fs.String("base", "", "base ref for branch-off (default: the current HEAD)")
	branch := fs.String("branch", "", "existing branch (with --worktree-mode checkout-branch)")
	prNumber := fs.Int("pr-number", 0, "change request number (with --worktree-mode checkout-pr)")
	// --new-workspace is the node CLI's shorthand for "isolate this agent": local keeps the current
	// directory, worktree branches one. Exposed here because it is how the node CLI documents the
	// intent, while --worktree-mode spells out which branch.
	newWorkspace := fs.String("new-workspace", "", "local | worktree (shorthand for the isolation mode)")
	forge := fs.String("forge", "", "forge for a change-request checkout (default: detected)")
	imagePaths := multiFlag{}
	fs.Var(&imagePaths, "image", "image file to attach to the first message (repeatable)")
	var labels multiFlag
	fs.Var(&labels, "label", "key=value label (repeatable)")
	var envVars multiFlag
	fs.Var(&envVars, "env", "NAME=value for the agent process (repeatable)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	prompt := strings.TrimSpace(strings.Join(fs.Args(), " "))
	if prompt == "" {
		return errors.New("prompt is required")
	}
	if *detach || *background {
		*wait = false
	}
	workDir := *cwd
	if workDir == "" && strings.TrimSpace(*workspaceID) == "" {
		workDir, _ = os.Getwd()
	}

	// The context must outlive the wait, or a caller asking for a 30-minute timeout gets cancelled
	// after the default. Ten seconds of slack covers the create round trip.
	budget := time.Duration(waitBudget(*waitTimeout))*time.Millisecond + 10*time.Second
	if !*wait {
		budget = 60 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), budget)
	defer cancel()

	// Everything below validates flags before dialling. A typo in --worktree-mode or a non-image
	// passed as --image has to fail with its own message, not "connection refused" because the
	// daemon happened not to be running.
	cfg := map[string]any{}
	if p := strings.TrimSpace(*provider); p != "" {
		cfg["provider"] = p
	}
	if strings.TrimSpace(*workspaceID) == "" {
		cfg["cwd"] = workDir
	}
	if *model != "" {
		cfg["model"] = *model
	}
	if *thinking != "" {
		cfg["thinkingOptionId"] = *thinking
	}
	if *mode != "" {
		cfg["modeId"] = *mode
	}
	if env, envErr := parseKeyValueFlags(envVars, "env"); envErr != nil {
		return envErr
	} else if len(env) > 0 {
		cfg["env"] = env
	}

	request := map[string]any{
		"type":          "create_agent_request",
		"requestId":     "cli_create",
		"initialPrompt": prompt,
		"config":        cfg,
	}
	if workspace := strings.TrimSpace(*workspaceID); workspace != "" {
		request["workspaceId"] = workspace
	}
	if *title != "" {
		request["title"] = *title
	}
	if *role != "" {
		request["role"] = *role
	}
	if parsed, labelErr := parseKeyValueFlags(labels, "label"); labelErr != nil {
		return labelErr
	} else if len(parsed) > 0 {
		request["labels"] = parsed
	}

	effectiveWorktreeMode := strings.TrimSpace(*worktreeMode)
	// --new-workspace worktree with no explicit mode means "branch off a new branch", which is what
	// the node CLI does; --new-workspace local cancels any worktree request.
	switch strings.TrimSpace(*newWorkspace) {
	case "local":
		effectiveWorktreeMode = ""
	case "worktree":
		if effectiveWorktreeMode == "" {
			effectiveWorktreeMode = "branch-off"
		}
	case "":
		// No opinion: --worktree-mode decides on its own.
	default:
		return fmt.Errorf("--new-workspace %q is not local or worktree", *newWorkspace)
	}

	if worktreeModeValue := effectiveWorktreeMode; worktreeModeValue != "" {
		worktree := map[string]any{"mode": worktreeModeValue}
		switch worktreeModeValue {
		case "branch-off":
			branchName := strings.TrimSpace(*newBranch)
			if branchName == "" && strings.TrimSpace(*newWorkspace) == "worktree" {
				// `--new-workspace worktree` alone means "isolate me"; the daemon names the branch
				// from the prompt, which is what the app does. Omitting newBranch is how that is
				// requested, so only an explicit --worktree-mode branch-off requires the name.
				worktree["mode"] = "branch-off"
			} else if branchName == "" {
				return errors.New("--worktree-mode branch-off needs --new-branch")
			} else {
				worktree["newBranch"] = branchName
			}
			if strings.TrimSpace(*baseBranch) != "" {
				worktree["base"] = strings.TrimSpace(*baseBranch)
			}
		case "checkout-branch":
			if strings.TrimSpace(*branch) == "" {
				return errors.New("--worktree-mode checkout-branch needs --branch")
			}
			worktree["branch"] = strings.TrimSpace(*branch)
		case "checkout-pr":
			if *prNumber <= 0 {
				return errors.New("--worktree-mode checkout-pr needs --pr-number")
			}
			worktree["prNumber"] = *prNumber
		default:
			// Named rather than ignored: a typo in the mode would otherwise create an agent in the
			// main checkout while the user believes they asked for isolation.
			return fmt.Errorf("--worktree-mode %q is not branch-off, checkout-branch or checkout-pr", worktreeModeValue)
		}
		if slug := strings.TrimSpace(*worktreeSlug); slug != "" {
			worktree["slug"] = slug
		}
		if strings.TrimSpace(*forge) != "" {
			worktree["forge"] = strings.TrimSpace(*forge)
		}
		request["worktree"] = worktree
	}

	if len(imagePaths) > 0 {
		images := make([]any, 0, len(imagePaths))
		for _, path := range imagePaths {
			data, mediaType, readErr := readImageForPrompt(path)
			if readErr != nil {
				return readErr
			}
			images = append(images, map[string]any{"data": data, "mimeType": mediaType})
		}
		request["images"] = images
	}

	if schemaText := strings.TrimSpace(*outputSchema); schemaText != "" {
		if strings.HasPrefix(schemaText, "@") {
			read, readErr := os.ReadFile(strings.TrimPrefix(schemaText, "@"))
			if readErr != nil {
				return readErr
			}
			schemaText = string(read)
		}
		var schema any
		if err := json.Unmarshal([]byte(schemaText), &schema); err != nil {
			return fmt.Errorf("--output-schema is not valid JSON: %w", err)
		}
		request["outputSchema"] = schema
	}

	ws, err := dialDaemonWS(ctx, *addr)
	if err != nil {
		return err
	}
	defer ws.CloseNow()

	if err := sendSessionReq(ctx, ws, request); err != nil {
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
		"timeoutMs": waitBudget(*waitTimeout),
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
	// A provider can finish without a recorded last message (the run was interrupted, or the turn
	// produced only tool calls). The timeline is the fallback the node CLI uses for the same case.
	if text := lastAssistantTextFromTimeline(ctx, ws, agentID); text != "" {
		fmt.Fprintln(stdout, text)
		return nil
	}
	fmt.Fprintln(stdout, agentID)
	return nil
}

// lastAssistantTextFromTimeline reads the newest assistant message from an agent's timeline.
//
// Needed because `wait_for_finish_response.lastMessage` can be empty while the transcript holds the
// answer. Printing the agent id instead is a silent failure: a script gets an opaque string and no
// way to tell it apart from a real reply.
func lastAssistantTextFromTimeline(ctx context.Context, ws *websocket.Conn, agentID string) string {
	if err := sendSessionReq(ctx, ws, map[string]any{
		"type":      "fetch_agent_timeline_request",
		"requestId": "cli_timeline",
		"agentId":   agentID,
		"direction": "tail",
		"limit":     200,
	}); err != nil {
		return ""
	}
	resp, err := waitSessionResp(ctx, ws, "fetch_agent_timeline_response", "")
	if err != nil {
		return ""
	}
	entries, _ := resp["entries"].([]any)
	for index := len(entries) - 1; index >= 0; index-- {
		entry, ok := entries[index].(map[string]any)
		if !ok {
			continue
		}
		item, _ := entry["item"].(map[string]any)
		if item["type"] != "assistant_message" {
			continue
		}
		if text, _ := item["text"].(string); strings.TrimSpace(text) != "" {
			return text
		}
	}
	return ""
}

func runLogs(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("logs", flag.ContinueOnError)
	addr := fs.String("addr", "", "daemon address (default "+defaultListenAddr()+")")
	// The four flags the node CLI has. Without them `logs` could only dump everything once, which
	// is the least useful form: the common case is watching a running agent or looking at the tail
	// of a long one.
	follow := fs.Bool("f", false, "stream new entries as they arrive")
	fs.BoolVar(follow, "follow", false, "stream new entries as they arrive")
	tail := fs.Int("tail", 0, "show only the last N entries")
	since := fs.Duration("since", 0, "show entries from the last duration (e.g. 10m)")
	filter := fs.String("filter", "", "show only entries whose text contains this")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("agent-id is required")
	}
	agentID := fs.Arg(0)

	budget := 10 * time.Second
	if *follow {
		// A follow has no natural end. The deadline still exists so Ctrl-C is not the only exit:
		// an agent that never speaks again would otherwise leave the command waiting forever with
		// no way to tell whether it is still connected.
		budget = 24 * time.Hour
	}
	ctx, cancel := context.WithTimeout(context.Background(), budget)
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

	if *since > 0 {
		entries = entriesSince(entries, time.Now().Add(-*since))
	}
	if *tail > 0 && len(entries) > *tail {
		entries = entries[len(entries)-*tail:]
	}
	needle := strings.ToLower(strings.TrimSpace(*filter))
	// The count is what a follower starts from: replaying everything again would duplicate the
	// history the caller just read.
	printed := 0
	var lastSeq int64
	for _, rawEntry := range entries {
		entry, ok := rawEntry.(map[string]any)
		if !ok {
			continue
		}
		if seq := entrySeq(entry); seq > lastSeq {
			lastSeq = seq
		}
		if needle != "" && !entryMatches(entry, needle) {
			continue
		}
		fmt.Fprintln(stdout, formatTimelineEntry(entry))
		printed++
	}

	if !*follow {
		return nil
	}
	// 0 means "from now"; the daemon decides what that is, so the cursor is the last seq we saw.
	return followTimeline(ctx, ws, agentID, lastSeq, needle, stdout)
}

// entriesSince keeps entries stamped at or after a cutoff.
func entriesSince(entries []any, cutoff time.Time) []any {
	kept := make([]any, 0, len(entries))
	for _, raw := range entries {
		entry, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		stamp, _ := entry["timestamp"].(string)
		parsed, err := time.Parse(time.RFC3339Nano, stamp)
		if err != nil {
			// An entry with no readable timestamp is kept: dropping it silently would hide a
			// provider that stopped stamping, which is the more important problem.
			kept = append(kept, raw)
			continue
		}
		if !parsed.Before(cutoff) {
			kept = append(kept, raw)
		}
	}
	return kept
}

// entrySeq reads an entry's sequence number.
func entrySeq(entry map[string]any) int64 {
	switch value := entry["seq"].(type) {
	case float64:
		return int64(value)
	case int64:
		return value
	case int:
		return int64(value)
	}
	return 0
}

// entryMatches tests an entry against a lowercased needle.
func entryMatches(entry map[string]any, needle string) bool {
	return strings.Contains(strings.ToLower(formatTimelineEntry(entry)), needle)
}

// formatTimelineEntry renders one entry the way `logs` prints it.
func formatTimelineEntry(entry map[string]any) string {
	item, _ := entry["item"].(map[string]any)
	itemType, _ := item["type"].(string)
	text, _ := item["text"].(string)
	name, _ := item["name"].(string)
	if name != "" {
		return fmt.Sprintf("[%s:%s] %s", itemType, name, text)
	}
	return fmt.Sprintf("[%s] %s", itemType, text)
}

// followTimeline streams entries after cursor until the connection ends.
//
// Polls `fetch_agent_timeline_request` with `direction: "after"` rather than waiting on a push
// subscription: the request carries a cursor and the daemon answers with a delta, which needs no
// additional protocol surface on a CLI that only reads.
func followTimeline(ctx context.Context, ws *websocket.Conn, agentID string, cursor int64, needle string, stdout io.Writer) error {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}

		if err := sendSessionReq(ctx, ws, map[string]any{
			"type":        "fetch_agent_timeline_request",
			"requestId":   "cli_follow",
			"agentId":     agentID,
			"direction":   "after",
			"afterSeq":    cursor,
			"windowAfter": cursor,
		}); err != nil {
			return nil
		}
		resp, err := waitSessionResp(ctx, ws, "fetch_agent_timeline_response", "")
		if err != nil {
			return nil
		}
		entries, _ := resp["entries"].([]any)
		for _, rawEntry := range entries {
			entry, ok := rawEntry.(map[string]any)
			if !ok {
				continue
			}
			seq := entrySeq(entry)
			if seq <= cursor {
				continue
			}
			cursor = seq
			if needle != "" && !entryMatches(entry, needle) {
				continue
			}
			fmt.Fprintln(stdout, formatTimelineEntry(entry))
		}
	}
}

func runWait(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("wait", flag.ContinueOnError)
	addr := fs.String("addr", "", "daemon address (default "+defaultListenAddr()+")")
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
	transport := &http.Transport{Proxy: nil}
	// A unix socket has no URL to build; the health check has to go over the same connection the
	// rest of the client would use, or `daemon status` reports a running daemon as stopped.
	if socketPath, ok := unixSocketPath(addr); ok {
		u = "http://localhost"
		transport = &http.Transport{
			Proxy: nil,
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				var dialer net.Dialer
				return dialer.DialContext(ctx, "unix", socketPath)
			},
		}
	} else if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
		u = "http://" + u
	}
	client := &http.Client{Timeout: 2 * time.Second, Transport: transport}
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

func runDaemonCmd(cliVersion string, args []string, stdout io.Writer) error {
	sub := "status"
	rest := args
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		sub = args[0]
		rest = args[1:]
	}

	switch sub {
	case "status":
		fs := flag.NewFlagSet("daemon status", flag.ContinueOnError)
		addr := fs.String("addr", "", "daemon address (default "+defaultListenAddr()+")")
		homeDir := fs.String("home", "", "byspace home directory")
		if err := fs.Parse(rest); err != nil {
			return err
		}

		if st, healthErr := probeHealth(*addr); healthErr == nil {
			fmt.Fprintf(stdout, "running  addr=%s  serverId=%s  version=%s\n", *addr, st.ServerID, st.Version)
			// A version mismatch means the CLI and the daemon disagree about the protocol. The
			// symptom is a command that silently does nothing, so it is worth saying out loud
			// here rather than leaving the user to infer it from behaviour.
			if st.Version != "" && cliVersion != "" && st.Version != cliVersion {
				fmt.Fprintf(stdout, "warning: daemon runs %s but this CLI is %s; restart the daemon\n",
					st.Version, cliVersion)
			}
			reportProviderHealth(stdout)
			reportRelayStatus(stdout, *homeDir)
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
		relayUseTLS := fs.Bool("relay-use-tls", false, "use wss:// for the relay and pairing offers")
		noInjectMCP := fs.Bool("no-inject-mcp", false, "do not inject the BySpace MCP server into created agents")
		noWebUI := fs.Bool("no-web-ui", false, "do not serve the bundled web UI")
		foreground := fs.Bool("foreground", false, "run in the foreground instead of daemonizing")
		webUI := fs.Bool("web-ui", false, "serve the bundled web UI (the default)")
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
		// The flags are forwarded to the serve process: accepting them here and not passing them on
		// would leave the user believing a setting took effect.
		var webUISetting *bool
		switch {
		case *noWebUI && !*webUI:
			disabled := false
			webUISetting = &disabled
		case *webUI && !*noWebUI:
			enabled := true
			webUISetting = &enabled
		}
		if *foreground {
			// Foreground means "the daemon is this process": no pid lock, no detach, logs on the
			// terminal. That is what a container entrypoint or a debugger needs, and it is why the
			// flag exists rather than being sugar for --web-ui.
			serveArgs := []string{"--addr", *addr, "--home", resolvedHome}
			if strings.TrimSpace(*relayURL) != "" {
				serveArgs = append(serveArgs, "--relay", *relayURL)
			}
			if *relayUseTLS {
				serveArgs = append(serveArgs, "--relay-use-tls")
			}
			if *noInjectMCP {
				serveArgs = append(serveArgs, "--no-inject-mcp")
			}
			if webUISetting != nil && !*webUISetting {
				serveArgs = append(serveArgs, "--no-web-ui")
			}
			return runServe(cliVersion, serveArgs, stdout)
		}

		pid, err := daemon.StartBackgroundWithOptions(daemon.StartOptions{
			HomeDir:     resolvedHome,
			Addr:        *addr,
			RelayURL:    *relayURL,
			RelayUseTLS: *relayUseTLS,
			InjectMCP:   !*noInjectMCP,
			WebUI:       webUISetting,
		})
		if err != nil {
			return err
		}
		// Wait for the daemon to actually serve before reporting success.
		//
		// Reporting "started" on a timeout is worse than reporting failure: the PID file exists
		// and the health check never answered, so the user believes the daemon is up and the
		// next command times out with no clue why. The most common cause is a port already in
		// use, which the child logs and exits from — so the log tail is the useful part of the
		// message.
		deadline := time.Now().Add(daemonStartTimeout)
		for time.Now().Before(deadline) {
			if st, healthErr := probeHealth(*addr); healthErr == nil {
				fmt.Fprintf(stdout, "started  pid=%d  addr=%s  serverId=%s\n", pid, *addr, st.ServerID)
				return nil
			}
			if !daemon.ProcessAlive(pid) {
				return fmt.Errorf("daemon exited during startup (pid %d); %s", pid, daemonLogTail(resolvedHome))
			}
			time.Sleep(50 * time.Millisecond)
		}
		return fmt.Errorf("daemon did not become ready within %s (pid %d); %s",
			daemonStartTimeout, pid, daemonLogTail(resolvedHome))

	case "stop":
		fs := flag.NewFlagSet("daemon stop", flag.ContinueOnError)
		// How long to wait after SIGKILL before giving up. A daemon finishing a large write can take
		// a moment to disappear, and "still running" on a process that is already dying is a
		// confusing thing to report.
		killTimeout := fs.Int("kill-timeout", 3, "seconds to wait after SIGKILL before failing")
		homeDir := fs.String("home", "", "byspace home directory")
		if err := fs.Parse(rest); err != nil {
			return err
		}
		resolvedHome, err := home.Resolve(*homeDir)
		if err != nil {
			return err
		}
		// The flag is documented as "wait after SIGKILL", but the useful wait is before it: SIGTERM
		// is already the polite request, and SIGKILL cannot be waited on. The value is applied to
		// the SIGTERM grace period, which is the wait that actually decides the outcome.
		grace := time.Duration(*killTimeout) * time.Second
		if grace <= 0 {
			grace = 3 * time.Second
		}
		pid, stopped, err := daemon.StopRunningWithTimeout(resolvedHome, grace)
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
		return runDaemonCmd(cliVersion, []string{"start", "--addr", *addr, "--home", resolvedHome, "--relay", *relayURL}, stdout)

	case "install-service":
		fs := flag.NewFlagSet("daemon install-service", flag.ContinueOnError)
		homeDir := fs.String("home", "", "byspace home directory")
		addr := fs.String("addr", defaultListenAddr(), "daemon listen address")
		fs.StringVar(addr, "listen", defaultListenAddr(), "daemon listen address")
		asJSON := fs.Bool("json", false, "output JSON")
		if err := fs.Parse(rest); err != nil {
			return err
		}
		resolvedHome, resolveErr := home.Resolve(*homeDir)
		if resolveErr != nil {
			return resolveErr
		}
		exe, exeErr := os.Executable()
		if exeErr != nil {
			return exeErr
		}
		result, installErr := daemon.InstallLoginService(
			exe,
			[]string{"serve", "--addr", *addr, "--home", resolvedHome},
			daemon.CarriedEnviron(),
			daemon.LogPath(resolvedHome),
		)
		if installErr != nil {
			return installErr
		}
		if *asJSON {
			return writeJSON(stdout, map[string]any{
				"action":         "installed",
				"definitionPath": result.DefinitionPath,
				"loaded":         result.Loaded,
				"note":           result.Note,
			})
		}
		fmt.Fprintf(stdout, "definition: %s\n", result.DefinitionPath)
		if result.Loaded {
			fmt.Fprintln(stdout, "registered: yes — the daemon starts at login")
		} else {
			// The file exists but the platform did not accept it; saying "installed" would hide
			// the fact that nothing will start at login.
			fmt.Fprintln(stdout, "registered: no — the definition was written but not loaded")
			if result.Note != "" {
				fmt.Fprintf(stdout, "  %s\n", result.Note)
			}
			return fmt.Errorf("could not register the login service")
		}
		return nil

	case "uninstall-service":
		fs := flag.NewFlagSet("daemon uninstall-service", flag.ContinueOnError)
		asJSON := fs.Bool("json", false, "output JSON")
		if err := fs.Parse(rest); err != nil {
			return err
		}
		if err := daemon.UninstallLoginService(); err != nil {
			return err
		}
		if *asJSON {
			return writeJSON(stdout, map[string]any{"action": "uninstalled"})
		}
		fmt.Fprintln(stdout, "login service removed")
		return nil

	case "service-status":
		fs := flag.NewFlagSet("daemon service-status", flag.ContinueOnError)
		asJSON := fs.Bool("json", false, "output JSON")
		if err := fs.Parse(rest); err != nil {
			return err
		}
		status := daemon.QueryServiceStatus()
		if *asJSON {
			return writeJSON(stdout, map[string]any{
				"supported":  status.Supported,
				"registered": status.Registered,
				"running":    status.Running,
				"detail":     status.Detail,
			})
		}
		if !status.Supported {
			fmt.Fprintf(stdout, "login service: unsupported (%s)\n", status.Detail)
			return nil
		}
		switch {
		case !status.Registered:
			fmt.Fprintf(stdout, "login service: not installed (%s)\n", status.Detail)
		case status.Running:
			fmt.Fprintln(stdout, "login service: registered and running")
		default:
			fmt.Fprintf(stdout, "login service: registered but not running (%s)\n", status.Detail)
		}
		return nil

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
		// The daemon needs to know which agent is asking so it can apply that provider's
		// tool policy; the bridge is the only one that knows.
		if agentID := strings.TrimSpace(os.Getenv("BYSPACE_MCP_AGENT_ID")); agentID != "" {
			httpReq.Header.Set("X-BySpace-Agent-Id", agentID)
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

// dialDaemonWS connects to a daemon.
//
// When no explicit address was given, every recorded candidate is tried: a daemon may be listening
// on a unix socket or on TCP, and the CLI cannot know which without asking. Trying only one meant a
// command failed against a daemon that was plainly running.
func dialDaemonWS(ctx context.Context, addr string) (*websocket.Conn, error) {
	candidates := daemonHostCandidates(addr)
	if len(candidates) > 1 {
		failures := make([]string, 0, len(candidates))
		for _, candidate := range candidates {
			ws, err := dialDaemonWSAt(ctx, candidate)
			if err == nil {
				return ws, nil
			}
			failures = append(failures, candidate+": "+err.Error())
		}
		return nil, fmt.Errorf("no daemon reachable at %s", strings.Join(failures, "; "))
	}
	if len(candidates) == 1 {
		addr = candidates[0]
	}
	return dialDaemonWSAt(ctx, addr)
}

// dialDaemonWSAt connects to one address.
func dialDaemonWSAt(ctx context.Context, addr string) (*websocket.Conn, error) {
	// A unix socket address (an absolute path, or named pipe on Windows) has no host to dial.
	// The daemon supports listening on one for restricted environments, and without this every
	// command would fail to connect to a daemon that is plainly running.
	if socketPath, ok := unixSocketPath(addr); ok {
		return dialUnixSocket(ctx, socketPath)
	}

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

	hello := fmt.Sprintf(`{"type":"hello","clientId":%q,"protocolVersion":1}`, cliClientKey(homeDirForClientID()))
	if err := ws.Write(ctx, websocket.MessageText, []byte(hello)); err != nil {
		ws.CloseNow()
		return nil, err
	}
	info, err := waitSessionResp(ctx, ws, "status", "server_info")
	if err != nil {
		ws.CloseNow()
		return nil, err
	}
	rememberServerInfo(ws, info)
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

// daemonStartTimeout bounds how long `daemon start` waits for the health check.
//
// Longer than the old 3s: a cold start that writes a fresh PID lock and opens a socket can take
// a moment on a loaded machine, and failing spuriously is its own kind of bug.
const daemonStartTimeout = 15 * time.Second

// daemonLogTail returns the last few lines of the daemon log, for an error message.
func daemonLogTail(homeDir string) string {
	raw, err := os.ReadFile(daemon.LogPath(homeDir))
	if err != nil {
		return "no daemon log yet"
	}
	lines := strings.Split(strings.TrimRight(string(raw), "\n"), "\n")
	if len(lines) > 5 {
		lines = lines[len(lines)-5:]
	}
	tail := strings.TrimSpace(strings.Join(lines, "\n"))
	if tail == "" {
		return "daemon log is empty"
	}
	return "last log lines:\n" + tail
}

// reportProviderHealth lists each built-in provider's binary and version.
//
// "(--version failed)" is the difference between "not installed" and "installed but broken",
// which need different fixes — and it is the state that used to be reported as simply missing.
func reportProviderHealth(stdout io.Writer) {
	fmt.Fprintln(stdout, "providers:")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	for _, spec := range providers.BuiltinProviders {
		path := execres.Find(ctx, spec.Binary)
		if path == "" {
			fmt.Fprintf(stdout, "  %-16s %s (not found)\n", spec.ID, spec.Binary)
			continue
		}
		versionText, err := execres.Version(ctx, path)
		if err != nil || versionText == "" {
			fmt.Fprintf(stdout, "  %-16s %s (--version failed)\n", spec.ID, path)
			continue
		}
		fmt.Fprintf(stdout, "  %-16s %s (%s)\n", spec.ID, path, versionText)
	}
}

// unixSocketPath reports whether an address names a unix socket or named pipe.
//
// An absolute path is the socket form; a host:port always contains a colon before any separator,
// so the two cannot be confused.
func unixSocketPath(addr string) (string, bool) {
	trimmed := strings.TrimSpace(addr)
	if trimmed == "" || strings.Contains(trimmed, "://") {
		return "", false
	}
	if strings.HasPrefix(trimmed, "/") || strings.HasPrefix(trimmed, `\\.\pipe\`) {
		return trimmed, true
	}
	// A relative path with a separator is a socket too; a bare "host:port" is not.
	if strings.ContainsRune(trimmed, '/') && !strings.ContainsRune(trimmed, ':') {
		return trimmed, true
	}
	return "", false
}

// dialUnixSocket opens a WebSocket over a unix socket.
func dialUnixSocket(ctx context.Context, socketPath string) (*websocket.Conn, error) {
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(dialCtx context.Context, _, _ string) (net.Conn, error) {
			var dialer net.Dialer
			return dialer.DialContext(dialCtx, "unix", socketPath)
		},
	}
	// The Host header is checked by the daemon's allowed-hosts rule; a socket connection has no
	// meaningful host, so it uses loopback, which the daemon always accepts.
	ws, _, err := websocket.Dial(ctx, "ws://localhost/ws", &websocket.DialOptions{
		HTTPClient: &http.Client{Transport: transport},
	})
	if err != nil {
		return nil, fmt.Errorf("cannot connect to daemon socket %s: %w", socketPath, err)
	}
	ws.SetReadLimit(64 * 1024 * 1024)

	hello := fmt.Sprintf(`{"type":"hello","clientId":%q,"protocolVersion":1}`, cliClientKey(homeDirForClientID()))
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
