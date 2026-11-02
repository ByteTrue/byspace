package server

import (
	"context"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/schedule"
	"github.com/ByteTrue/byspace/internal/store"
)

// The schedule and heartbeat MCP tools, ported from the schedule half of byspace-tools.ts in the
// archived Node daemon. A schedule starts a new agent on a cron cadence; a heartbeat prompts the
// agent that created it. Schedule tools act only on new-agent schedules and heartbeat tools only on
// the caller's own heartbeats, so an agent cannot reach into another agent's heartbeat.

type mcpCallerKey struct{}

// withMCPCaller records which agent is calling a tool.
func withMCPCaller(ctx context.Context, agentID string) context.Context {
	if strings.TrimSpace(agentID) == "" {
		return ctx
	}
	return context.WithValue(ctx, mcpCallerKey{}, strings.TrimSpace(agentID))
}

// mcpCallerID is the calling agent, or "" outside an agent-scoped session.
func mcpCallerID(ctx context.Context) string {
	id, _ := ctx.Value(mcpCallerKey{}).(string)
	return id
}

func scheduleToolDefinitions() []map[string]any {
	str := map[string]any{"type": "string"}
	nullableStr := map[string]any{"type": []string{"string", "null"}}
	positiveInt := map[string]any{"type": "integer", "minimum": 1}
	nullablePositiveInt := map[string]any{"type": []string{"integer", "null"}, "minimum": 1}
	timezone := map[string]any{"type": "string", "description": "IANA time zone for the cron cadence. For example: America/New_York."}
	id := map[string]any{"id": str}
	return []map[string]any{
		mcpToolDef("create_schedule", "Create a recurring schedule that starts a new agent on a cron cadence.", map[string]any{
			"prompt":   str,
			"cron":     str,
			"timezone": timezone,
			"name":     str,
			"provider": map[string]any{"type": "string", "description": "Provider, or provider/model (for example: codex or codex/gpt-5.4). Defaults to the caller's provider in an agent-scoped session."},
			"cwd":      str,
			"isolation": map[string]any{
				"type": "string",
				"enum": []string{"local", "worktree"},
			},
			"maxRuns":   positiveInt,
			"expiresIn": str,
		}, "prompt", "cron"),
		mcpToolDef("create_heartbeat", "Create a recurring heartbeat that sends you a prompt on a cron cadence.", map[string]any{
			"prompt":    str,
			"cron":      str,
			"timezone":  timezone,
			"name":      str,
			"maxRuns":   positiveInt,
			"expiresIn": str,
		}, "prompt", "cron"),
		mcpToolDef("delete_heartbeat", "Delete one of your heartbeats.", id, "id"),
		mcpToolDef("list_schedules", "List all schedules managed by the daemon.", map[string]any{}),
		mcpToolDef("inspect_schedule", "Inspect a schedule and its run history.", id, "id"),
		mcpToolDef("pause_schedule", "Pause an active schedule.", id, "id"),
		mcpToolDef("resume_schedule", "Resume a paused schedule.", id, "id"),
		mcpToolDef("delete_schedule", "Delete a schedule permanently.", id, "id"),
		mcpToolDef("update_schedule", "Update an existing schedule. Only provided fields are changed; omitted fields remain unchanged.", map[string]any{
			"id":           str,
			"cron":         map[string]any{"type": "string", "description": "New cron expression."},
			"timezone":     map[string]any{"type": "string", "description": "IANA time zone for cron cadence; requires cron. For example: America/New_York."},
			"name":         map[string]any{"type": []string{"string", "null"}, "description": "New name (null to clear)."},
			"prompt":       map[string]any{"type": "string", "description": "New prompt text."},
			"maxRuns":      map[string]any{"type": nullablePositiveInt["type"], "minimum": 1, "description": "New max runs limit (null to clear)."},
			"provider":     map[string]any{"type": "string", "description": "New provider for new-agent target."},
			"model":        map[string]any{"type": nullableStr["type"], "description": "New model for new-agent target (null to clear)."},
			"mode":         map[string]any{"type": nullableStr["type"], "description": "New mode for new-agent target (null to clear)."},
			"cwd":          map[string]any{"type": "string", "description": "New cwd for new-agent target."},
			"expiresIn":    map[string]any{"type": "string", "description": "New relative expiry duration (for example: 1h, 2d)."},
			"clearExpires": map[string]any{"type": "boolean", "description": "Clear any schedule expiry."},
		}, "id"),
		mcpToolDef("schedule_logs", "Get the run history (logs) for a schedule.", id, "id"),
		mcpToolDef("run_schedule_once", "Run a schedule immediately without changing its cron cadence.", id, "id"),
	}
}

