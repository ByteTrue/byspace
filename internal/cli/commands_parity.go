package cli

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/coder/websocket"
)

func waitAndPrintAgent(ctx context.Context, ws *websocket.Conn, agentID string, timeoutMs int, stdout io.Writer) error {
	_ = sendSessionReq(ctx, ws, map[string]any{
		"type":      "wait_for_finish_request",
		"requestId": "cli_wait_send",
		"agentId":   agentID,
		"timeoutMs": timeoutMs,
	})
	resp, err := waitSessionResp(ctx, ws, "wait_for_finish_response", "")
	if err != nil {
		return err
	}
	if finalMap, ok := resp["final"].(map[string]any); ok {
		if txt, ok := finalMap["assistantText"].(string); ok && txt != "" {
			fmt.Fprintln(stdout, txt)
			return nil
		}
	}
	if lastMsg, ok := resp["lastMessage"].(string); ok && lastMsg != "" {
		fmt.Fprintln(stdout, lastMsg)
		return nil
	}
	fmt.Fprintln(stdout, agentID)
	return nil
}

func runAgentGroupCmd(args []string, stdout io.Writer) error {
	if len(args) == 0 {
		return runList(nil, stdout)
	}
	sub := args[0]
	rest := args[1:]
	switch sub {
	case "ls", "list":
		return runList(rest, stdout)
	case "run", "create":
		return runAgentPrompt(rest, stdout)
	case "logs":
		return runLogs(rest, stdout)
	case "wait":
		return runWait(rest, stdout)
	case "send":
		return runAgentSend(rest, stdout)
	case "stop", "cancel":
		return runAgentStop(rest, stdout)
	case "archive":
		return runAgentArchive(rest, stdout)
	case "delete", "rm", "kill":
		return runAgentDelete(rest, stdout)
	case "inspect":
		return runAgentInspect(rest, stdout)
	case "detach":
		return runAgentDetach(rest, stdout)
	case "update", "mode":
		return runAgentUpdate(rest, stdout)
	case "import":
		return runAgentImport(rest, stdout)
	case "reload", "refresh":
		return runAgentReload(rest, stdout)
	case "open", "attach":
		return runAgentInspect(rest, stdout)
	default:
		return fmt.Errorf("unknown agent subcommand %q", sub)
	}
}

func runAgentSend(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("send", flag.ContinueOnError)
	addr := fs.String("addr", defaultListenAddr(), "daemon address")
	wait := fs.Bool("wait", false, "wait for turn completion")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() < 2 {
		return errors.New("usage: byspace send [--addr host:port] [--wait] <agent-id> <prompt>")
	}
	agentID := fs.Arg(0)
	prompt := strings.Join(fs.Args()[1:], " ")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	ws, err := dialDaemonWS(ctx, *addr)
	if err != nil {
		return err
	}
	defer ws.CloseNow()

	_ = sendSessionReq(ctx, ws, map[string]any{
		"type":      "send_agent_message_request",
		"requestId": "cli_send_1",
		"agentId":   agentID,
		"prompt":    prompt,
	})
	resp, err := waitSessionResp(ctx, ws, "send_agent_message_response", "")
	if err != nil {
		return err
	}
	if errMsg, _ := resp["error"].(string); errMsg != "" {
		return errors.New(errMsg)
	}
	if !*wait {
		fmt.Fprintln(stdout, agentID)
		return nil
	}
	return waitAndPrintAgent(ctx, ws, agentID, 300000, stdout)
}

func runAgentStop(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("stop", flag.ContinueOnError)
	addr := fs.String("addr", defaultListenAddr(), "daemon address")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: byspace stop [--addr host:port] <agent-id>")
	}
	agentID := fs.Arg(0)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ws, err := dialDaemonWS(ctx, *addr)
	if err != nil {
		return err
	}
	defer ws.CloseNow()

	_ = sendSessionReq(ctx, ws, map[string]any{
		"type":      "cancel_agent_request",
		"requestId": "cli_stop_1",
		"agentId":   agentID,
	})
	_, err = waitSessionResp(ctx, ws, "status", "agent_cancelled")
	if err != nil {
		return err
	}
	fmt.Fprintf(stdout, "cancelled %s\n", agentID)
	return nil
}

