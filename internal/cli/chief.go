package cli

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
)

const chiefUsageText = `byspace chief — manage Chief Secretary missions and verification threads

Usage:
  byspace chief mission <list|get|create|upgrade|resolve-decision> [options]
  byspace chief thread <create|submit|verdict|merge-check|land|cancel> [options]
  byspace chief agent <hotswap> [options]

Mission subcommands:
  mission list (ls)              list missions
  mission get (inspect) <id>     get a mission snapshot (and optional events)
  mission create [options] <goal>
                                 create a mission
  mission upgrade [<id>]         upgrade tier (L0 -> L1/L2)
  mission resolve-decision [<id>] [<option>]
                                 resolve a mission's pending human decision

Thread subcommands:
  thread create [options]        create a thread inside a mission
  thread submit [<thread-id>]    submit author work for verification
  thread verdict [<thread-id>]   record verifier --pass or --reject verdict
  thread merge-check [<thread-id>]
                                 dry-run landing and report conflicts
  thread land [<thread-id>]      land locally, or request human approval
  thread cancel [<thread-id>]    cancel a thread without deleting its work

Agent subcommands:
  agent hotswap [<agent-id>]     replace an agent's profile and preserve its work

Common flags:
  --addr <host:port>             daemon address (default BYSPACE_HOST or local daemon)
  --json                         output JSON
  --caller <agent-id>            caller agent ID (default $BYSPACE_AGENT_ID)
`

const (
	chiefReadTimeout    = 15 * time.Second
	chiefWriteTimeout   = 45 * time.Second
	chiefLandTimeout    = 2 * time.Minute
	chiefHotswapTimeout = 3 * time.Minute
)

var dialChiefWS = dialDaemonWS

var validChiefMissionStatuses = map[string]bool{
	"active":        true,
	"waiting_human": true,
	"completed":     true,
	"failed":        true,
	"canceled":      true,
}

var validChiefTiers = map[string]bool{
	"L0": true,
	"L1": true,
	"L2": true,
}

var validChiefDirtyPolicies = map[string]bool{
	"fail_if_dirty":       true,
	"carry_into_thread_1": true,
}

var validChiefIsolations = map[string]bool{
	"none":     true,
	"worktree": true,
}

var validChiefLandingStrategies = map[string]bool{
	"merge":  true,
	"squash": true,
	"rebase": true,
}

func runChiefCmd(args []string, stdout io.Writer) error {
	if len(args) == 0 {
		fmt.Fprint(stdout, chiefUsageText)
		return nil
	}
	group := args[0]
	rest := args[1:]
	switch group {
	case "-h", "--help", "help":
		fmt.Fprint(stdout, chiefUsageText)
		return nil
	case "mission":
		return runChiefMissionCmd(rest, stdout)
	case "thread":
		return runChiefThreadCmd(rest, stdout)
	case "agent":
		return runChiefAgentCmd(rest, stdout)
	default:
		return fmt.Errorf("unknown chief subcommand %q\n\n%s", group, chiefUsageText)
	}
}

func runChiefMissionCmd(args []string, stdout io.Writer) error {
	const missionUsage = "usage: byspace chief mission <list|get|create|upgrade|resolve-decision> [options]"
	if len(args) == 0 {
		return errors.New(missionUsage)
	}
	sub := args[0]
	rest := args[1:]
	switch sub {
	case "-h", "--help", "help":
		fmt.Fprintln(stdout, missionUsage)
		return nil
	case "list", "ls":
		return runChiefMissionList(rest, stdout)
	case "get", "inspect":
		return runChiefMissionGet(rest, stdout)
	case "create":
		return runChiefMissionCreate(rest, stdout)
	case "upgrade":
		return runChiefMissionUpgrade(rest, stdout)
	case "resolve-decision", "resolve":
		return runChiefMissionResolveDecision(rest, stdout)
	default:
		return fmt.Errorf("unknown chief mission subcommand %q (%s)", sub, missionUsage)
	}
}

func runChiefThreadCmd(args []string, stdout io.Writer) error {
	const threadUsage = "usage: byspace chief thread <create|submit|verdict|merge-check|land|cancel> [options]"
	if len(args) == 0 {
		return errors.New(threadUsage)
	}
	sub := args[0]
	rest := args[1:]
	switch sub {
	case "-h", "--help", "help":
		fmt.Fprintln(stdout, threadUsage)
		return nil
	case "create":
		return runChiefThreadCreate(rest, stdout)
	case "submit":
		return runChiefThreadSubmit(rest, stdout)
	case "verdict":
		return runChiefThreadVerdict(rest, stdout)
	case "merge-check":
		return runChiefThreadMergeCheck(rest, stdout)
	case "land":
		return runChiefThreadLand(rest, stdout)
	case "cancel":
		return runChiefThreadCancel(rest, stdout)
	default:
		return fmt.Errorf("unknown chief thread subcommand %q (%s)", sub, threadUsage)
	}
}

func runChiefAgentCmd(args []string, stdout io.Writer) error {
	const agentUsage = "usage: byspace chief agent <hotswap> [options]"
	if len(args) == 0 {
		return errors.New(agentUsage)
	}
	sub := args[0]
	rest := args[1:]
	switch sub {
	case "-h", "--help", "help":
		fmt.Fprintln(stdout, agentUsage)
		return nil
	case "hotswap":
		return runChiefAgentHotswap(rest, stdout)
	default:
		return fmt.Errorf("unknown chief agent subcommand %q (%s)", sub, agentUsage)
	}
}

func runChiefMissionList(args []string, stdout io.Writer) error {
	const usage = "usage: byspace chief mission list [--chief <id>] [--project <id>] [--workspace <id>] [--status <status>] [--include-completed|-a] [--addr <host:port>] [--json]"
	fs := flag.NewFlagSet("chief mission list", flag.ContinueOnError)
	addr := fs.String("addr", "", "daemon address")
	asJSON := fs.Bool("json", false, "output JSON")
	chiefID := fs.String("chief", "", "filter by chief agent ID")
	fs.StringVar(chiefID, "chief-agent-id", "", "filter by chief agent ID")
	projectID := fs.String("project", "", "filter by project ID")
	workspaceID := fs.String("workspace", "", "filter by base workspace ID")
	var statuses multiFlag
	fs.Var(&statuses, "status", "filter by mission status (repeatable or comma-separated)")
	includeCompleted := fs.Bool("include-completed", false, "include completed/failed/canceled missions")
	fs.BoolVar(includeCompleted, "all", false, "include completed/failed/canceled missions")
	fs.BoolVar(includeCompleted, "a", false, "include completed/failed/canceled missions")

	if err := parseInterspersedChiefFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			fmt.Fprintln(stdout, usage)
			return nil
		}
		return err
	}

	parsedStatuses := parseCommaSeparatedList(statuses)
	for _, st := range parsedStatuses {
		if !validChiefMissionStatuses[st] {
			return fmt.Errorf("invalid --status %q: expected active, waiting_human, completed, failed, or canceled", st)
		}
	}

	req := map[string]any{
		"type":      "chief.mission.list.request",
		"requestId": "cli_chief_mission_list",
	}
	if v := strings.TrimSpace(*chiefID); v != "" {
		req["chiefAgentId"] = v
	}
	if v := strings.TrimSpace(*projectID); v != "" {
		req["projectId"] = v
	}
	if v := strings.TrimSpace(*workspaceID); v != "" {
		req["baseWorkspaceId"] = v
	}
	if len(parsedStatuses) > 0 {
		req["statuses"] = parsedStatuses
	}
	if flagWasSet(fs, "include-completed") || flagWasSet(fs, "all") || flagWasSet(fs, "a") {
		req["includeCompleted"] = *includeCompleted
	}

	resp, err := doChiefRPC(*addr, chiefReadTimeout, req, "chief.mission.list.response")
	if err != nil {
		return err
	}
	if errMsg, _ := resp["error"].(string); strings.TrimSpace(errMsg) != "" {
		return errors.New(errMsg)
	}

	missions, _ := resp["missions"].([]any)
	if missions == nil {
		missions = []any{}
	}
	if *asJSON {
		return writeJSON(stdout, missions)
	}
	return renderMissionList(stdout, missions)
}