// callScheduleTool runs one schedule or heartbeat tool. handled is false for any other tool.
func (s *Server) callScheduleTool(ctx context.Context, name string, args map[string]any) (result any, isError bool, handled bool) {
	run := func() (any, error) {
		switch name {
		case "create_schedule":
			return s.mcpCreateSchedule(ctx, args)
		case "create_heartbeat":
			return s.mcpCreateHeartbeat(ctx, args)
		case "delete_heartbeat":
			id := mcpString(args, "id")
			if _, err := s.requireCallerHeartbeat(ctx, id); err != nil {
				return nil, err
			}
			if err := s.schedules.Delete(id); err != nil {
				return nil, err
			}
			return map[string]any{"success": true}, nil
		case "list_schedules":
			all, err := s.schedules.List()
			if err != nil {
				return nil, err
			}
			summaries := make([]schedule.Summary, 0, len(all))
			for _, item := range all {
				if item.Target.Type == "new-agent" {
					summaries = append(summaries, item.ToSummary())
				}
			}
			return map[string]any{"schedules": summaries}, nil
		case "inspect_schedule":
			return s.requireScheduleTarget(mcpString(args, "id"), "new-agent")
		case "pause_schedule", "resume_schedule", "delete_schedule":
			id := mcpString(args, "id")
			if _, err := s.requireScheduleTarget(id, "new-agent"); err != nil {
				return nil, err
			}
			var err error
			switch name {
			case "pause_schedule":
				_, err = s.schedules.Pause(id)
			case "resume_schedule":
				_, err = s.schedules.Resume(id)
			default:
				err = s.schedules.Delete(id)
			}
			if err != nil {
				return nil, err
			}
			return map[string]any{"success": true}, nil
		case "update_schedule":
			id := mcpString(args, "id")
			if _, err := s.requireScheduleTarget(id, "new-agent"); err != nil {
				return nil, err
			}
			update, err := buildScheduleToolUpdate(id, args)
			if err != nil {
				return nil, err
			}
			return s.schedules.Update(update)
		case "schedule_logs":
			id := mcpString(args, "id")
			if _, err := s.requireScheduleTarget(id, "new-agent"); err != nil {
				return nil, err
			}
			runs, err := s.schedules.Logs(id)
			if err != nil {
				return nil, err
			}
			return map[string]any{"runs": runs}, nil
		case "run_schedule_once":
			id := mcpString(args, "id")
			if _, err := s.requireScheduleTarget(id, "new-agent"); err != nil {
				return nil, err
			}
			return s.schedules.RunOnce(context.WithoutCancel(ctx), id)
		}
		return nil, nil
	}
	switch name {
	case "create_schedule", "create_heartbeat", "delete_heartbeat", "list_schedules", "inspect_schedule",
		"pause_schedule", "resume_schedule", "delete_schedule", "update_schedule", "schedule_logs", "run_schedule_once":
	default:
		return nil, false, false
	}
	out, err := run()
	if err != nil {
		return map[string]any{"error": err.Error()}, true, true
	}
	return out, false, true
}

func (s *Server) mcpCreateSchedule(ctx context.Context, args map[string]any) (any, error) {
	prompt := strings.TrimSpace(mcpString(args, "prompt"))
	if prompt == "" {
		return nil, errors.New("prompt is required")
	}
	cadence, err := buildCronCadence(mcpString(args, "cron"), mcpString(args, "timezone"))
	if err != nil {
		return nil, err
	}
	var provider *string
	if value, ok := args["provider"].(string); ok {
		provider = &value
	}
	isolation := mcpString(args, "isolation")
	if isolation != "" && isolation != "local" && isolation != "worktree" {
		return nil, fmt.Errorf("Invalid isolation: %q", isolation)
	}
	target, err := s.newAgentScheduleTarget(ctx, provider, mcpString(args, "cwd"), isolation)
	if err != nil {
		return nil, err
	}
	in := schedule.CreateInput{Prompt: prompt, Cadence: cadence, Target: target}
	if err := applyScheduleToolCommon(&in, args); err != nil {
		return nil, err
	}
	created, err := s.schedules.CreateOrReplace(in)
	if err != nil {
		return nil, err
	}
	return created.ToSummary(), nil
}