func runAgentArchive(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("archive", flag.ContinueOnError)
	addr := fs.String("addr", defaultListenAddr(), "daemon address")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: byspace archive [--addr host:port] <agent-id>")
	}
	agentID := fs.Arg(0)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ws, err := dialDaemonWS(ctx, *addr)
	if err != nil {
		return err
	}
	defer ws.CloseNow()

	_ = sendSessionReq(ctx, ws, map[string]any{
		"type":      "archive_agent_request",
		"requestId": "cli_arch_1",
		"agentId":   agentID,
	})
	_, err = waitSessionResp(ctx, ws, "status", "agent_archived")
	if err != nil {
		return err
	}
	fmt.Fprintf(stdout, "archived %s\n", agentID)
	return nil
}

func runAgentDelete(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("delete", flag.ContinueOnError)
	addr := fs.String("addr", defaultListenAddr(), "daemon address")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: byspace rm [--addr host:port] <agent-id>")
	}
	agentID := fs.Arg(0)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ws, err := dialDaemonWS(ctx, *addr)
	if err != nil {
		return err
	}
	defer ws.CloseNow()

	_ = sendSessionReq(ctx, ws, map[string]any{
		"type":      "delete_agent_request",
		"requestId": "cli_del_1",
		"agentId":   agentID,
	})
	_, err = waitSessionResp(ctx, ws, "status", "agent_deleted")
	if err != nil {
		return err
	}
	fmt.Fprintf(stdout, "deleted %s\n", agentID)
	return nil
}

func runAgentInspect(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("inspect", flag.ContinueOnError)
	addr := fs.String("addr", defaultListenAddr(), "daemon address")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: byspace inspect [--addr host:port] <agent-id>")
	}
	agentID := fs.Arg(0)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ws, err := dialDaemonWS(ctx, *addr)
	if err != nil {
		return err
	}
	defer ws.CloseNow()

	_ = sendSessionReq(ctx, ws, map[string]any{
		"type":      "fetch_agent_request",
		"requestId": "cli_insp_1",
		"agentId":   agentID,
	})
	resp, err := waitSessionResp(ctx, ws, "fetch_agent_response", "")
	if err != nil {
		return err
	}
	b, _ := json.MarshalIndent(resp["agent"], "", "  ")
	fmt.Fprintln(stdout, string(b))
	return nil
}

func runAgentDetach(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("detach", flag.ContinueOnError)
	addr := fs.String("addr", defaultListenAddr(), "daemon address")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: byspace agent detach <agent-id>")
	}
	agentID := fs.Arg(0)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ws, err := dialDaemonWS(ctx, *addr)
	if err != nil {
		return err
	}
	defer ws.CloseNow()
	_ = sendSessionReq(ctx, ws, map[string]any{
		"type":      "agent.detach.request",
		"requestId": "cli_det_1",
		"agentId":   agentID,
	})
	_, err = waitSessionResp(ctx, ws, "agent.detach.response", "")
	if err != nil {
		return err
	}
	fmt.Fprintf(stdout, "detached %s\n", agentID)
	return nil
}

func runAgentUpdate(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("update", flag.ContinueOnError)
	addr := fs.String("addr", defaultListenAddr(), "daemon address")
	name := fs.String("name", "", "agent title")
	model := fs.String("model", "", "model id")
	thinking := fs.String("thinking", "", "thinking level")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: byspace agent update [options] <agent-id>")
	}
	agentID := fs.Arg(0)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ws, err := dialDaemonWS(ctx, *addr)
	if err != nil {
		return err
	}
	defer ws.CloseNow()

	if *name != "" {
		_ = sendSessionReq(ctx, ws, map[string]any{
			"type":      "update_agent_request",
			"requestId": "cli_upd_1",
			"agentId":   agentID,
			"name":      *name,
		})
		_, _ = waitSessionResp(ctx, ws, "update_agent_response", "")
	}
	if *model != "" || *thinking != "" {
		cfg := map[string]any{}
		if *model != "" {
			cfg["modelId"] = *model
		}
		if *thinking != "" {
			cfg["thinkingOptionId"] = *thinking
		}
		_ = sendSessionReq(ctx, ws, map[string]any{
			"type":      "agent.config.apply.request",
			"requestId": "cli_cfg_1",
			"agentId":   agentID,
			"config":    cfg,
		})
		_, _ = waitSessionResp(ctx, ws, "agent.config.apply.response", "")
	}
	fmt.Fprintf(stdout, "updated %s\n", agentID)
	return nil
}

