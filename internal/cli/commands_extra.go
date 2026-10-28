package cli

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	duration "github.com/ByteTrue/byspace/internal/cadence"
	"github.com/ByteTrue/byspace/internal/home"
	"github.com/ByteTrue/byspace/internal/server"
	"github.com/ByteTrue/byspace/internal/store"
	"golang.org/x/term"
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
		addr := fs.String("addr", "", "daemon address (default "+defaultListenAddr()+")")
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
		addr := fs.String("addr", "", "daemon address (default "+defaultListenAddr()+")")
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
		addr := fs.String("addr", "", "daemon address (default "+defaultListenAddr()+")")
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
		addr := fs.String("addr", "", "daemon address (default "+defaultListenAddr()+")")
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
		addr := fs.String("addr", "", "daemon address (default "+defaultListenAddr()+")")
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
		return errors.New("usage: byspace worktree <create|list|archive> [options]")
	}
	sub := args[0]
	rest := args[1:]

	switch sub {
	case "create":
		fs := flag.NewFlagSet("worktree create", flag.ContinueOnError)
		addr := fs.String("addr", "", "daemon address (default "+defaultListenAddr()+")")
		cwd := fs.String("cwd", "", "repository directory")
		mode := fs.String("mode", "", "branch-off | checkout-branch | checkout-pr")
		newBranch := fs.String("new-branch", "", "branch to create (branch-off)")
		baseRef := fs.String("base", "", "base git ref (branch-off)")
		branch := fs.String("branch", "", "existing branch to check out (checkout-branch)")
		prNumber := fs.String("pr", "", "pull request number to check out (checkout-pr)")
		fs.StringVar(prNumber, "pr-number", "", "alias for --pr")
		if err := fs.Parse(rest); err != nil {
			return err
		}
		slug := ""
		if fs.NArg() > 0 {
			slug = fs.Arg(0)
		}
		workCwd := strings.TrimSpace(*cwd)
		if workCwd == "" {
			workCwd, _ = os.Getwd()
		}
		request, buildErr := buildWorktreeCreateRequest(worktreeCreateOptions{
			Mode:      *mode,
			Slug:      slug,
			NewBranch: *newBranch,
			Base:      *baseRef,
			Branch:    *branch,
			PRNumber:  *prNumber,
		}, workCwd)
		if buildErr != nil {
			return buildErr
		}

		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		ws, err := dialDaemonWS(ctx, *addr)
		if err != nil {
			return err
		}
		defer ws.CloseNow()

		request["type"] = "create_byspace_worktree_request"
		request["requestId"] = "req_wt_create"
		if err := sendSessionReq(ctx, ws, request); err != nil {
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
		addr := fs.String("addr", "", "daemon address (default "+defaultListenAddr()+")")
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

	case "archive":
		return runWorktreeArchive(rest, stdout)

	default:
		return fmt.Errorf("unknown worktree subcommand %q", sub)
	}
}