func (s *Server) mcpCreateHeartbeat(ctx context.Context, args map[string]any) (any, error) {
	prompt := strings.TrimSpace(mcpString(args, "prompt"))
	if prompt == "" {
		return nil, errors.New("prompt is required")
	}
	cadence, err := buildCronCadence(mcpString(args, "cron"), mcpString(args, "timezone"))
	if err != nil {
		return nil, err
	}
	callerID := mcpCallerID(ctx)
	if callerID == "" {
		return nil, errors.New("create_heartbeat requires an agent-scoped session")
	}
	if _, err := s.mcpCallerAgent(callerID); err != nil {
		return nil, err
	}
	in := schedule.CreateInput{Prompt: prompt, Cadence: cadence, Target: schedule.Target{Type: "agent", AgentID: callerID}}
	if err := applyScheduleToolCommon(&in, args); err != nil {
		return nil, err
	}
	created, err := s.schedules.CreateOrReplace(in)
	if err != nil {
		return nil, err
	}
	return created.ToSummary(), nil
}

// applyScheduleToolCommon reads the name, maxRuns and expiresIn both create tools take.
func applyScheduleToolCommon(in *schedule.CreateInput, args map[string]any) error {
	if name := strings.TrimSpace(mcpString(args, "name")); name != "" {
		in.Name = &name
	}
	if raw, ok := args["maxRuns"]; ok && raw != nil {
		maxRuns, err := mcpPositiveInt(raw, "maxRuns")
		if err != nil {
			return err
		}
		in.MaxRuns = &maxRuns
	}
	if raw, ok := args["expiresIn"].(string); ok {
		duration, err := parseDurationString(raw)
		if err != nil {
			return err
		}
		expires := isoMillis(time.Now().Add(duration))
		in.ExpiresAt = &expires
	}
	return nil
}

// mcpCallerAgent is the record of the agent calling a tool.
func (s *Server) mcpCallerAgent(callerID string) (*store.AgentRecord, error) {
	record, err := s.store.GetAgent(callerID)
	if err != nil || record == nil {
		return nil, fmt.Errorf("Parent agent %s not found", callerID)
	}
	return record, nil
}

// newAgentScheduleTarget is the new agent a schedule starts. From an agent it is that agent's own
// setup (provider, model, mode, thinking, options) unless the call overrides the provider or cwd;
// outside one the provider has to be named.
func (s *Server) newAgentScheduleTarget(ctx context.Context, provider *string, cwd, isolation string) (schedule.Target, error) {
	config := schedule.TargetConfig{Isolation: isolation}
	if callerID := mcpCallerID(ctx); callerID != "" {
		caller, err := s.mcpCallerAgent(callerID)
		if err != nil {
			return schedule.Target{}, err
		}
		callerConfig := caller.Config
		if callerConfig == nil {
			callerConfig = &store.AgentConfig{}
		}
		resolvedProvider := caller.Provider
		resolvedModel := ""
		if provider != nil {
			name, model, err := resolveScheduleProviderModel(*provider, caller.Provider)
			if err != nil {
				return schedule.Target{}, err
			}
			resolvedProvider = name
			resolvedModel = model
		} else if callerConfig.Model != nil {
			resolvedModel = *callerConfig.Model
		}
		config.Provider = resolvedProvider
		config.Cwd = caller.Cwd
		if strings.TrimSpace(cwd) != "" {
			config.Cwd = expandUserPath(cwd)
		}
		if caller.Provider == resolvedProvider {
			if mode := callerCurrentMode(caller); mode != "" {
				config.ModeID = mode
			}
			config.ProviderOptions = callerConfig.ProviderOptions
		}
		config.Model = resolvedModel
		if callerConfig.ThinkingOptionID != nil {
			config.ThinkingOptionID = *callerConfig.ThinkingOptionID
		}
		config.FeatureValues = callerConfig.FeatureValues
		if callerConfig.SystemPrompt != nil && *callerConfig.SystemPrompt != "" {
			config.SystemPrompt = callerConfig.SystemPrompt
		}
		return schedule.Target{Type: "new-agent", Config: &config}, nil
	}

	if provider == nil || strings.TrimSpace(*provider) == "" {
		return schedule.Target{}, errors.New("provider is required when target is new-agent")
	}
	name, model, err := resolveScheduleProviderModel(*provider, *provider)
	if err != nil {
		return schedule.Target{}, err
	}
	config.Provider = name
	config.Model = model
	if strings.TrimSpace(cwd) != "" {
		config.Cwd = expandUserPath(cwd)
	} else {
		config.Cwd, _ = os.Getwd()
	}
	return schedule.Target{Type: "new-agent", Config: &config}, nil
}