func runAgentImport(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("import", flag.ContinueOnError)
	addr := fs.String("addr", defaultListenAddr(), "daemon address")
	cwd := fs.String("cwd", "", "working directory")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: byspace agent import [--cwd <dir>] <session-file>")
	}
	handle := fs.Arg(0)
	workCwd := *cwd
	if workCwd == "" {
		workCwd, _ = os.Getwd()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ws, err := dialDaemonWS(ctx, *addr)
	if err != nil {
		return err
	}
	defer ws.CloseNow()
	_ = sendSessionReq(ctx, ws, map[string]any{
		"type":             "import_agent_request",
		"requestId":        "cli_imp_1",
		"provider":         "pi",
		"providerHandleId": handle,
		"cwd":              workCwd,
	})
	resp, err := waitSessionResp(ctx, ws, "status", "agent_created")
	if err != nil {
		return err
	}
	fmt.Fprintln(stdout, resp["agentId"])
	return nil
}

func runAgentReload(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("reload", flag.ContinueOnError)
	addr := fs.String("addr", defaultListenAddr(), "daemon address")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: byspace agent reload <agent-id>")
	}
	agentID := fs.Arg(0)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ws, err := dialDaemonWS(ctx, *addr)
	if err != nil {
		return err
	}
	defer ws.CloseNow()
	_ = sendSessionReq(ctx, ws, map[string]any{
		"type":      "refresh_agent_request",
		"requestId": "cli_rel_1",
		"agentId":   agentID,
	})
	_, err = waitSessionResp(ctx, ws, "status", "agent_updated")
	if err != nil {
		return err
	}
	fmt.Fprintf(stdout, "reloaded %s\n", agentID)
	return nil
}

func runProjectGroupCmd(args []string, stdout io.Writer) error {
	sub := "ls"
	rest := args
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		sub = args[0]
		rest = args[1:]
	}
	fs := flag.NewFlagSet("project "+sub, flag.ContinueOnError)
	addr := fs.String("addr", defaultListenAddr(), "daemon address")
	asJSON := fs.Bool("json", false, "output JSON")
	if err := fs.Parse(rest); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ws, err := dialDaemonWS(ctx, *addr)
	if err != nil {
		return err
	}
	defer ws.CloseNow()

	switch sub {
	case "ls", "list":
		_ = sendSessionReq(ctx, ws, map[string]any{"type": "project.list.request", "requestId": "cli_pl"})
		resp, err := waitSessionResp(ctx, ws, "project.list.response", "")
		if err != nil {
			return err
		}
		if *asJSON {
			b, _ := json.MarshalIndent(resp["projects"], "", "  ")
			fmt.Fprintln(stdout, string(b))
			return nil
		}
		projects, _ := resp["projects"].([]any)
		for _, item := range projects {
			if m, ok := item.(map[string]any); ok {
				fmt.Fprintf(stdout, "%-18s  %-20s  %s\n", m["projectId"], m["projectDisplayName"], m["projectRootPath"])
			}
		}
		return nil

	case "create", "add":
		cwd := fs.Arg(0)
		if cwd == "" {
			cwd, _ = os.Getwd()
		}
		_ = sendSessionReq(ctx, ws, map[string]any{"type": "project.add.request", "requestId": "cli_pa", "cwd": cwd})
		resp, err := waitSessionResp(ctx, ws, "project.add.response", "")
		if err != nil {
			return err
		}
		b, _ := json.MarshalIndent(resp["project"], "", "  ")
		fmt.Fprintln(stdout, string(b))
		return nil

	case "rename":
		if fs.NArg() < 2 {
			return errors.New("usage: byspace project rename <project-id> <name>")
		}
		_ = sendSessionReq(ctx, ws, map[string]any{
			"type":       "project.rename.request",
			"requestId":  "cli_pr",
			"projectId":  fs.Arg(0),
			"customName": fs.Arg(1),
		})
		_, err := waitSessionResp(ctx, ws, "project.rename.response", "")
		return err

	case "delete", "rm", "remove":
		if fs.NArg() < 1 {
			return errors.New("usage: byspace project delete <project-id>")
		}
		_ = sendSessionReq(ctx, ws, map[string]any{
			"type":      "project.remove.request",
			"requestId": "cli_pd",
			"projectId": fs.Arg(0),
		})
		_, err := waitSessionResp(ctx, ws, "project.remove.response", "")
		return err

	default:
		return fmt.Errorf("unknown project subcommand %q", sub)
	}
}