func runChiefMissionGet(args []string, stdout io.Writer) error {
	const usage = "usage: byspace chief mission get [--events] [--events-limit <1..500>] [--after-seq <n>] [--addr <host:port>] [--json] <mission-id>"
	fs := flag.NewFlagSet("chief mission get", flag.ContinueOnError)
	addr := fs.String("addr", "", "daemon address")
	asJSON := fs.Bool("json", false, "output JSON")
	missionIDFlag := fs.String("mission", "", "mission ID")
	includeEvents := fs.Bool("include-events", false, "include mission events")
	fs.BoolVar(includeEvents, "events", false, "include mission events")
	eventsLimit := fs.Int("events-limit", 0, "maximum number of events (1..500)")
	afterSeq := fs.Int("after-seq", 0, "return events after this sequence number")

	if err := parseInterspersedChiefFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			fmt.Fprintln(stdout, usage)
			return nil
		}
		return err
	}

	missionID := strings.TrimSpace(*missionIDFlag)
	if missionID == "" && fs.NArg() > 0 {
		missionID = strings.TrimSpace(fs.Arg(0))
	}
	if missionID == "" {
		return errors.New(usage)
	}
	if flagWasSet(fs, "events-limit") && (*eventsLimit < 1 || *eventsLimit > 500) {
		return fmt.Errorf("--events-limit must be between 1 and 500, got %d", *eventsLimit)
	}
	if flagWasSet(fs, "after-seq") && *afterSeq < 0 {
		return fmt.Errorf("--after-seq must be >= 0, got %d", *afterSeq)
	}

	req := map[string]any{
		"type":      "chief.mission.get.request",
		"requestId": "cli_chief_mission_get",
		"missionId": missionID,
	}
	wantEvents := *includeEvents
	if !flagWasSet(fs, "include-events") && !flagWasSet(fs, "events") && (*eventsLimit > 0 || flagWasSet(fs, "after-seq")) {
		wantEvents = true
	}
	if wantEvents || flagWasSet(fs, "include-events") || flagWasSet(fs, "events") {
		req["includeEvents"] = wantEvents
	}
	if *eventsLimit > 0 {
		req["eventsLimit"] = *eventsLimit
	}
	if flagWasSet(fs, "after-seq") {
		req["afterSeq"] = *afterSeq
	}

	resp, err := doChiefRPC(*addr, chiefReadTimeout, req, "chief.mission.get.response")
	if err != nil {
		return err
	}
	if errMsg, _ := resp["error"].(string); strings.TrimSpace(errMsg) != "" {
		if *asJSON {
			_ = writeJSON(stdout, cleanChiefPayload(resp))
		}
		return errors.New(errMsg)
	}
	mission, _ := resp["mission"].(map[string]any)
	if mission == nil {
		if *asJSON {
			_ = writeJSON(stdout, cleanChiefPayload(resp))
		}
		return fmt.Errorf("mission %q not found", missionID)
	}
	if *asJSON {
		return writeJSON(stdout, cleanChiefPayload(resp))
	}
	events, _ := resp["events"].([]any)
	return renderMissionDetail(stdout, mission, events)
}

func runChiefMissionCreate(args []string, stdout io.Writer) error {
	const usage = "usage: byspace chief mission create [--title <title>] [--tier <L0|L1|L2>] [--chief <id>] [--project <id>] [--workspace <id>] [--cwd <dir>] [--base-branch <branch>] [--addr <host:port>] [--json] --goal <text> | <goal>"
	fs := flag.NewFlagSet("chief mission create", flag.ContinueOnError)
	addr := fs.String("addr", "", "daemon address")
	asJSON := fs.Bool("json", false, "output JSON")
	goalFlag := fs.String("goal", "", "mission goal")
	title := fs.String("title", "", "mission title")
	tierFlag := fs.String("tier", "", "mission tier (L0 | L1 | L2)")
	chiefID := fs.String("chief", "", "existing chief agent ID")
	fs.StringVar(chiefID, "chief-agent-id", "", "existing chief agent ID")
	callerFlag := fs.String("caller", "", "caller agent ID (defaults to $BYSPACE_AGENT_ID)")
	projectID := fs.String("project", "", "project ID")
	workspaceID := fs.String("workspace", "", "base workspace ID")
	cwdFlag := fs.String("cwd", "", "base working directory")
	baseBranch := fs.String("base-branch", "", "base git branch")
	fs.StringVar(baseBranch, "base", "", "base git branch")

	if err := parseInterspersedChiefFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			fmt.Fprintln(stdout, usage)
			return nil
		}
		return err
	}

	goal := strings.TrimSpace(*goalFlag)
	if goal == "" {
		goal = strings.TrimSpace(strings.Join(fs.Args(), " "))
	}
	if goal == "" {
		return errors.New(usage)
	}

	tier, err := normalizeChiefTier(*tierFlag)
	if err != nil {
		return err
	}

	req := map[string]any{
		"type":      "chief.mission.create.request",
		"requestId": "cli_chief_mission_create",
		"goal":      goal,
	}
	if v := strings.TrimSpace(*title); v != "" {
		req["title"] = v
	}
	if tier != "" {
		req["tier"] = tier
	}
	if v := strings.TrimSpace(*chiefID); v != "" {
		req["chiefAgentId"] = v
	}
	if caller := resolveCallerAgentID(*callerFlag); caller != "" {
		req["callerAgentId"] = caller
	}
	if v := strings.TrimSpace(*projectID); v != "" {
		req["projectId"] = v
	}
	if v := strings.TrimSpace(*workspaceID); v != "" {
		req["baseWorkspaceId"] = v
	}
	baseCwd := strings.TrimSpace(*cwdFlag)
	if baseCwd == "" && strings.TrimSpace(*workspaceID) == "" && strings.TrimSpace(*projectID) == "" {
		baseCwd, _ = os.Getwd()
	}
	if baseCwd != "" {
		req["baseCwd"] = baseCwd
	}
	if v := strings.TrimSpace(*baseBranch); v != "" {
		req["baseBranch"] = v
	}

	resp, err := doChiefRPC(*addr, chiefWriteTimeout, req, "chief.mission.create.response")
	if err != nil {
		return err
	}
	if errMsg, _ := resp["error"].(string); strings.TrimSpace(errMsg) != "" {
		if *asJSON {
			_ = writeJSON(stdout, cleanChiefPayload(resp))
		}
		return errors.New(errMsg)
	}
	if *asJSON {
		return writeJSON(stdout, cleanChiefPayload(resp))
	}
	mission, _ := resp["mission"].(map[string]any)
	fmt.Fprintf(stdout, "created mission %s (tier=%s, status=%s)\n",
		stringField(mission, "id"),
		stringField(mission, "tier"),
		stringField(mission, "status"),
	)
	return nil
}