// callerCurrentMode is the mode the caller runs in now.
func callerCurrentMode(caller *store.AgentRecord) string {
	if caller.LastModeID != nil && *caller.LastModeID != "" {
		return *caller.LastModeID
	}
	if caller.Config != nil && caller.Config.ModeID != nil {
		return *caller.Config.ModeID
	}
	return ""
}

// resolveScheduleProviderModel splits "provider" or "provider/model".
func resolveScheduleProviderModel(input, fallback string) (string, string, error) {
	value := strings.TrimSpace(input)
	if value == "" {
		value = fallback
	}
	slash := strings.Index(value, "/")
	if slash == -1 {
		return value, "", nil
	}
	provider := strings.TrimSpace(value[:slash])
	model := strings.TrimSpace(value[slash+1:])
	if provider == "" || model == "" {
		return "", "", errors.New("provider must be <provider> or <provider>/<model>")
	}
	return provider, model, nil
}

func (s *Server) requireScheduleTarget(id, targetType string) (*schedule.StoredSchedule, error) {
	sched, err := s.schedules.Inspect(id)
	if err != nil {
		return nil, err
	}
	if sched.Target.Type != targetType {
		if targetType == "agent" {
			return nil, fmt.Errorf("Heartbeat not found: %s", id)
		}
		return nil, fmt.Errorf("Schedule not found: %s", id)
	}
	return sched, nil
}

func (s *Server) requireCallerHeartbeat(ctx context.Context, id string) (*schedule.StoredSchedule, error) {
	callerID := mcpCallerID(ctx)
	if callerID == "" {
		return nil, errors.New("Heartbeat operations require an agent-scoped session")
	}
	sched, err := s.requireScheduleTarget(id, "agent")
	if err != nil {
		return nil, err
	}
	if sched.Target.AgentID != callerID {
		return nil, fmt.Errorf("Heartbeat %s does not belong to caller %s", id, callerID)
	}
	return sched, nil
}

func buildCronCadence(expression, timezone string) (schedule.Cadence, error) {
	expression = strings.TrimSpace(expression)
	if expression == "" {
		return schedule.Cadence{}, errors.New("cron is required")
	}
	return schedule.Cadence{Type: "cron", Expression: expression, Timezone: strings.TrimSpace(timezone)}, nil
}

// buildScheduleToolUpdate turns update_schedule's arguments into a patch: an absent argument leaves
// the field alone, a null one clears it.
func buildScheduleToolUpdate(id string, args map[string]any) (schedule.UpdateInput, error) {
	update := schedule.UpdateInput{ID: id}

	cron := strings.TrimSpace(mcpString(args, "cron"))
	timezone := strings.TrimSpace(mcpString(args, "timezone"))
	if timezone != "" && cron == "" {
		return update, errors.New("timezone can only be used with cron")
	}
	if cron != "" {
		update.Cadence = &schedule.Cadence{Type: "cron", Expression: cron, Timezone: timezone}
	}

	expiresIn, hasExpiresIn := args["expiresIn"].(string)
	clearExpires, _ := args["clearExpires"].(bool)
	if hasExpiresIn && clearExpires {
		return update, errors.New("Specify at most one of expiresIn or clearExpires")
	}
	if hasExpiresIn {
		duration, err := parseDurationString(expiresIn)
		if err != nil {
			return update, err
		}
		expires := isoMillis(time.Now().Add(duration))
		update.ExpiresAt = schedule.Present(&expires)
	} else if clearExpires {
		update.ExpiresAt = schedule.Present[string](nil)
	}

	if raw, ok := args["name"]; ok {
		if raw == nil {
			update.Name = schedule.Present[string](nil)
		} else if name, isString := raw.(string); isString {
			update.Name = schedule.Present(&name)
		}
	}
	if raw, ok := args["prompt"].(string); ok {
		prompt := strings.TrimSpace(raw)
		if prompt == "" {
			return update, errors.New("prompt is required")
		}
		update.Prompt = &prompt
	}
	if raw, ok := args["maxRuns"]; ok {
		if raw == nil {
			update.MaxRuns = schedule.Present[int](nil)
		} else {
			maxRuns, err := mcpPositiveInt(raw, "maxRuns")
			if err != nil {
				return update, err
			}
			update.MaxRuns = schedule.Present(&maxRuns)
		}
	}

	patch := schedule.NewAgentConfigPatch{}
	touched := false
	provider, model, err := resolveScheduleUpdateProviderModel(args)
	if err != nil {
		return update, err
	}
	if provider != nil {
		patch.Provider = provider
		touched = true
	}
	if model.Set {
		patch.Model = model
		touched = true
	}
	if raw, ok := args["mode"]; ok {
		if raw == nil {
			patch.ModeID = schedule.Present[string](nil)
		} else if mode, isString := raw.(string); isString {
			patch.ModeID = schedule.Present(&mode)
		}
		touched = true
	}
	if raw, ok := args["cwd"].(string); ok {
		cwd := strings.TrimSpace(raw)
		patch.Cwd = &cwd
		touched = true
	}
	if touched {
		update.NewAgentConfig = &patch
	}
	return update, nil
}

