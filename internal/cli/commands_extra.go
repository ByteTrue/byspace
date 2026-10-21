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

	duration "github.com/ByteTrue/byspace/internal/cadence"
	"github.com/ByteTrue/byspace/internal/server"
)

func runHeartbeatCmd(args []string, stdout io.Writer) error {
	if len(args) == 0 {
		return errors.New("usage: byspace heartbeat <create|list|delete> [options]")
	}
	sub := args[0]
	rest := args[1:]

	switch sub {
	case "create":
		fs := flag.NewFlagSet("heartbeat create", flag.ContinueOnError)
		addr := fs.String("addr", defaultListenAddr(), "daemon address")
		cronExpr := fs.String("cron", "", "cron expression (e.g. */10 * * * *)")
		every := fs.String("every", "1m", "interval: 90s / 15m / 2h / 1d, or a bare number of minutes")
		tz := fs.String("timezone", "UTC", "cron timezone")
		name := fs.String("name", "", "schedule name")
		maxRuns := fs.Int("max-runs", 0, "optional maximum number of runs")
		cwd := fs.String("cwd", "", "working directory for target agent")
		agentID := fs.String("agent-id", os.Getenv("BYSPACE_AGENT_ID"), "existing target agent ID")
		// The flags the node CLI has on `schedule create`. --prompt is an alternative to the
		// positional argument for a script that would rather not quote a long text; --run-now is
		// how a user checks a new schedule without waiting for the first tick.
		promptFlag := fs.String("prompt", "", "prompt text (instead of the positional argument)")
		runNow := fs.Bool("run-now", false, "run once immediately after creating")
		expiresIn := fs.String("expires-in", "", "stop scheduling after this duration (e.g. 7d)")
		targetModel := fs.String("model", "", "model for a new target agent")
		targetMode := fs.String("mode", "", "mode for a new target agent")
		targetThinking := fs.String("thinking", "", "thinking level for a new target agent")
		asJSON := fs.Bool("json", false, "output JSON")
		if err := fs.Parse(rest); err != nil {
			return err
		}
		prompt := strings.TrimSpace(*promptFlag)
		if prompt == "" {
			prompt = strings.TrimSpace(strings.Join(fs.Args(), " "))
		}
		if prompt == "" {
			return errors.New("usage: byspace heartbeat create [options] <prompt>")
		}

		var cadence map[string]any
		if strings.TrimSpace(*cronExpr) != "" {
			cadence = map[string]any{
				"type":       "cron",
				"expression": strings.TrimSpace(*cronExpr),
				"timezone":   *tz,
			}
		} else {
			// `--every` takes a human duration. Converting through the shared cadence parser means
			// a value five-field cron cannot express is refused here rather than becoming a
			// schedule that fires at the wrong times.
			interval, intervalErr := duration.ParseDuration(*every)
			if intervalErr != nil {
				return intervalErr
			}
			if _, cronErr := duration.EveryMsToFiveFieldCron(interval.Milliseconds()); cronErr != nil {
				return fmt.Errorf("%s: %w; use --cron for calendar schedules", *every, cronErr)
			}
			cadence = map[string]any{
				"type":    "every",
				"everyMs": interval.Milliseconds(),
			}
		}

		var target map[string]any
		if strings.TrimSpace(*agentID) != "" {
			target = map[string]any{
				"type":    "agent",
				"agentId": strings.TrimSpace(*agentID),
			}
		} else {
			workCwd := strings.TrimSpace(*cwd)
			if workCwd == "" {
				workCwd, _ = os.Getwd()
			}
			// No hardcoded provider: the daemon's default is the right answer when the user did not
			// name one, and pinning "pi" here meant a schedule could never target another provider.
			newAgentConfig := map[string]any{"cwd": workCwd}
			if strings.TrimSpace(*targetModel) != "" {
				newAgentConfig["model"] = strings.TrimSpace(*targetModel)
			}
			if strings.TrimSpace(*targetMode) != "" {
				newAgentConfig["modeId"] = strings.TrimSpace(*targetMode)
			}
			if strings.TrimSpace(*targetThinking) != "" {
				newAgentConfig["thinkingOptionId"] = strings.TrimSpace(*targetThinking)
			}
			target = map[string]any{"type": "new-agent", "config": newAgentConfig}
		}

		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		ws, err := dialDaemonWS(ctx, *addr)
		if err != nil {
			return err
		}
		defer ws.CloseNow()

		reqMsg := map[string]any{
			"type":      "schedule/create",
			"requestId": "req_hb_create",
			"prompt":    prompt,
			"cadence":   cadence,
			"target":    target,
		}
		if strings.TrimSpace(*name) != "" {
			reqMsg["name"] = strings.TrimSpace(*name)
		}
		if *runNow {
			reqMsg["runNow"] = true
		}
		if text := strings.TrimSpace(*expiresIn); text != "" {
			duration, durationErr := duration.ParseDuration(text)
			if durationErr != nil {
				return durationErr
			}
			reqMsg["expiresAt"] = time.Now().UTC().Add(duration).Format(time.RFC3339)
		}
		if *maxRuns > 0 {
			reqMsg["maxRuns"] = *maxRuns
		}

		if err := sendSessionReq(ctx, ws, reqMsg); err != nil {
			return err
		}
		payload, err := waitSessionResp(ctx, ws, "schedule/create/response", "")
		if err != nil {
			return err
		}
		if *asJSON {
			b, _ := json.MarshalIndent(payload["schedule"], "", "  ")
			fmt.Fprintln(stdout, string(b))
			return nil
		}
		sched, _ := payload["schedule"].(map[string]any)
		fmt.Fprintf(stdout, "%v\n", sched["id"])
		return nil

	case "list", "ls":
		fs := flag.NewFlagSet("heartbeat list", flag.ContinueOnError)
		addr := fs.String("addr", defaultListenAddr(), "daemon address")
		asJSON := fs.Bool("json", false, "output JSON")
		if err := fs.Parse(rest); err != nil {
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
			"type":      "schedule/list",
			"requestId": "req_hb_list",
		}); err != nil {
			return err
		}
		payload, err := waitSessionResp(ctx, ws, "schedule/list/response", "")
		if err != nil {
			return err
		}
		if *asJSON {
			b, _ := json.MarshalIndent(payload["schedules"], "", "  ")
			fmt.Fprintln(stdout, string(b))
			return nil
		}
		schedules, _ := payload["schedules"].([]any)
		for _, raw := range schedules {
			s, _ := raw.(map[string]any)
			fmt.Fprintf(stdout, "%v\t%v\t%v\n", s["id"], s["status"], s["prompt"])
		}
		return nil

	case "delete", "rm":
		fs := flag.NewFlagSet("heartbeat delete", flag.ContinueOnError)
		addr := fs.String("addr", defaultListenAddr(), "daemon address")
		if err := fs.Parse(rest); err != nil {
			return err
		}
		if fs.NArg() < 1 {
			return errors.New("usage: byspace heartbeat delete [options] <schedule-id>")
		}
		schedID := fs.Arg(0)

		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		ws, err := dialDaemonWS(ctx, *addr)
		if err != nil {
			return err
		}
		defer ws.CloseNow()

		if err := sendSessionReq(ctx, ws, map[string]any{
			"type":       "schedule/delete",
			"requestId":  "req_hb_del",
			"scheduleId": schedID,
		}); err != nil {
			return err
		}
		_, err = waitSessionResp(ctx, ws, "schedule/delete/response", "")
		if err != nil {
			return err
		}
		fmt.Fprintf(stdout, "deleted %s\n", schedID)
		return nil

	case "update":
		// Without this a schedule's prompt or cadence could only be changed by deleting and
		// recreating it, which loses its run history.
		fs := flag.NewFlagSet("schedule update", flag.ContinueOnError)
		addr := fs.String("addr", defaultListenAddr(), "daemon address")
		cronExpr := fs.String("cron", "", "cron expression")
		every := fs.String("every", "", "interval: 90s / 15m / 2h / 1d, or a bare number of minutes")
		name := fs.String("name", "", "schedule name")
		maxRuns := fs.Int("max-runs", 0, "maximum number of runs (0 = unlimited)")
		noMaxRuns := fs.Bool("no-max-runs", false, "clear the run limit")
		expiresIn := fs.String("expires-in", "", "stop scheduling after this duration (e.g. 7d)")
		noExpiresIn := fs.Bool("no-expires-in", false, "clear the expiry")
		asJSON := fs.Bool("json", false, "output JSON")
		if err := fs.Parse(rest); err != nil {
			return err
		}
		if fs.NArg() < 1 {
			return errors.New("usage: byspace schedule update <schedule-id> [flags]")
		}
		scheduleID := fs.Arg(0)
		payload := map[string]any{}
		if prompt := strings.TrimSpace(strings.Join(fs.Args()[1:], " ")); prompt != "" {
			payload["prompt"] = prompt
		}
		if *cronExpr != "" {
			payload["cadence"] = map[string]any{"type": "cron", "expression": *cronExpr}
		} else if strings.TrimSpace(*every) != "" {
			// The same conversion `heartbeat create` uses, so the two commands disagree about
			// nothing.
			interval, intervalErr := duration.ParseDuration(*every)
			if intervalErr != nil {
				return intervalErr
			}
			if _, cronErr := duration.EveryMsToFiveFieldCron(interval.Milliseconds()); cronErr != nil {
				return fmt.Errorf("%s: %w; use --cron for calendar schedules", *every, cronErr)
			}
			payload["cadence"] = map[string]any{"type": "every", "everyMs": interval.Milliseconds()}
		}
		if *name != "" {
			payload["name"] = *name
		}
		if *noMaxRuns {
			// An explicit null is how the patch says "remove the limit"; omitting the key would
			// leave the old value in place.
			payload["maxRuns"] = nil
		} else if *maxRuns > 0 {
			payload["maxRuns"] = *maxRuns
		}
		switch {
		case *noExpiresIn:
			payload["expiresAt"] = nil
		case strings.TrimSpace(*expiresIn) != "":
			duration, durationErr := duration.ParseDuration(*expiresIn)
			if durationErr != nil {
				return durationErr
			}
			payload["expiresAt"] = time.Now().UTC().Add(duration).Format(time.RFC3339)
		}

		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		ws, err := dialDaemonWS(ctx, *addr)
		if err != nil {
			return err
		}
		defer ws.CloseNow()
		if err := sendSessionReq(ctx, ws, map[string]any{
			"type": "schedule/update", "requestId": "cli_schedule_update",
			"scheduleId": scheduleID, "patch": payload,
		}); err != nil {
			return err
		}
		resp, err := waitSessionResp(ctx, ws, "schedule/update/response", "")
		if err != nil {
			return err
		}
		if *asJSON {
			return writeJSON(stdout, resp)
		}
		fmt.Fprintf(stdout, "updated %s\n", scheduleID)
		return nil

	case "inspect", "logs", "pause", "resume", "run-once":
		fs := flag.NewFlagSet("schedule "+sub, flag.ContinueOnError)
		addr := fs.String("addr", defaultListenAddr(), "daemon address")
		if err := fs.Parse(rest); err != nil {
			return err
		}
		if fs.NArg() < 1 {
			return fmt.Errorf("usage: byspace schedule %s <schedule-id>", sub)
		}
		schedID := fs.Arg(0)

		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		ws, err := dialDaemonWS(ctx, *addr)
		if err != nil {
			return err
		}
		defer ws.CloseNow()

		reqType := "schedule/" + sub
		respType := reqType + "/response"
		if err := sendSessionReq(ctx, ws, map[string]any{
			"type":       reqType,
			"requestId":  "req_hb_" + sub,
			"scheduleId": schedID,
		}); err != nil {
			return err
		}
		resp, err := waitSessionResp(ctx, ws, respType, "")
		if err != nil {
			return err
		}
		b, _ := json.MarshalIndent(resp, "", "  ")
		fmt.Fprintln(stdout, string(b))
		return nil

	default:
		return fmt.Errorf("unknown heartbeat subcommand %q", sub)
	}
}