func runWorkspaceGroupCmd(args []string, stdout io.Writer) error {
	sub := "ls"
	rest := args
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		sub = args[0]
		rest = args[1:]
	}
	fs := flag.NewFlagSet("workspace "+sub, flag.ContinueOnError)
	addr := fs.String("addr", defaultListenAddr(), "daemon address")
	asJSON := fs.Bool("json", false, "output JSON")
	if err := fs.Parse(rest); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ws, err := dialDaemonWS(ctx, *addr)
	if err != nil {
		return err
	}
	defer ws.CloseNow()

	switch sub {
	case "ls", "list":
		_ = sendSessionReq(ctx, ws, map[string]any{"type": "fetch_workspaces_request", "requestId": "cli_wl"})
		resp, err := waitSessionResp(ctx, ws, "fetch_workspaces_response", "")
		if err != nil {
			return err
		}
		if *asJSON {
			b, _ := json.MarshalIndent(resp["entries"], "", "  ")
			fmt.Fprintln(stdout, string(b))
			return nil
		}
		entries, _ := resp["entries"].([]any)
		for _, item := range entries {
			if m, ok := item.(map[string]any); ok {
				fmt.Fprintf(stdout, "%-18s  %-20s  %s\n", m["id"], m["name"], m["workspaceDirectory"])
			}
		}
		return nil

	case "create":
		cwd := fs.Arg(0)
		if cwd == "" {
			cwd, _ = os.Getwd()
		}
		_ = sendSessionReq(ctx, ws, map[string]any{"type": "workspace.create.request", "requestId": "cli_wc", "cwd": cwd})
		resp, err := waitSessionResp(ctx, ws, "workspace.create.response", "")
		if err != nil {
			return err
		}
		b, _ := json.MarshalIndent(resp["workspace"], "", "  ")
		fmt.Fprintln(stdout, string(b))
		return nil

	case "rename":
		if fs.NArg() < 2 {
			return errors.New("usage: byspace workspace rename <workspace-id> <title>")
		}
		_ = sendSessionReq(ctx, ws, map[string]any{
			"type":        "workspace.title.set.request",
			"requestId":   "cli_wr",
			"workspaceId": fs.Arg(0),
			"title":       fs.Arg(1),
		})
		_, err := waitSessionResp(ctx, ws, "workspace.title.set.response", "")
		return err

	case "setup":
		// Runs the project's setup commands for a worktree. This is also the action that clears
		// an untrusted from-a-PR workspace's block, so "Run setup to allow them" is actionable
		// from a terminal.
		if fs.NArg() < 1 {
			return errors.New("usage: byspace workspace setup <workspace-id>")
		}
		workspaceID := fs.Arg(0)
		if reqErr := sendSessionReq(ctx, ws, map[string]any{
			"type":        "workspace.setup.run.request",
			"requestId":   "cli_ws_setup",
			"workspaceId": workspaceID,
		}); reqErr != nil {
			return reqErr
		}
		resp, respErr := waitSessionResp(ctx, ws, "workspace.setup.run.response", "")
		if respErr != nil {
			return respErr
		}
		if *asJSON {
			b, _ := json.MarshalIndent(resp, "", "  ")
			fmt.Fprintln(stdout, string(b))
			return nil
		}
		status, _ := resp["status"].(string)
		fmt.Fprintf(stdout, "setup %s: %s\n", workspaceID, status)
		if failure, _ := resp["error"].(string); failure != "" {
			return errors.New(failure)
		}
		return nil

	case "archive":
		if fs.NArg() < 1 {
			return errors.New("usage: byspace workspace archive <workspace-id>")
		}
		_ = sendSessionReq(ctx, ws, map[string]any{
			"type":        "archive_workspace_request",
			"requestId":   "cli_wa",
			"workspaceId": fs.Arg(0),
		})
		_, err := waitSessionResp(ctx, ws, "archive_workspace_response", "")
		return err

	default:
		return fmt.Errorf("unknown workspace subcommand %q", sub)
	}
}