func runChiefMissionUpgrade(args []string, stdout io.Writer) error {
	const usage = "usage: byspace chief mission upgrade [--mission <id>] [--solo-agent <id>] --tier <L0|L1|L2> [--dirty-policy <fail_if_dirty|carry_into_thread_1>] [--title <text>] [--goal <text>] [--acceptance <item>]... [--own <path>]... [--author-profile <id>] [--verifier-profile <id>] [--addr <host:port>] [--json] [<mission-id>]"
	fs := flag.NewFlagSet("chief mission upgrade", flag.ContinueOnError)
	addr := fs.String("addr", "", "daemon address")
	asJSON := fs.Bool("json", false, "output JSON")
	missionIDFlag := fs.String("mission", "", "mission ID")
	soloAgentID := fs.String("solo-agent", "", "solo agent ID to promote into a mission")
	fs.StringVar(soloAgentID, "solo-agent-id", "", "solo agent ID to promote into a mission")
	callerFlag := fs.String("caller", "", "caller agent ID (defaults to $BYSPACE_AGENT_ID)")
	tierFlag := fs.String("tier", "", "target tier (L0 | L1 | L2)")
	fs.StringVar(tierFlag, "target-tier", "", "target tier (L0 | L1 | L2)")
	dirtyPolicy := fs.String("dirty-policy", "", "dirty checkout policy (fail_if_dirty | carry_into_thread_1)")
	title := fs.String("title", "", "mission/thread title")
	goal := fs.String("goal", "", "mission/thread goal")
	var acceptance multiFlag
	fs.Var(&acceptance, "acceptance", "acceptance criterion (repeatable)")
	var ownedPaths multiFlag
	fs.Var(&ownedPaths, "own", "owned path pattern (repeatable)")
	fs.Var(&ownedPaths, "owned-path", "owned path pattern (repeatable)")
	authorProfileID := fs.String("author-profile", "", "author profile ID")
	verifierProfileID := fs.String("verifier-profile", "", "verifier profile ID")

	if err := parseInterspersedChiefFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			fmt.Fprintln(stdout, usage)
			return nil
		}
		return err
	}

	targetTier, err := normalizeChiefTier(*tierFlag)
	if err != nil {
		return err
	}
	if targetTier == "" {
		return errors.New("--tier is required (L0, L1, or L2)")
	}
	policy := strings.TrimSpace(*dirtyPolicy)
	if policy != "" && !validChiefDirtyPolicies[policy] {
		return fmt.Errorf("invalid --dirty-policy %q: expected fail_if_dirty or carry_into_thread_1", policy)
	}

	missionID := strings.TrimSpace(*missionIDFlag)
	if missionID == "" && fs.NArg() > 0 {
		missionID = strings.TrimSpace(fs.Arg(0))
	}
	soloID := strings.TrimSpace(*soloAgentID)
	caller := resolveCallerAgentID(*callerFlag)
	if missionID == "" && soloID == "" && caller == "" {
		return errors.New("one of --mission, --solo-agent, or BYSPACE_AGENT_ID is required")
	}

	req := map[string]any{
		"type":       "chief.mission.upgrade.request",
		"requestId":  "cli_chief_mission_upgrade",
		"targetTier": targetTier,
	}
	if missionID != "" {
		req["missionId"] = missionID
	}
	if soloID != "" {
		req["soloAgentId"] = soloID
	}
	if caller != "" {
		req["callerAgentId"] = caller
	}
	if policy != "" {
		req["dirtyPolicy"] = policy
	}
	if v := strings.TrimSpace(*title); v != "" {
		req["title"] = v
	}
	if v := strings.TrimSpace(*goal); v != "" {
		req["goal"] = v
	}
	if items := trimNonEmpty(acceptance); len(items) > 0 {
		req["acceptanceCriteria"] = items
	}
	if paths := nonEmptyPaths(ownedPaths); len(paths) > 0 {
		req["ownedPaths"] = paths
	}
	if v := strings.TrimSpace(*authorProfileID); v != "" {
		req["authorProfileId"] = v
	}
	if v := strings.TrimSpace(*verifierProfileID); v != "" {
		req["verifierProfileId"] = v
	}

	resp, err := doChiefRPC(*addr, chiefWriteTimeout, req, "chief.mission.upgrade.response")
	if err != nil {
		return err
	}
	if errMsg, _ := resp["error"].(string); strings.TrimSpace(errMsg) != "" {
		if *asJSON {
			_ = writeJSON(stdout, cleanChiefPayload(resp))
		}
		return errors.New(errMsg)
	}
	if *asJSON {
		return writeJSON(stdout, cleanChiefPayload(resp))
	}
	mission, _ := resp["mission"].(map[string]any)
	createdThreadID := stringField(resp, "createdThreadId")
	if createdThreadID != "" {
		fmt.Fprintf(stdout, "upgraded mission %s to %s (status=%s, thread=%s)\n",
			stringField(mission, "id"),
			stringField(mission, "tier"),
			stringField(mission, "status"),
			createdThreadID,
		)
		return nil
	}
	fmt.Fprintf(stdout, "upgraded mission %s to %s (status=%s)\n",
		stringField(mission, "id"),
		stringField(mission, "tier"),
		stringField(mission, "status"),
	)
	return nil
}