func runWorktreeCmd(args []string, stdout io.Writer) error {
	if len(args) == 0 {
		return errors.New("usage: byspace worktree <create|list> [options]")
	}
	sub := args[0]
	rest := args[1:]

	switch sub {
	case "create":
		fs := flag.NewFlagSet("worktree create", flag.ContinueOnError)
		addr := fs.String("addr", defaultListenAddr(), "daemon address")
		cwd := fs.String("cwd", "", "repository directory")
		baseRef := fs.String("base", "", "base git ref")
		if err := fs.Parse(rest); err != nil {
			return err
		}
		if fs.NArg() < 1 {
			return errors.New("usage: byspace worktree create [options] <slug>")
		}
		slug := fs.Arg(0)
		workCwd := strings.TrimSpace(*cwd)
		if workCwd == "" {
			workCwd, _ = os.Getwd()
		}

		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		ws, err := dialDaemonWS(ctx, *addr)
		if err != nil {
			return err
		}
		defer ws.CloseNow()

		if err := sendSessionReq(ctx, ws, map[string]any{
			"type":         "create_byspace_worktree_request",
			"requestId":    "req_wt_create",
			"cwd":          workCwd,
			"worktreeSlug": slug,
			"refName":      *baseRef,
		}); err != nil {
			return err
		}
		payload, err := waitSessionResp(ctx, ws, "create_byspace_worktree_response", "")
		if err != nil {
			return err
		}
		if errStr, _ := payload["error"].(string); errStr != "" {
			return errors.New(errStr)
		}
		wsObj, _ := payload["workspace"].(map[string]any)
		fmt.Fprintf(stdout, "%v\t%v\n", wsObj["id"], wsObj["workspaceDirectory"])
		return nil

	case "list", "ls":
		fs := flag.NewFlagSet("worktree list", flag.ContinueOnError)
		addr := fs.String("addr", defaultListenAddr(), "daemon address")
		cwd := fs.String("cwd", "", "repository directory")
		if err := fs.Parse(rest); err != nil {
			return err
		}
		workCwd := strings.TrimSpace(*cwd)
		if workCwd == "" {
			workCwd, _ = os.Getwd()
		}

		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		ws, err := dialDaemonWS(ctx, *addr)
		if err != nil {
			return err
		}
		defer ws.CloseNow()

		if err := sendSessionReq(ctx, ws, map[string]any{
			"type":      "byspace_worktree_list_request",
			"requestId": "req_wt_list",
			"cwd":       workCwd,
		}); err != nil {
			return err
		}
		payload, err := waitSessionResp(ctx, ws, "byspace_worktree_list_response", "")
		if err != nil {
			return err
		}
		wts, _ := payload["worktrees"].([]any)
		for _, raw := range wts {
			w, _ := raw.(map[string]any)
			fmt.Fprintf(stdout, "%v\t%v\n", w["branch"], w["worktreePath"])
		}
		return nil

	default:
		return fmt.Errorf("unknown worktree subcommand %q", sub)
	}
}

func runPairCmd(version string, args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("pair", flag.ContinueOnError)
	homeDir := fs.String("home", "", "byspace home directory")
	relayEndpoint := fs.String("relay", os.Getenv("BYSPACE_RELAY_ENDPOINT"), "relay host:port")
	useTLS := fs.Bool("tls", true, "use TLS for relay")
	appURL := fs.String("app-url", os.Getenv("BYSPACE_APP_BASE_URL"), "web app base URL")
	showQR := fs.Bool("qr", false, "render ASCII QR code in terminal")
	if err := fs.Parse(args); err != nil {
		return err
	}

	srv, err := server.New(server.Options{
		HomeDir: *homeDir,
		Version: version,
	})
	if err != nil {
		return err
	}
	defer srv.Close()

	url := srv.BuildPairingOfferURL(*relayEndpoint, *useTLS, *appURL)
	if *showQR {
		qr, qrErr := server.RenderASCIIQRCode(url)
		if qrErr != nil {
			return qrErr
		}
		fmt.Fprintln(stdout, qr)
	}
	fmt.Fprintln(stdout, url)
	return nil
}
