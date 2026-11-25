package providers

import (
	"context"
	"errors"
	"fmt"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

const (
	acpConformanceStartupTimeout = 15 * time.Second
	acpConformanceTurnTimeout    = 30 * time.Second
	acpConformanceRPCTimeout     = 5 * time.Second
	acpConformanceImage          = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)

// ACPCheckStatus is the outcome of one independent conformance operation.
type ACPCheckStatus string

const (
	ACPCheckPass ACPCheckStatus = "PASS"
	ACPCheckFail ACPCheckStatus = "FAIL"
	ACPCheckSkip ACPCheckStatus = "SKIP"
)

// ACPCheckResult identifies one operation and preserves the native failure text.
type ACPCheckResult struct {
	Name   string
	Status ACPCheckStatus
	Detail string
}

// ACPConformanceReport is a stable, CLI-renderable sequence of protocol checks.
type ACPConformanceReport struct {
	Provider string
	Results  []ACPCheckResult
}

// Passed reports whether any required or advertised-capability check failed.
func (r ACPConformanceReport) Passed() bool {
	for _, result := range r.Results {
		if result.Status == ACPCheckFail {
			return false
		}
	}
	return true
}

var acpConformanceCheckNames = []string{
	"launch", "initialize", "session", "prompt", "output", "completion",
	"image", "continuation", "model", "mode", "thinking",
}

func newACPConformanceReport(provider string) *ACPConformanceReport {
	report := &ACPConformanceReport{Provider: provider}
	for _, name := range acpConformanceCheckNames {
		report.Results = append(report.Results, ACPCheckResult{Name: name})
	}
	return report
}

func (r *ACPConformanceReport) set(name string, status ACPCheckStatus, detail string) {
	for i := range r.Results {
		if r.Results[i].Name == name {
			r.Results[i].Status = status
			r.Results[i].Detail = detail
			return
		}
	}
}

func (r *ACPConformanceReport) skipRemaining(names []string, reason string) {
	for _, name := range names {
		r.set(name, ACPCheckSkip, reason)
	}
}

func (r *ACPConformanceReport) passed(name string) bool {
	for _, result := range r.Results {
		if result.Name == name {
			return result.Status == ACPCheckPass
		}
	}
	return false
}

// RunACPConformance exercises a configured provider through the same generic ACP transport used
// by interactive sessions. Its working directory and native session are disposable; no BySpace
// agent, workspace, or timeline record is created.
func RunACPConformance(ctx context.Context, providerID string, providerConfig map[string]any) ACPConformanceReport {
	report := newACPConformanceReport(providerID)
	allAfter := func(name string) []string {
		for i, candidate := range acpConformanceCheckNames {
			if candidate == name {
				return acpConformanceCheckNames[i+1:]
			}
		}
		return nil
	}

	cwd, err := os.MkdirTemp("", "byspace-acp-check-*")
	if err != nil {
		report.set("launch", ACPCheckFail, err.Error())
		report.skipRemaining(allAfter("launch"), "launch did not complete")
		return *report
	}
	defer os.RemoveAll(cwd)

	spec, _ := ProviderSpecForLaunch(providerID, providerConfig)
	launch := func(ctx context.Context, sessionHandle string) (*ACPSession, error) {
		return startACPSession(ctx, LaunchConfig{
			Provider: providerID, ProviderConfig: providerConfig, Cwd: cwd,
			Env: acpConformanceEnvironment(providerConfig), SessionHandle: sessionHandle,
		}, spec, "")
	}
	startupCtx, startupCancel := context.WithTimeout(ctx, acpConformanceStartupTimeout)
	session, err := launch(startupCtx, "")
	startupCancel()
	if err != nil {
		stage := ACPStartupLaunch
		var startupErr *ACPStartupError
		if errors.As(err, &startupErr) {
			stage = startupErr.Stage
		}
		switch stage {
		case ACPStartupLaunch:
			report.set("launch", ACPCheckFail, err.Error())
			report.skipRemaining(allAfter("launch"), "launch did not complete")
		case ACPStartupInitialize:
			report.set("launch", ACPCheckPass, "")
			report.set("initialize", ACPCheckFail, err.Error())
			report.skipRemaining(allAfter("initialize"), "initialize did not complete")
		default:
			report.set("launch", ACPCheckPass, "")
			report.set("initialize", ACPCheckPass, "")
			report.set("session", ACPCheckFail, err.Error())
			report.skipRemaining(allAfter("session"), "session creation did not complete")
		}
		return *report
	}
	defer session.Close()
	report.set("launch", ACPCheckPass, "")
	report.set("initialize", ACPCheckPass, "")
	report.set("session", ACPCheckPass, "")

	output, promptErr, completionErr := runACPConformanceTurn(ctx, session, "Reply with a short ACP conformance response.", nil)
	if promptErr != nil {
		report.set("prompt", ACPCheckFail, promptErr.Error())
		report.skipRemaining(allAfter("prompt"), "prompt submission did not complete")
		return *report
	}
	report.set("prompt", ACPCheckPass, "")
	if output == "" {
		report.set("output", ACPCheckFail, "text turn ended without assistant output")
	} else {
		report.set("output", ACPCheckPass, "")
	}
	if completionErr != nil {
		report.set("completion", ACPCheckFail, completionErr.Error())
	} else {
		report.set("completion", ACPCheckPass, "")
	}
	if !report.passed("output") || !report.passed("completion") {
		report.skipRemaining(allAfter("completion"), "baseline text turn did not complete")
		return *report
	}

	runACPOptionalChecks(ctx, report, session, launch)
	return *report
}

func runACPConformanceTurn(ctx context.Context, session *ACPSession, text string, images []sdk.ImageContent) (string, error, error) {
	before := len(session.Timeline())
	if err := session.Prompt(ctx, text, images); err != nil {
		return "", err, nil
	}
	turnCtx, cancel := context.WithTimeout(ctx, acpConformanceTurnTimeout)
	completionErr := session.WaitForFinish(turnCtx)
	cancel()
	if completionErr != nil {
		abortCtx, abortCancel := context.WithTimeout(context.Background(), 2*time.Second)
		_ = session.Abort(abortCtx)
		abortCancel()
	}
	for _, entry := range session.Timeline()[before:] {
		if entry.Item.Type == "assistant_message" && strings.TrimSpace(entry.Item.Text) != "" {
			return entry.Item.Text, nil, completionErr
		}
	}
	return "", nil, completionErr
}

func runACPOptionalChecks(
	ctx context.Context,
	report *ACPConformanceReport,
	session *ACPSession,
	launch func(context.Context, string) (*ACPSession, error),
) {
	if acpSupportsImages(session.agentCapabilities) {
		output, promptErr, completionErr := runACPConformanceTurn(ctx, session, "Inspect this small image and reply briefly.", []sdk.ImageContent{{
			Type: "image", Data: acpConformanceImage, MimeType: "image/png",
		}})
		switch {
		case promptErr != nil:
			report.set("image", ACPCheckFail, promptErr.Error())
		case completionErr != nil:
			report.set("image", ACPCheckFail, completionErr.Error())
		case output == "":
			report.set("image", ACPCheckFail, "image turn ended without assistant output")
		default:
			report.set("image", ACPCheckPass, "")
		}
	} else {
		report.set("image", ACPCheckSkip, "image input was not advertised")
	}

	runACPSelectionCheck(ctx, report, session, "model")
	runACPSelectionCheck(ctx, report, session, "mode")
	runACPSelectionCheck(ctx, report, session, "thinking")

	if _, err := acpResumeMethod(session.agentCapabilities); err != nil {
		report.set("continuation", ACPCheckSkip, "session load or resume was not advertised")
	} else {
		state, stateErr := session.GetState(ctx)
		// A single ACP process owns the native session. Close it before opening the continuation
		// process so implementations with single-client session stores cannot deadlock.
		_ = session.Close()
		continuationCtx, cancel := context.WithTimeout(ctx, acpConformanceStartupTimeout)
		var continued *ACPSession
		var err error
		if stateErr == nil && state.SessionID != "" {
			continued, err = launch(continuationCtx, state.SessionID)
		} else if stateErr != nil {
			err = stateErr
		} else {
			err = errors.New("created ACP session has no sessionId")
		}
		cancel()
		if err != nil {
			report.set("continuation", ACPCheckFail, err.Error())
		} else {
			output, promptErr, completionErr := runACPConformanceTurn(ctx, continued, "Reply after continuing this ACP session.", nil)
			_ = continued.Close()
			switch {
			case promptErr != nil:
				report.set("continuation", ACPCheckFail, promptErr.Error())
			case completionErr != nil:
				report.set("continuation", ACPCheckFail, completionErr.Error())
			case output == "":
				report.set("continuation", ACPCheckFail, "continued turn ended without assistant output")
			default:
				report.set("continuation", ACPCheckPass, "")
			}
		}
	}

}

func runACPSelectionCheck(ctx context.Context, report *ACPConformanceReport, session *ACPSession, kind string) {
	values := acpSelectionValues(session, kind)
	if len(values) == 0 {
		report.set(kind, ACPCheckSkip, kind+" catalog was not returned")
		return
	}
	if len(values) == 1 {
		report.set(kind, ACPCheckSkip, kind+" catalog has no alternative to select")
		return
	}
	session.mu.Lock()
	currentValue := session.model
	switch kind {
	case "mode":
		currentValue = session.modeID
	case "thinking":
		currentValue = session.thinking
	}
	if negotiated := session.negotiatedSelections[kind]; negotiated != "" {
		currentValue = negotiated
	}
	beforeRevision := session.negotiatedSelectionRevisions[kind]
	session.mu.Unlock()
	selectedValue := ""
	for _, candidate := range values {
		if candidate != currentValue {
			selectedValue = candidate
			break
		}
	}
	if selectedValue == "" {
		report.set(kind, ACPCheckFail, kind+" catalog has no value different from the current selection")
		return
	}
	rpcCtx, cancel := context.WithTimeout(ctx, acpConformanceRPCTimeout)
	defer cancel()
	var err error
	switch kind {
	case "model":
		_, err = session.SetModel(rpcCtx, session.provider, selectedValue)
	case "mode":
		err = session.SetMode(rpcCtx, selectedValue)
	case "thinking":
		err = session.SetThinkingLevel(rpcCtx, selectedValue)
	}
	if err != nil {
		report.set(kind, ACPCheckFail, err.Error())
		return
	}
	// Setters retain their interactive optimistic state. Conformance only passes when the agent
	// confirms the same value through a negotiation response or session/update notification.
	deadline := time.NewTimer(time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		session.mu.Lock()
		confirmed := session.negotiatedSelectionRevisions[kind] > beforeRevision &&
			session.negotiatedSelections[kind] == selectedValue
		session.mu.Unlock()
		if confirmed {
			report.set(kind, ACPCheckPass, "")
			return
		}
		select {
		case <-deadline.C:
			report.set(kind, ACPCheckFail, fmt.Sprintf("agent did not confirm %s selection %q in negotiated state", kind, selectedValue))
			return
		case <-ticker.C:
		}
	}
}

func acpSelectionValues(session *ACPSession, kind string) []string {
	session.mu.Lock()
	defer session.mu.Unlock()
	if kind == "model" && len(session.nativeModels) > 0 {
		values := make([]string, 0, len(session.nativeModels))
		for _, model := range session.nativeModels {
			values = append(values, model.ID)
		}
		return values
	}
	if kind == "mode" && len(session.nativeModes) > 0 {
		values := make([]string, 0, len(session.nativeModes))
		for _, mode := range session.nativeModes {
			values = append(values, mode.ID)
		}
		return values
	}
	category := kind
	if kind == "thinking" {
		category = "thought_level"
	}
	for _, raw := range session.configOptions {
		option, _ := raw.(map[string]any)
		optionCategory, _ := option["category"].(string)
		id, _ := option["id"].(string)
		if optionCategory != category && id != category {
			continue
		}
		var values []string
		options, _ := option["options"].([]any)
		for _, rawValue := range options {
			switch value := rawValue.(type) {
			case string:
				if strings.TrimSpace(value) != "" {
					values = append(values, value)
				}
			case map[string]any:
				id, _ := value["value"].(string)
				if id == "" {
					id, _ = value["id"].(string)
				}
				if strings.TrimSpace(id) != "" {
					values = append(values, id)
				}
			}
		}
		return values
	}
	return nil
}

func acpConformanceEnvironment(providerConfig map[string]any) []string {
	env := os.Environ()
	overrides, _ := providerConfig["env"].(map[string]any)
	for key, raw := range overrides {
		value, ok := raw.(string)
		if !ok || strings.TrimSpace(key) == "" {
			continue
		}
		filtered := env[:0]
		for _, entry := range env {
			name, _, _ := strings.Cut(entry, "=")
			if name == key || runtime.GOOS == "windows" && strings.EqualFold(name, key) {
				continue
			}
			filtered = append(filtered, entry)
		}
		env = append(filtered, key+"="+value)
	}
	return env
}