func runChiefMissionResolveDecision(args []string, stdout io.Writer) error {
	const usage = "usage: byspace chief mission resolve-decision [--mission <id>] [--decision <id>] --option <id> [--note <text>] [--addr <host:port>] [--json] [<mission-id>] [<option-id>]"
	fs := flag.NewFlagSet("chief mission resolve-decision", flag.ContinueOnError)
	addr := fs.String("addr", "", "daemon address")
	asJSON := fs.Bool("json", false, "output JSON")
	missionIDFlag := fs.String("mission", "", "mission ID")
	decisionID := fs.String("decision", "", "decision ID")
	fs.StringVar(decisionID, "decision-id", "", "decision ID")
	optionIDFlag := fs.String("option", "", "selected option ID")
	fs.StringVar(optionIDFlag, "option-id", "", "selected option ID")
	note := fs.String("note", "", "optional resolution note")

	if err := parseInterspersedChiefFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			fmt.Fprintln(stdout, usage)
			return nil
		}
		return err
	}

	missionID := strings.TrimSpace(*missionIDFlag)
	optionID := strings.TrimSpace(*optionIDFlag)
	posIndex := 0
	if missionID == "" && posIndex < fs.NArg() {
		missionID = strings.TrimSpace(fs.Arg(posIndex))
		posIndex++
	}
	if optionID == "" && posIndex < fs.NArg() {
		optionID = strings.TrimSpace(fs.Arg(posIndex))
	}
	if missionID == "" || optionID == "" {
		return errors.New(usage)
	}

	req := map[string]any{
		"type":      "chief.mission.resolve_decision.request",
		"requestId": "cli_chief_mission_resolve_decision",
		"missionId": missionID,
		"optionId":  optionID,
	}
	if v := strings.TrimSpace(*decisionID); v != "" {
		req["decisionId"] = v
	}
	if v := strings.TrimSpace(*note); v != "" {
		req["note"] = v
	}

	resp, err := doChiefRPC(*addr, chiefReadTimeout, req, "chief.mission.resolve_decision.response")
	if err != nil {
		return err
	}
	if errMsg, _ := resp["error"].(string); strings.TrimSpace(errMsg) != "" {
		if *asJSON {
			_ = writeJSON(stdout, cleanChiefPayload(resp))
		}
		return errors.New(errMsg)
	}
	if *asJSON {
		return writeJSON(stdout, cleanChiefPayload(resp))
	}
	mission, _ := resp["mission"].(map[string]any)
	fmt.Fprintf(stdout, "resolved decision on mission %s (option=%s, status=%s)\n",
		stringField(mission, "id"),
		optionID,
		stringField(mission, "status"),
	)
	return nil
}

func runChiefThreadCreate(args []string, stdout io.Writer) error {
	const usage = "usage: byspace chief thread create --mission <id> --title <title> --goal <goal> [--acceptance <item>]... [--own <path>]... [--isolation <none|worktree>] [--base <ref>] [--branch <name>] [--author-profile <id>] [--verifier-profile <id>] [--author-agent <id>] [--prompt <text>] [--addr <host:port>] [--json]"
	fs := flag.NewFlagSet("chief thread create", flag.ContinueOnError)
	addr := fs.String("addr", "", "daemon address")
	asJSON := fs.Bool("json", false, "output JSON")
	missionIDFlag := fs.String("mission", "", "mission ID")
	callerFlag := fs.String("caller", "", "caller agent ID (defaults to $BYSPACE_AGENT_ID)")
	title := fs.String("title", "", "thread title")
	goal := fs.String("goal", "", "thread goal")
	var acceptance multiFlag
	fs.Var(&acceptance, "acceptance", "acceptance criterion (repeatable)")
	var ownedPaths multiFlag
	fs.Var(&ownedPaths, "own", "owned path pattern (repeatable)")
	fs.Var(&ownedPaths, "owned-path", "owned path pattern (repeatable)")
	isolationFlag := fs.String("isolation", "", "thread workspace isolation (none | worktree)")
	baseRef := fs.String("base", "", "base git ref")
	fs.StringVar(baseRef, "base-ref", "", "base git ref")
	branch := fs.String("branch", "", "branch name")
	authorProfileID := fs.String("author-profile", "", "author profile ID")
	verifierProfileID := fs.String("verifier-profile", "", "verifier profile ID")
	authorAgentID := fs.String("author-agent", "", "existing author agent ID")
	initialPrompt := fs.String("prompt", "", "initial prompt for author agent")
	fs.StringVar(initialPrompt, "initial-prompt", "", "initial prompt for author agent")

	if err := parseInterspersedChiefFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			fmt.Fprintln(stdout, usage)
			return nil
		}
		return err
	}

	missionID := strings.TrimSpace(*missionIDFlag)
	if missionID == "" && fs.NArg() > 0 {
		missionID = strings.TrimSpace(fs.Arg(0))
	}
	trimmedTitle := strings.TrimSpace(*title)
	trimmedGoal := strings.TrimSpace(*goal)
	if missionID == "" {
		return errors.New("--mission is required")
	}
	if trimmedTitle == "" {
		return errors.New("--title is required")
	}
	if trimmedGoal == "" {
		return errors.New("--goal is required")
	}
	isolation := strings.TrimSpace(*isolationFlag)
	if isolation != "" && !validChiefIsolations[isolation] {
		return fmt.Errorf("invalid --isolation %q: expected none or worktree", isolation)
	}

	req := map[string]any{
		"type":      "chief.thread.create.request",
		"requestId": "cli_chief_thread_create",
		"missionId": missionID,
		"title":     trimmedTitle,
		"goal":      trimmedGoal,
	}
	if caller := resolveCallerAgentID(*callerFlag); caller != "" {
		req["callerAgentId"] = caller
	}
	if items := trimNonEmpty(acceptance); len(items) > 0 {
		req["acceptanceCriteria"] = items
	}
	if paths := nonEmptyPaths(ownedPaths); len(paths) > 0 {
		req["ownedPaths"] = paths
	}
	if isolation != "" {
		req["isolation"] = isolation
	}
	if v := strings.TrimSpace(*baseRef); v != "" {
		req["baseRef"] = v
	}
	if v := strings.TrimSpace(*branch); v != "" {
		req["branch"] = v
	}
	if v := strings.TrimSpace(*authorProfileID); v != "" {
		req["authorProfileId"] = v
	}
	if v := strings.TrimSpace(*verifierProfileID); v != "" {
		req["verifierProfileId"] = v
	}
	if v := strings.TrimSpace(*authorAgentID); v != "" {
		req["authorAgentId"] = v
	}
	if v := strings.TrimSpace(*initialPrompt); v != "" {
		req["initialPrompt"] = v
	}

	resp, err := doChiefRPC(*addr, chiefWriteTimeout, req, "chief.thread.create.response")
	if err != nil {
		return err
	}
	if errMsg, _ := resp["error"].(string); strings.TrimSpace(errMsg) != "" {
		if *asJSON {
			_ = writeJSON(stdout, cleanChiefPayload(resp))
		}
		return errors.New(errMsg)
	}
	if *asJSON {
		return writeJSON(stdout, cleanChiefPayload(resp))
	}
	thread, _ := resp["thread"].(map[string]any)
	fmt.Fprintf(stdout, "created thread %s (mission=%s, status=%s, isolation=%s)\n",
		stringField(thread, "id"),
		missionID,
		stringField(thread, "status"),
		stringField(thread, "isolation"),
	)
	if promptErr, _ := resp["initialPromptError"].(string); strings.TrimSpace(promptErr) != "" {
		fmt.Fprintln(stdout, "initial prompt failed: "+promptErr)
	}
	return nil
}