func runTerminalGroupCmd(args []string, stdout io.Writer) error {
	sub := "ls"
	rest := args
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		sub = args[0]
		rest = args[1:]
	}
	fs := flag.NewFlagSet("terminal "+sub, flag.ContinueOnError)
	addr := fs.String("addr", defaultListenAddr(), "daemon address")
	cwd := fs.String("cwd", "", "working directory")
	name := fs.String("name", "Terminal", "terminal name")
	if err := fs.Parse(rest); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ws, err := dialDaemonWS(ctx, *addr)
	if err != nil {
		return err
	}
	defer ws.CloseNow()

	switch sub {
	case "ls", "list":
		_ = sendSessionReq(ctx, ws, map[string]any{"type": "list_terminals_request", "requestId": "cli_tl", "cwd": *cwd})
		resp, err := waitSessionResp(ctx, ws, "list_terminals_response", "")
		if err != nil {
			return err
		}
		terms, _ := resp["terminals"].([]any)
		for _, item := range terms {
			if m, ok := item.(map[string]any); ok {
				fmt.Fprintf(stdout, "%-12s  %-16s  %s\n", m["id"], m["name"], m["cwd"])
			}
		}
		return nil

	case "create":
		workCwd := *cwd
		if workCwd == "" {
			workCwd, _ = os.Getwd()
		}
		_ = sendSessionReq(ctx, ws, map[string]any{
			"type":      "create_terminal_request",
			"requestId": "cli_tc",
			"cwd":       workCwd,
			"name":      *name,
		})
		resp, err := waitSessionResp(ctx, ws, "create_terminal_response", "")
		if err != nil {
			return err
		}
		if tMap, ok := resp["terminal"].(map[string]any); ok {
			fmt.Fprintln(stdout, tMap["id"])
		}
		return nil

	case "kill":
		if fs.NArg() < 1 {
			return errors.New("usage: byspace terminal kill <terminal-id>")
		}
		_ = sendSessionReq(ctx, ws, map[string]any{
			"type":       "kill_terminal_request",
			"requestId":  "cli_tk",
			"terminalId": fs.Arg(0),
		})
		_, err := waitSessionResp(ctx, ws, "kill_terminal_response", "")
		return err

	case "capture":
		if fs.NArg() < 1 {
			return errors.New("usage: byspace terminal capture <terminal-id>")
		}
		_ = sendSessionReq(ctx, ws, map[string]any{
			"type":       "capture_terminal_request",
			"requestId":  "cli_tcap",
			"terminalId": fs.Arg(0),
		})
		resp, err := waitSessionResp(ctx, ws, "capture_terminal_response", "")
		if err != nil {
			return err
		}
		if lines, ok := resp["lines"].([]any); ok {
			for _, l := range lines {
				if s, ok := l.(string); ok {
					fmt.Fprintln(stdout, s)
				}
			}
		}
		return nil

	case "send-keys":
		if fs.NArg() < 2 {
			return errors.New("usage: byspace terminal send-keys <terminal-id> <keys>")
		}
		_ = sendSessionReq(ctx, ws, map[string]any{
			"type":       "terminal_input",
			"terminalId": fs.Arg(0),
			"data":       strings.Join(fs.Args()[1:], " ") + "\n",
		})
		return nil

	default:
		return fmt.Errorf("unknown terminal subcommand %q", sub)
	}
}