// runWorktreeArchive archives a worktree by directory name or branch.
//
// The daemon's archive RPC takes a path, but a person knows the worktree by its branch or its
// directory name — so the name is resolved against the worktree list first, exactly the way the
// node CLI did. Archiving by a guessed path would either do nothing (a stale path, a silent ok) or
// hit the wrong worktree.
func runWorktreeArchive(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("worktree archive", flag.ContinueOnError)
	addr := fs.String("addr", "", "daemon address (default "+defaultListenAddr()+")")
	cwd := fs.String("cwd", "", "repository directory")
	if err := fs.Parse(args); err != nil {
		return err
	}
	name := ""
	if fs.NArg() > 0 {
		name = strings.TrimSpace(fs.Arg(0))
	}
	if name == "" {
		return errors.New("usage: byspace worktree archive <name|branch> [--cwd <repo>]")
	}
	workCwd := strings.TrimSpace(*cwd)
	if workCwd == "" {
		workCwd, _ = os.Getwd()
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	ws, err := dialDaemonWS(ctx, *addr)
	if err != nil {
		return err
	}
	defer ws.CloseNow()

	if err := sendSessionReq(ctx, ws, map[string]any{
		"type":      "byspace_worktree_list_request",
		"requestId": "req_wt_archive_list",
		"cwd":       workCwd,
	}); err != nil {
		return err
	}
	list, err := waitSessionResp(ctx, ws, "byspace_worktree_list_response", "")
	if err != nil {
		return err
	}
	entries, _ := list["worktrees"].([]any)
	matchPath := ""
	matchBranch := ""
	for _, raw := range entries {
		entry, _ := raw.(map[string]any)
		path, _ := entry["worktreePath"].(string)
		branch, _ := entry["branch"].(string)
		// The name a person types is either the last path component or the branch; both identify
		// exactly one worktree in this repository.
		if path == name || filepath.Base(path) == name || branch == name {
			matchPath = path
			matchBranch = branch
			break
		}
	}
	if matchPath == "" {
		return fmt.Errorf("no worktree named %q in %s", name, workCwd)
	}

	if err := sendSessionReq(ctx, ws, map[string]any{
		"type":         "byspace_worktree_archive_request",
		"requestId":    "req_wt_archive",
		"worktreePath": matchPath,
		"scope":        "worktree",
		"repoRoot":     workCwd,
		"branchName":   matchBranch,
	}); err != nil {
		return err
	}
	payload, err := waitSessionResp(ctx, ws, "byspace_worktree_archive_response", "")
	if err != nil {
		return err
	}
	if errStr, _ := payload["error"].(string); errStr != "" {
		return errors.New(errStr)
	}
	name2 := filepath.Base(matchPath)
	fmt.Fprintf(stdout, "%s\tarchived\n", name2)
	return nil
}

func runPairCmd(version string, args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("pair", flag.ContinueOnError)
	homeDir := fs.String("home", "", "byspace home directory")
	addr := fs.String("addr", "", "daemon address (default "+defaultListenAddr()+"); empty mints the offer offline")
	relayEndpoint := fs.String("relay", os.Getenv("BYSPACE_RELAY_ENDPOINT"), "relay host:port")
	useTLS := fs.Bool("tls", true, "use TLS for relay")
	appURL := fs.String("app-url", os.Getenv("BYSPACE_APP_BASE_URL"), "web app base URL")
	noQR := fs.Bool("no-qr", false, "skip the QR code and print only the link")
	if err := fs.Parse(args); err != nil {
		return err
	}

	url, err := pairingOfferURL(version, *homeDir, *addr)
	if err != nil {
		return err
	}
	if *relayEndpoint != "" || *appURL != "" || !*useTLS {
		// An explicit flag means the operator wants those values, not whatever the daemon has.
		url = buildOfflinePairingOffer(version, *homeDir, *relayEndpoint, *useTLS, *appURL)
	}
	// The QR code is the default, not an opt-in.
	//
	// The reference CLI always printed one — `formatPairingInstructions` renders "Scan to pair"
	// unconditionally — because pairing with a phone means scanning. Requiring a flag meant the
	// common case, running `byspace pair` and picking up the phone, printed nothing to scan.
	//
	// Its absence is explained rather than silent: a narrow terminal cannot fit the symbol, and a
	// link without that explanation looks like the feature is missing.
	if !*noQR {
		switch qr, reason := renderPairingQRCode(url, stdout); {
		case qr != "":
			fmt.Fprintln(stdout, qr)
		case reason != "":
			fmt.Fprintln(stdout, reason)
		}
	}
	fmt.Fprintln(stdout, url)
	return nil
}

// renderPairingQRCode renders the offer as a terminal QR code.
//
// Returns either the rendering or a one-line explanation of why it was skipped, so the caller can
// print the reason where the code would have been.
func renderPairingQRCode(url string, stdout io.Writer) (string, string) {
	qr, err := server.RenderASCIIQRCode(url)
	if err != nil {
		return "", "QR code unavailable; use the pairing link below."
	}
	if !term.IsTerminal(int(os.Stdout.Fd())) {
		// Piped output, a CI log, a script. Printing the code there would fill the log with block
		// characters nobody can scan.
		return "", ""
	}
	// Only skip when the width is known to be too small. A terminal can report zero columns — a
	// pty without a winsize does — and treating that as "too narrow" hid the code on terminals
	// that could have shown it.
	columns, _, sizeErr := term.GetSize(int(os.Stdout.Fd()))
	if sizeErr == nil && columns > 0 {
		if width := widestLine(qr); columns <= width {
			return "", fmt.Sprintf("QR code not shown: the terminal is %d columns, it needs %d. Resize and rerun, or use the link below.", columns, width+1)
		}
	}
	_ = stdout
	return qr, ""
}

// widestLine is the visible width of a block of text, in terminal columns.
func widestLine(text string) int {
	widest := 0
	for _, line := range strings.Split(text, "\n") {
		if len([]rune(line)) > widest {
			widest = len([]rune(line))
		}
	}
	return widest
}

// pairingOfferURL asks the running daemon for its pairing offer.
//
// The daemon is the only party that knows how the relay is actually configured: which public
// endpoint clients should dial, whether it is behind TLS, and which app origin this build belongs
// to. Minting the offer in-process uses the defaults instead, so an operator who pointed the relay
// at their own host got a link to the hosted relay.
func pairingOfferURL(version, homeDir, addr string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	ws, err := dialDaemonWS(ctx, addr)
	if err != nil {
		// No daemon running: fall back to the offline offer rather than failing. `pair` is also
		// how people mint a link before starting the daemon.
		return buildOfflinePairingOffer(version, homeDir, "", true, ""), nil
	}
	defer ws.CloseNow()

	if err := sendSessionReq(ctx, ws, map[string]any{
		"type":      "daemon.get_pairing_offer.request",
		"requestId": "req_pair",
	}); err != nil {
		return "", err
	}
	payload, err := waitSessionResp(ctx, ws, "daemon.get_pairing_offer.response", "")
	if err != nil {
		return "", err
	}
	url, _ := payload["url"].(string)
	if strings.TrimSpace(url) == "" {
		// The daemon only answers with a url when its relay is on, and a daemon that has never
		// been configured reads as off — node defaults the relay to enabled, so this is the
		// common case on a fresh home. `pair` is a manual command: someone who runs it wants a
		// link, so mint one from the defaults rather than making them configure the relay first.
		return buildOfflinePairingOffer(version, homeDir, "", true, ""), nil
	}
	return url, nil
}

// buildOfflinePairingOffer mints an offer without asking a daemon.
//
// It reads the home's own config first. Minting purely from the version sent an operator whose home
// names `app.baseUrl: https://app.byspace.cc.cd` a link to the prerelease app, because the fallback
// derived the origin from "this build's version has a hyphen" — the offer pointed at a different
// deployment than the daemon's owner had configured and was using.
func buildOfflinePairingOffer(version, homeDir, relayEndpoint string, useTLS bool, appURL string) string {
	// Resolve first. `--home` unset means the default home, and an empty string would read no config
	// at all — the offer then fell back to the version-derived origin even though the home it was
	// minted for names one.
	resolvedHome := homeDir
	if resolved, err := home.Resolve(homeDir); err == nil {
		resolvedHome = resolved
	}
	srv, err := server.New(server.Options{
		HomeDir: resolvedHome,
		Version: version,
	})
	if err != nil {
		return ""
	}
	defer srv.Close()
	cfg := store.New(resolvedHome).LoadDaemonConfig()
	if strings.TrimSpace(appURL) == "" {
		appURL = server.StoredAppBaseURL(cfg)
	}
	if strings.TrimSpace(relayEndpoint) == "" {
		if relay := server.ResolveRelayConfig(cfg); relay.Enabled {
			relayEndpoint = relay.ClientRelayEndpoint()
			useTLS = relay.ClientRelayUseTLS()
		}
	}
	return srv.BuildPairingOfferURL(relayEndpoint, useTLS, appURL)
}