func runChiefThreadSubmit(args []string, stdout io.Writer) error {
	const usage = "usage: byspace chief thread submit [--mission <id>] --summary <text> [--tests <text>] [--file <path>]... [--commit <sha>] [--addr <host:port>] [--json] <thread-id>"
	fs := flag.NewFlagSet("chief thread submit", flag.ContinueOnError)
	addr := fs.String("addr", "", "daemon address")
	asJSON := fs.Bool("json", false, "output JSON")
	threadIDFlag := fs.String("thread", "", "thread ID")
	missionID := fs.String("mission", "", "mission ID")
	callerFlag := fs.String("caller", "", "caller agent ID (defaults to $BYSPACE_AGENT_ID)")
	summaryFlag := fs.String("summary", "", "submission summary")
	notesFlag := fs.String("notes", "", "alias for --summary")
	noteFlag := fs.String("note", "", "alias for --summary")
	tests := fs.String("tests", "", "verification tests/commands run")
	var changedFiles multiFlag
	fs.Var(&changedFiles, "file", "changed file path (repeatable)")
	fs.Var(&changedFiles, "changed-file", "changed file path (repeatable)")
	commitSha := fs.String("commit", "", "commit SHA reference")
	fs.StringVar(commitSha, "commit-sha", "", "commit SHA reference")

	if err := parseInterspersedChiefFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			fmt.Fprintln(stdout, usage)
			return nil
		}
		return err
	}

	threadID, summaryPositional := resolveThreadAndPositionalText(*threadIDFlag, fs.Args())
	summary := firstNonEmpty(*summaryFlag, *notesFlag, *noteFlag, summaryPositional)
	if threadID == "" {
		return errors.New("--thread or positional <thread-id> is required")
	}
	if summary == "" {
		return errors.New("--summary is required")
	}

	req := map[string]any{
		"type":      "chief.thread.submit.request",
		"requestId": "cli_chief_thread_submit",
		"threadId":  threadID,
		"summary":   summary,
	}
	if v := strings.TrimSpace(*missionID); v != "" {
		req["missionId"] = v
	}
	if caller := resolveCallerAgentID(*callerFlag); caller != "" {
		req["callerAgentId"] = caller
	}
	if v := strings.TrimSpace(*tests); v != "" {
		req["tests"] = v
	}
	if files := parseCommaSeparatedList(changedFiles); len(files) > 0 {
		req["changedFiles"] = files
	}
	if v := strings.TrimSpace(*commitSha); v != "" {
		req["commitSha"] = v
	}

	resp, err := doChiefRPC(*addr, chiefWriteTimeout, req, "chief.thread.submit.response")
	if err != nil {
		return err
	}

	accepted, _ := resp["accepted"].(bool)
	errMsg, _ := resp["error"].(string)
	violations := asStringSlice(resp["ownershipViolations"])

	if *asJSON {
		if err := writeJSON(stdout, cleanChiefPayload(resp)); err != nil {
			return err
		}
		if strings.TrimSpace(errMsg) != "" {
			return errors.New(errMsg)
		}
		if !accepted {
			if len(violations) > 0 {
				return fmt.Errorf("submission rejected: ownership violations: %s", strings.Join(violations, ", "))
			}
			return errors.New("submission rejected")
		}
		return nil
	}

	if strings.TrimSpace(errMsg) != "" {
		if len(violations) > 0 {
			return fmt.Errorf("%s (ownership violations: %s)", errMsg, strings.Join(violations, ", "))
		}
		return errors.New(errMsg)
	}
	if !accepted {
		if len(violations) > 0 {
			return fmt.Errorf("submission rejected: ownership violations: %s", strings.Join(violations, ", "))
		}
		return errors.New("submission rejected")
	}

	thread, _ := resp["thread"].(map[string]any)
	fmt.Fprintf(stdout, "submitted thread %s (status=%s)\n", threadID, stringField(thread, "status"))
	return nil
}

func runChiefThreadVerdict(args []string, stdout io.Writer) error {
	const usage = "usage: byspace chief thread verdict [--mission <id>] (--pass|--reject) --summary <text> [--issue <text>]... [--checked <cmd>]... [--addr <host:port>] [--json] <thread-id>"
	fs := flag.NewFlagSet("chief thread verdict", flag.ContinueOnError)
	addr := fs.String("addr", "", "daemon address")
	asJSON := fs.Bool("json", false, "output JSON")
	threadIDFlag := fs.String("thread", "", "thread ID")
	missionID := fs.String("mission", "", "mission ID")
	callerFlag := fs.String("caller", "", "caller agent ID (defaults to $BYSPACE_AGENT_ID)")
	passFlag := fs.Bool("pass", false, "record a pass verdict")
	rejectFlag := fs.Bool("reject", false, "record a reject verdict")
	outcomeFlag := fs.String("outcome", "", "verdict outcome (pass | reject)")
	summaryFlag := fs.String("summary", "", "verdict summary")
	notesFlag := fs.String("notes", "", "alias for --summary")
	noteFlag := fs.String("note", "", "alias for --summary")
	var issues multiFlag
	fs.Var(&issues, "issue", "issue found during verification (repeatable)")
	var checkedCommands multiFlag
	fs.Var(&checkedCommands, "checked", "checked command reference (repeatable)")
	fs.Var(&checkedCommands, "checked-command", "checked command reference (repeatable)")

	if err := parseInterspersedChiefFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			fmt.Fprintln(stdout, usage)
			return nil
		}
		return err
	}

	outcome, err := resolveVerdictOutcome(*passFlag, *rejectFlag, *outcomeFlag)
	if err != nil {
		return err
	}
	threadID, summaryPositional := resolveThreadAndPositionalText(*threadIDFlag, fs.Args())
	summary := firstNonEmpty(*summaryFlag, *notesFlag, *noteFlag, summaryPositional)
	if threadID == "" {
		return errors.New("--thread or positional <thread-id> is required")
	}
	if summary == "" {
		return errors.New("--summary is required")
	}

	req := map[string]any{
		"type":      "chief.thread.verdict.request",
		"requestId": "cli_chief_thread_verdict",
		"threadId":  threadID,
		"outcome":   outcome,
		"summary":   summary,
	}
	if v := strings.TrimSpace(*missionID); v != "" {
		req["missionId"] = v
	}
	if caller := resolveCallerAgentID(*callerFlag); caller != "" {
		req["callerAgentId"] = caller
	}
	if list := trimNonEmpty(issues); len(list) > 0 {
		req["issues"] = list
	}
	if cmds := trimNonEmpty(checkedCommands); len(cmds) > 0 {
		req["checkedCommands"] = cmds
	}

	resp, err := doChiefRPC(*addr, chiefWriteTimeout, req, "chief.thread.verdict.response")
	if err != nil {
		return err
	}

	accepted, _ := resp["accepted"].(bool)
	errMsg, _ := resp["error"].(string)

	if *asJSON {
		if err := writeJSON(stdout, cleanChiefPayload(resp)); err != nil {
			return err
		}
		if strings.TrimSpace(errMsg) != "" {
			return errors.New(errMsg)
		}
		if !accepted {
			return errors.New("verdict rejected")
		}
		return nil
	}

	if strings.TrimSpace(errMsg) != "" {
		return errors.New(errMsg)
	}
	if !accepted {
		return errors.New("verdict rejected")
	}

	thread, _ := resp["thread"].(map[string]any)
	escalated, _ := resp["escalatedToChief"].(bool)
	if escalated {
		fmt.Fprintf(stdout, "verdict %s recorded for thread %s (status=%s, escalatedToChief=true)\n",
			outcome, threadID, stringField(thread, "status"))
		return nil
	}
	fmt.Fprintf(stdout, "verdict %s recorded for thread %s (status=%s)\n",
		outcome, threadID, stringField(thread, "status"))
	return nil
}