func runProviderGroupCmd(args []string, stdout io.Writer) error {
	sub := "ls"
	rest := args
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		sub = args[0]
		rest = args[1:]
	}
	fs := flag.NewFlagSet("provider "+sub, flag.ContinueOnError)
	addr := fs.String("addr", defaultListenAddr(), "daemon address")
	if err := fs.Parse(rest); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ws, err := dialDaemonWS(ctx, *addr)
	if err != nil {
		return err
	}
	defer ws.CloseNow()

	switch sub {
	case "ls", "list":
		_ = sendSessionReq(ctx, ws, map[string]any{"type": "list_available_providers_request", "requestId": "cli_pvl"})
		resp, err := waitSessionResp(ctx, ws, "list_available_providers_response", "")
		if err != nil {
			return err
		}
		b, _ := json.MarshalIndent(resp["providers"], "", "  ")
		fmt.Fprintln(stdout, string(b))
		return nil

	case "models":
		_ = sendSessionReq(ctx, ws, map[string]any{"type": "list_provider_models_request", "requestId": "cli_pvm", "provider": "pi"})
		resp, err := waitSessionResp(ctx, ws, "list_provider_models_response", "")
		if err != nil {
			return err
		}
		b, _ := json.MarshalIndent(resp["models"], "", "  ")
		fmt.Fprintln(stdout, string(b))
		return nil

	case "diagnostic":
		_ = sendSessionReq(ctx, ws, map[string]any{"type": "provider_diagnostic_request", "requestId": "cli_pvd", "provider": "pi"})
		resp, err := waitSessionResp(ctx, ws, "provider_diagnostic_response", "")
		if err != nil {
			return err
		}
		fmt.Fprintln(stdout, resp["diagnostic"])
		return nil

	default:
		return fmt.Errorf("unknown provider subcommand %q", sub)
	}
}

func runScriptGroupCmd(args []string, stdout io.Writer) error {
	sub := "ls"
	rest := args
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		sub = args[0]
		rest = args[1:]
	}
	fs := flag.NewFlagSet("script "+sub, flag.ContinueOnError)
	addr := fs.String("addr", defaultListenAddr(), "daemon address")
	wsID := fs.String("workspace", "", "workspace ID")
	if err := fs.Parse(rest); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ws, err := dialDaemonWS(ctx, *addr)
	if err != nil {
		return err
	}
	defer ws.CloseNow()

	switch sub {
	case "ls", "list":
		_ = sendSessionReq(ctx, ws, map[string]any{
			"type":        "workspace.script.list.request",
			"requestId":   "cli_scl",
			"workspaceId": *wsID,
		})
		resp, err := waitSessionResp(ctx, ws, "workspace.script.list.response", "")
		if err != nil {
			return err
		}
		b, _ := json.MarshalIndent(resp["scripts"], "", "  ")
		fmt.Fprintln(stdout, string(b))
		return nil

	case "start":
		if fs.NArg() < 1 {
			return errors.New("usage: byspace script start [--workspace <id>] <script-name>")
		}
		_ = sendSessionReq(ctx, ws, map[string]any{
			"type":        "start_workspace_script_request",
			"requestId":   "cli_scs",
			"workspaceId": *wsID,
			"scriptName":  fs.Arg(0),
		})
		resp, err := waitSessionResp(ctx, ws, "start_workspace_script_response", "")
		if err != nil {
			return err
		}
		fmt.Fprintln(stdout, resp["terminalId"])
		return nil

	case "stop":
		if fs.NArg() < 1 {
			return errors.New("usage: byspace script stop [--workspace <id>] <script-name>")
		}
		_ = sendSessionReq(ctx, ws, map[string]any{
			"type":        "workspace.script.stop.request",
			"requestId":   "cli_scst",
			"workspaceId": *wsID,
			"scriptName":  fs.Arg(0),
		})
		_, err := waitSessionResp(ctx, ws, "workspace.script.stop.response", "")
		return err

	default:
		return fmt.Errorf("unknown script subcommand %q", sub)
	}
}