// resolveScheduleUpdateProviderModel reads update_schedule's provider and model, where the provider
// may carry the model as provider/model.
func resolveScheduleUpdateProviderModel(args map[string]any) (*string, schedule.Optional[string], error) {
	rawModel, hasModel := args["model"]
	var model *string
	if hasModel && rawModel != nil {
		text, _ := rawModel.(string)
		trimmed := strings.TrimSpace(text)
		if trimmed == "" {
			return nil, schedule.Optional[string]{}, errors.New("model cannot be empty")
		}
		model = &trimmed
	}
	modelPatch := schedule.Optional[string]{}
	if hasModel {
		modelPatch = schedule.Present(model)
	}

	providerInput := strings.TrimSpace(mcpString(args, "provider"))
	if providerInput == "" {
		return nil, modelPatch, nil
	}
	slash := strings.Index(providerInput, "/")
	if slash == -1 {
		return &providerInput, modelPatch, nil
	}
	provider := strings.TrimSpace(providerInput[:slash])
	fromProvider := strings.TrimSpace(providerInput[slash+1:])
	if provider == "" || fromProvider == "" {
		return nil, modelPatch, errors.New("provider must be <provider> or <provider>/<model>")
	}
	if hasModel && rawModel == nil {
		return nil, modelPatch, errors.New("provider specifies a model but model is null")
	}
	if model != nil && *model != fromProvider {
		return nil, modelPatch, errors.New("Conflicting model values provided")
	}
	return &provider, schedule.Present(&fromProvider), nil
}

func mcpString(args map[string]any, key string) string {
	value, _ := args[key].(string)
	return value
}

func mcpPositiveInt(raw any, field string) (int, error) {
	number, ok := raw.(float64)
	if !ok || number != float64(int(number)) || number <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", field)
	}
	return int(number), nil
}

var durationPartPattern = regexp.MustCompile(`(\d+)([smh])`)

// parseDurationString reads "30s", "5m", "2h30m", or a bare number of seconds. Ported from
// mcp-shared.ts.
func parseDurationString(input string) (time.Duration, error) {
	trimmed := strings.TrimSpace(input)
	if regexp.MustCompile(`^\d+$`).MatchString(trimmed) {
		seconds, _ := strconv.Atoi(trimmed)
		return time.Duration(seconds) * time.Second, nil
	}
	matches := durationPartPattern.FindAllStringSubmatch(trimmed, -1)
	if len(matches) == 0 {
		return 0, fmt.Errorf("Invalid duration format: %s. Use formats like: 5m, 30s, 1h, 2h30m", input)
	}
	var total time.Duration
	for _, match := range matches {
		value, _ := strconv.Atoi(match[1])
		switch match[2] {
		case "s":
			total += time.Duration(value) * time.Second
		case "m":
			total += time.Duration(value) * time.Minute
		case "h":
			total += time.Duration(value) * time.Hour
		}
	}
	return total, nil
}

// isoMillis formats a time the way JavaScript's toISOString does.
func isoMillis(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}