func runChiefThreadMergeCheck(args []string, stdout io.Writer) error {
	const usage = "usage: byspace chief thread merge-check [--mission <id>] [--addr <host:port>] [--json] <thread-id>"
	fs := flag.NewFlagSet("chief thread merge-check", flag.ContinueOnError)
	addr := fs.String("addr", "", "daemon address")
	asJSON := fs.Bool("json", false, "output JSON")
	threadIDFlag := fs.String("thread", "", "thread ID")
	missionID := fs.String("mission", "", "mission ID")
	callerFlag := fs.String("caller", "", "caller agent ID (defaults to $BYSPACE_AGENT_ID)")

	if err := parseInterspersedChiefFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			fmt.Fprintln(stdout, usage)
			return nil
		}
		return err
	}
	threadID, extra := resolveThreadAndPositionalText(*threadIDFlag, fs.Args())
	if threadID == "" {
		return errors.New("--thread or positional <thread-id> is required")
	}
	if extra != "" {
		return fmt.Errorf("unexpected positional arguments %q", extra)
	}

	req := map[string]any{
		"type":      "chief.thread.merge_check.request",
		"requestId": "cli_chief_thread_merge_check",
		"threadId":  threadID,
	}
	if v := strings.TrimSpace(*missionID); v != "" {
		req["missionId"] = v
	}
	if caller := resolveCallerAgentID(*callerFlag); caller != "" {
		req["callerAgentId"] = caller
	}

	resp, err := doChiefRPC(*addr, chiefWriteTimeout, req, "chief.thread.merge_check.response")
	if err != nil {
		return err
	}
	if *asJSON {
		if err := writeJSON(stdout, cleanChiefPayload(resp)); err != nil {
			return err
		}
		return chiefActionError(resp, "merge check rejected")
	}
	if err := chiefActionError(resp, "merge check rejected"); err != nil {
		return err
	}

	accepted, _ := resp["accepted"].(bool)
	mission, _ := resp["mission"].(map[string]any)
	mergeCheck, _ := resp["mergeCheck"].(map[string]any)
	clean, _ := mergeCheck["clean"].(bool)
	fmt.Fprintf(stdout, "merge check accepted for thread %s (accepted=%t, clean=%t, mission=%s, missionStatus=%s)\n",
		threadID, accepted, clean, firstNonEmpty(stringField(mission, "id"), strings.TrimSpace(*missionID)), stringField(mission, "status"))
	return nil
}

func runChiefThreadLand(args []string, stdout io.Writer) error {
	const usage = "usage: byspace chief thread land [--mission <id>] --strategy <merge|squash|rebase> --commit-message <text> [--addr <host:port>] [--json] <thread-id>"
	fs := flag.NewFlagSet("chief thread land", flag.ContinueOnError)
	addr := fs.String("addr", "", "daemon address")
	asJSON := fs.Bool("json", false, "output JSON")
	threadIDFlag := fs.String("thread", "", "thread ID")
	missionID := fs.String("mission", "", "mission ID")
	callerFlag := fs.String("caller", "", "caller agent ID (defaults to $BYSPACE_AGENT_ID)")
	strategyFlag := fs.String("strategy", "", "landing strategy: merge, squash, or rebase")
	commitMessage := fs.String("commit-message", "", "commit message for squash landing")

	if err := parseInterspersedChiefFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			fmt.Fprintln(stdout, usage)
			return nil
		}
		return err
	}
	strategy, err := normalizeChiefLandingStrategy(*strategyFlag)
	if err != nil {
		return err
	}
	threadID, extra := resolveThreadAndPositionalText(*threadIDFlag, fs.Args())
	if threadID == "" {
		return errors.New("--thread or positional <thread-id> is required")
	}
	if extra != "" {
		return fmt.Errorf("unexpected positional arguments %q", extra)
	}
	if strategy == "" {
		return errors.New("--strategy is required")
	}
	message := strings.TrimSpace(*commitMessage)
	if message == "" {
		return errors.New("--commit-message is required")
	}

	req := map[string]any{
		"type":          "chief.thread.land.request",
		"requestId":     "cli_chief_thread_land",
		"threadId":      threadID,
		"strategy":      strategy,
		"commitMessage": message,
	}
	if v := strings.TrimSpace(*missionID); v != "" {
		req["missionId"] = v
	}
	if caller := resolveCallerAgentID(*callerFlag); caller != "" {
		req["callerAgentId"] = caller
	}
	resp, err := doChiefRPC(*addr, chiefLandTimeout, req, "chief.thread.land.response")
	if err != nil {
		return err
	}
	if *asJSON {
		if err := writeJSON(stdout, cleanChiefPayload(resp)); err != nil {
			return err
		}
		return chiefActionError(resp, "land rejected")
	}
	if err := chiefActionError(resp, "land rejected"); err != nil {
		return err
	}

	accepted, _ := resp["accepted"].(bool)
	approvalRequired, _ := resp["approvalRequired"].(bool)
	mission, _ := resp["mission"].(map[string]any)
	resolvedMissionID := firstNonEmpty(stringField(mission, "id"), strings.TrimSpace(*missionID))
	if approvalRequired {
		fmt.Fprintf(stdout, "land approval required for thread %s (accepted=%t, approvalRequired=true, mission=%s, missionStatus=%s)\n",
			threadID, accepted, resolvedMissionID, stringField(mission, "status"))
		return nil
	}
	fmt.Fprintf(stdout, "landed thread %s (accepted=%t, approvalRequired=false, mission=%s, missionStatus=%s)\n",
		threadID, accepted, resolvedMissionID, stringField(mission, "status"))
	return nil
}

func runChiefThreadCancel(args []string, stdout io.Writer) error {
	const usage = "usage: byspace chief thread cancel [--mission <id>] --reason <text> [--addr <host:port>] [--json] <thread-id>"
	fs := flag.NewFlagSet("chief thread cancel", flag.ContinueOnError)
	addr := fs.String("addr", "", "daemon address")
	asJSON := fs.Bool("json", false, "output JSON")
	threadIDFlag := fs.String("thread", "", "thread ID")
	missionID := fs.String("mission", "", "mission ID")
	callerFlag := fs.String("caller", "", "caller agent ID (defaults to $BYSPACE_AGENT_ID)")
	reasonFlag := fs.String("reason", "", "cancellation reason")

	if err := parseInterspersedChiefFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			fmt.Fprintln(stdout, usage)
			return nil
		}
		return err
	}
	threadID, positionalReason := resolveThreadAndPositionalText(*threadIDFlag, fs.Args())
	reason := firstNonEmpty(*reasonFlag, positionalReason)
	if threadID == "" {
		return errors.New("--thread or positional <thread-id> is required")
	}
	if reason == "" {
		return errors.New("--reason is required")
	}

	req := map[string]any{
		"type":      "chief.thread.cancel.request",
		"requestId": "cli_chief_thread_cancel",
		"threadId":  threadID,
		"reason":    reason,
	}
	if v := strings.TrimSpace(*missionID); v != "" {
		req["missionId"] = v
	}
	if caller := resolveCallerAgentID(*callerFlag); caller != "" {
		req["callerAgentId"] = caller
	}

	resp, err := doChiefRPC(*addr, chiefWriteTimeout, req, "chief.thread.cancel.response")
	if err != nil {
		return err
	}
	if *asJSON {
		if err := writeJSON(stdout, cleanChiefPayload(resp)); err != nil {
			return err
		}
		return chiefActionError(resp, "cancel rejected")
	}
	if err := chiefActionError(resp, "cancel rejected"); err != nil {
		return err
	}

	accepted, _ := resp["accepted"].(bool)
	mission, _ := resp["mission"].(map[string]any)
	fmt.Fprintf(stdout, "canceled thread %s (accepted=%t, mission=%s, missionStatus=%s)\n",
		threadID, accepted, firstNonEmpty(stringField(mission, "id"), strings.TrimSpace(*missionID)), stringField(mission, "status"))
	return nil
}