func runPermitGroupCmd(args []string, stdout io.Writer) error {
	sub := "ls"
	rest := args
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		sub = args[0]
		rest = args[1:]
	}
	fs := flag.NewFlagSet("permit "+sub, flag.ContinueOnError)
	addr := fs.String("addr", defaultListenAddr(), "daemon address")
	agentID := fs.String("agent", "", "agent ID")
	if err := fs.Parse(rest); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ws, err := dialDaemonWS(ctx, *addr)
	if err != nil {
		return err
	}
	defer ws.CloseNow()

	switch sub {
	case "ls", "list":
		_ = sendSessionReq(ctx, ws, map[string]any{"type": "fetch_agents_request", "requestId": "cli_pmls"})
		resp, err := waitSessionResp(ctx, ws, "fetch_agents_response", "")
		if err != nil {
			return err
		}
		entries, _ := resp["entries"].([]any)
		for _, it := range entries {
			if m, ok := it.(map[string]any); ok {
				if *agentID != "" && m["id"] != *agentID {
					continue
				}
				if perms, ok := m["pendingPermissions"].([]any); ok && len(perms) > 0 {
					b, _ := json.MarshalIndent(perms, "", "  ")
					fmt.Fprintf(stdout, "Agent %s:\n%s\n", m["id"], string(b))
				}
			}
		}
		return nil

	case "allow", "deny":
		if fs.NArg() < 2 {
			return fmt.Errorf("usage: byspace permit %s <agent-id> <request-id> [answer]", sub)
		}
		aid := fs.Arg(0)
		reqID := fs.Arg(1)
		ans := ""
		if fs.NArg() >= 3 {
			ans = strings.Join(fs.Args()[2:], " ")
		}
		behavior := "allow"
		if sub == "deny" {
			behavior = "deny"
		}
		_ = sendSessionReq(ctx, ws, map[string]any{
			"type":      "agent_permission_response",
			"agentId":   aid,
			"requestId": reqID,
			"response": map[string]any{
				"behavior": behavior,
				"updatedInput": map[string]any{
					"answers": map[string]any{"Answer": ans},
				},
			},
		})
		fmt.Fprintf(stdout, "%s %s\n", behavior, reqID)
		return nil

	default:
		return fmt.Errorf("unknown permit subcommand %q", sub)
	}
}

func runCloneCmd(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("clone", flag.ContinueOnError)
	addr := fs.String("addr", defaultListenAddr(), "daemon address")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: byspace clone <repo> [target-directory]")
	}
	repo := fs.Arg(0)
	targetDir := ""
	if fs.NArg() >= 2 {
		targetDir = fs.Arg(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	ws, err := dialDaemonWS(ctx, *addr)
	if err != nil {
		return err
	}
	defer ws.CloseNow()
	_ = sendSessionReq(ctx, ws, map[string]any{
		"type":            "project.github.clone.request",
		"requestId":       "cli_clone_1",
		"repo":            repo,
		"targetDirectory": targetDir,
	})
	resp, err := waitSessionResp(ctx, ws, "project.github.clone.response", "")
	if err != nil {
		return err
	}
	if errMsg, _ := resp["error"].(string); errMsg != "" {
		return errors.New(errMsg)
	}
	fmt.Fprintln(stdout, resp["checkoutPath"])
	return nil
}

func runOpenCmd(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("open", flag.ContinueOnError)
	addr := fs.String("addr", defaultListenAddr(), "daemon address")
	if err := fs.Parse(args); err != nil {
		return err
	}
	cwd := fs.Arg(0)
	if cwd == "" {
		cwd, _ = os.Getwd()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ws, err := dialDaemonWS(ctx, *addr)
	if err != nil {
		return err
	}
	defer ws.CloseNow()
	_ = sendSessionReq(ctx, ws, map[string]any{
		"type":      "open_project_request",
		"requestId": "cli_open_1",
		"cwd":       cwd,
	})
	resp, err := waitSessionResp(ctx, ws, "open_project_response", "")
	if err != nil {
		return err
	}
	b, _ := json.MarshalIndent(resp["workspace"], "", "  ")
	fmt.Fprintln(stdout, string(b))
	return nil
}