func runChiefAgentHotswap(args []string, stdout io.Writer) error {
	const usage = "usage: byspace chief agent hotswap --thread <id> [--mission <id>] --profile <id> --reason <text> [--addr <host:port>] [--json] <agent-id>"
	fs := flag.NewFlagSet("chief agent hotswap", flag.ContinueOnError)
	addr := fs.String("addr", "", "daemon address")
	asJSON := fs.Bool("json", false, "output JSON")
	agentIDFlag := fs.String("agent", "", "agent ID")
	threadID := fs.String("thread", "", "thread ID")
	missionID := fs.String("mission", "", "mission ID")
	profileID := fs.String("profile", "", "replacement agent profile ID")
	callerFlag := fs.String("caller", "", "caller agent ID (defaults to $BYSPACE_AGENT_ID)")
	reasonFlag := fs.String("reason", "", "hot-swap reason")

	if err := parseInterspersedChiefFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			fmt.Fprintln(stdout, usage)
			return nil
		}
		return err
	}
	agentID, extra := resolveThreadAndPositionalText(*agentIDFlag, fs.Args())
	if agentID == "" {
		return errors.New("--agent or positional <agent-id> is required")
	}
	if extra != "" {
		return fmt.Errorf("unexpected positional arguments %q", extra)
	}
	if strings.TrimSpace(*threadID) == "" {
		return errors.New("--thread is required")
	}
	if strings.TrimSpace(*profileID) == "" {
		return errors.New("--profile is required")
	}
	reason := strings.TrimSpace(*reasonFlag)
	if reason == "" {
		return errors.New("--reason is required")
	}

	req := map[string]any{
		"type":      "chief.agent.hotswap.request",
		"requestId": "cli_chief_agent_hotswap",
		"agentId":   agentID,
		"threadId":  strings.TrimSpace(*threadID),
		"profileId": strings.TrimSpace(*profileID),
		"reason":    reason,
	}
	if v := strings.TrimSpace(*missionID); v != "" {
		req["missionId"] = v
	}
	if caller := resolveCallerAgentID(*callerFlag); caller != "" {
		req["callerAgentId"] = caller
	}
	resp, err := doChiefRPC(*addr, chiefHotswapTimeout, req, "chief.agent.hotswap.response")
	if err != nil {
		return err
	}
	if *asJSON {
		if err := writeJSON(stdout, cleanChiefPayload(resp)); err != nil {
			return err
		}
		return chiefActionError(resp, "hot-swap rejected")
	}
	if err := chiefActionError(resp, "hot-swap rejected"); err != nil {
		return err
	}

	accepted, _ := resp["accepted"].(bool)
	mission, _ := resp["mission"].(map[string]any)
	previousAgentID := firstNonEmpty(stringField(resp, "previousAgentId"), agentID)
	replacementAgentID := firstNonEmpty(stringField(resp, "replacementAgentId"), previousAgentID)
	fmt.Fprintf(stdout, "hot-swapped agent %s -> %s (accepted=%t, profile=%s, mission=%s)\n",
		previousAgentID, replacementAgentID, accepted,
		firstNonEmpty(stringField(resp, "profileId"), strings.TrimSpace(*profileID)),
		firstNonEmpty(stringField(mission, "id"), strings.TrimSpace(*missionID)))
	return nil
}

func chiefActionError(resp map[string]any, rejection string) error {
	if errMsg := strings.TrimSpace(stringField(resp, "error")); errMsg != "" {
		return errors.New(errMsg)
	}
	accepted, _ := resp["accepted"].(bool)
	approvalRequired, _ := resp["approvalRequired"].(bool)
	if !accepted && !approvalRequired {
		return errors.New(rejection)
	}
	return nil
}

func doChiefRPC(addr string, timeout time.Duration, req map[string]any, wantRespType string) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	ws, err := dialChiefWS(ctx, addr)
	if err != nil {
		return nil, err
	}
	defer ws.CloseNow()

	if err := sendSessionReq(ctx, ws, req); err != nil {
		return nil, err
	}
	return waitSessionResp(ctx, ws, wantRespType, "")
}

func parseInterspersedChiefFlags(fs *flag.FlagSet, args []string) error {
	fs.SetOutput(io.Discard)
	flagArgs := make([]string, 0, len(args))
	posArgs := make([]string, 0, len(args))
	sawDoubleDash := false

	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			sawDoubleDash = true
			posArgs = append(posArgs, args[i+1:]...)
			break
		}
		if !strings.HasPrefix(arg, "-") || arg == "-" {
			posArgs = append(posArgs, arg)
			continue
		}
		flagArgs = append(flagArgs, arg)
		trimmed := strings.TrimLeft(arg, "-")
		if strings.ContainsRune(trimmed, '=') {
			continue
		}
		f := fs.Lookup(trimmed)
		if f == nil {
			continue
		}
		if bf, ok := f.Value.(interface{ IsBoolFlag() bool }); ok && bf.IsBoolFlag() {
			continue
		}
		if i+1 < len(args) {
			i++
			flagArgs = append(flagArgs, args[i])
		}
	}

	reordered := make([]string, 0, len(flagArgs)+len(posArgs)+1)
	reordered = append(reordered, flagArgs...)
	if sawDoubleDash {
		reordered = append(reordered, "--")
	}
	reordered = append(reordered, posArgs...)
	return fs.Parse(reordered)
}

func resolveCallerAgentID(explicit string) string {
	if v := strings.TrimSpace(explicit); v != "" {
		return v
	}
	return strings.TrimSpace(os.Getenv("BYSPACE_AGENT_ID"))
}

func resolveThreadAndPositionalText(threadFlag string, positional []string) (string, string) {
	if tid := strings.TrimSpace(threadFlag); tid != "" {
		return tid, strings.TrimSpace(strings.Join(positional, " "))
	}
	if len(positional) == 0 {
		return "", ""
	}
	return strings.TrimSpace(positional[0]), strings.TrimSpace(strings.Join(positional[1:], " "))
}

func resolveVerdictOutcome(passFlag, rejectFlag bool, outcomeFlag string) (string, error) {
	if passFlag && rejectFlag {
		return "", errors.New("cannot use --pass and --reject together")
	}
	explicit := strings.ToLower(strings.TrimSpace(outcomeFlag))
	if explicit != "" && explicit != "pass" && explicit != "reject" {
		return "", fmt.Errorf("invalid --outcome %q: expected pass or reject", outcomeFlag)
	}
	if passFlag {
		if explicit == "reject" {
			return "", errors.New("cannot combine --pass with --outcome reject")
		}
		return "pass", nil
	}
	if rejectFlag {
		if explicit == "pass" {
			return "", errors.New("cannot combine --reject with --outcome pass")
		}
		return "reject", nil
	}
	if explicit != "" {
		return explicit, nil
	}
	return "", errors.New("one of --pass or --reject is required")
}

func normalizeChiefLandingStrategy(raw string) (string, error) {
	strategy := strings.ToLower(strings.TrimSpace(raw))
	if strategy == "" {
		return "", nil
	}
	if strategy == "open_pr" {
		return "", errors.New("--strategy open_pr is not supported; expected merge, squash, or rebase")
	}
	if !validChiefLandingStrategies[strategy] {
		return "", fmt.Errorf("invalid --strategy %q: expected merge, squash, or rebase (open_pr is not supported)", raw)
	}
	return strategy, nil
}

func normalizeChiefTier(raw string) (string, error) {
	trimmed := strings.ToUpper(strings.TrimSpace(raw))
	if trimmed == "" {
		return "", nil
	}
	if !validChiefTiers[trimmed] {
		return "", fmt.Errorf("invalid --tier %q: expected L0, L1, or L2", raw)
	}
	return trimmed, nil
}

func parseCommaSeparatedList(values []string) []string {
	var out []string
	for _, raw := range values {
		for _, part := range strings.Split(raw, ",") {
			trimmed := strings.TrimSpace(part)
			if trimmed != "" {
				out = append(out, trimmed)
			}
		}
	}
	return out
}

func nonEmptyPaths(values []string) []string {
	var out []string
	for _, v := range values {
		if v != "" {
			out = append(out, v)
		}
	}
	return out
}

func trimNonEmpty(values []string) []string {
	var out []string
	for _, v := range values {
		if trimmed := strings.TrimSpace(v); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if trimmed := strings.TrimSpace(v); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func cleanChiefPayload(resp map[string]any) map[string]any {
	out := make(map[string]any, len(resp))
	for key, value := range resp {
		if key == "requestId" {
			continue
		}
		if key == "error" && value == nil {
			continue
		}
		out[key] = value
	}
	return out
}

func renderMissionList(stdout io.Writer, missions []any) error {
	if len(missions) == 0 {
		fmt.Fprintln(stdout, "No missions found.")
		return nil
	}
	rows := make([][]string, 0, len(missions))
	for _, raw := range missions {
		m, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		threads, _ := m["threads"].([]any)
		title := firstNonEmpty(stringField(m, "title"), stringField(m, "goal"), "(untitled)")
		status := stringField(m, "status")
		if decision, _ := m["pendingDecision"].(map[string]any); decision != nil {
			status += " [decision]"
		}
		if attn, _ := m["systemAttention"].(map[string]any); attn != nil && stringField(attn, "resolvedAt") == "" {
			status += " [" + firstNonEmpty(stringField(attn, "severity"), "attention") + "]"
		}
		rows = append(rows, []string{
			stringField(m, "id"),
			stringField(m, "tier"),
			status,
			fmt.Sprintf("%d", len(threads)),
			title,
		})
	}
	return renderTable(stdout, []string{"ID", "TIER", "STATUS", "THREADS", "TITLE"}, rows)
}

func renderMissionDetail(stdout io.Writer, mission map[string]any, events []any) error {
	fmt.Fprintf(stdout, "Mission %s  tier=%s  status=%s\n",
		stringField(mission, "id"),
		stringField(mission, "tier"),
		stringField(mission, "status"),
	)
	if title := stringField(mission, "title"); title != "" {
		fmt.Fprintf(stdout, "Title:     %s\n", title)
	}
	if goal := stringField(mission, "goal"); goal != "" {
		fmt.Fprintf(stdout, "Goal:      %s\n", goal)
	}
	if chiefID := stringField(mission, "chiefAgentId"); chiefID != "" {
		if chiefStatus := stringField(mission, "chiefAgentStatus"); chiefStatus != "" {
			fmt.Fprintf(stdout, "Chief:     %s (%s)\n", chiefID, chiefStatus)
		} else {
			fmt.Fprintf(stdout, "Chief:     %s\n", chiefID)
		}
	}
	if cwd := stringField(mission, "baseCwd"); cwd != "" {
		line := fmt.Sprintf("Base:      %s", cwd)
		if branch := stringField(mission, "baseBranch"); branch != "" {
			line += " [" + branch + "]"
		}
		if wsID := stringField(mission, "baseWorkspaceId"); wsID != "" {
			line += " (" + wsID + ")"
		}
		fmt.Fprintln(stdout, line)
	}
	if decision, _ := mission["pendingDecision"].(map[string]any); decision != nil {
		fmt.Fprintf(stdout, "Decision:  [%s] %s — %s\n",
			stringField(decision, "id"),
			stringField(decision, "title"),
			stringField(decision, "summary"),
		)
		if opts, _ := decision["options"].([]any); len(opts) > 0 {
			for _, rawOpt := range opts {
				if opt, ok := rawOpt.(map[string]any); ok {
					fmt.Fprintf(stdout, "  - %s: %s\n", stringField(opt, "id"), stringField(opt, "label"))
				}
			}
		}
	}
	if attn, _ := mission["systemAttention"].(map[string]any); attn != nil && stringField(attn, "resolvedAt") == "" {
		fmt.Fprintf(stdout, "Attention: [%s/%s] %s\n",
			stringField(attn, "severity"),
			stringField(attn, "kind"),
			stringField(attn, "summary"),
		)
	}

	threads, _ := mission["threads"].([]any)
	if len(threads) > 0 {
		fmt.Fprintf(stdout, "\nThreads (%d):\n", len(threads))
		rows := make([][]string, 0, len(threads))
		for _, raw := range threads {
			th, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			rows = append(rows, []string{
				stringField(th, "id"),
				stringField(th, "status"),
				stringField(th, "isolation"),
				firstNonEmpty(stringField(th, "authorAgentId"), "-"),
				firstNonEmpty(stringField(th, "verifierAgentId"), "-"),
				stringField(th, "title"),
			})
		}
		if err := renderTable(stdout, []string{"ID", "STATUS", "ISOLATION", "AUTHOR", "VERIFIER", "TITLE"}, rows); err != nil {
			return err
		}
	}

	if len(events) > 0 {
		fmt.Fprintf(stdout, "\nEvents (%d):\n", len(events))
		for _, raw := range events {
			ev, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			seq := entrySeq(ev)
			fmt.Fprintf(stdout, "  #%d %s %s — %s\n",
				seq,
				stringField(ev, "ts"),
				stringField(ev, "kind"),
				stringField(ev, "summary"),
			)
		}
	}
	return nil
}

func stringField(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	v, _ := m[key].(string)
	return v
}
