package providers

import (
	"regexp"
	"strconv"
	"strings"
)

// The mock provider's prompt vocabulary.
//
// Ported from mock-load-test-agent.ts. Every regex here exists because a Playwright spec sends that phrase and then
// asserts on the resulting behaviour — the permission dialog appearing, the turn failing, N stream updates arriving.
// Changing a pattern changes a test contract, not an implementation detail.
var (
	mockPlanApprovalPattern = regexp.MustCompile(`(?i)emit\s+(?:a\s+)?synthetic\s+plan\s+approval`)
	mockTurnFailurePattern  = regexp.MustCompile(`(?i)emit\s+(?:a\s+)?synthetic\s+turn\s+failure`)
	mockCustomMsgPattern    = regexp.MustCompile(`(?i)emit\s+(?:a\s+)?synthetic\s+custom\s+message`)
	mockNotificationPattern = regexp.MustCompile(`(?i)emit\s+(?:a\s+)?synthetic\s+notification`)
	mockTodoPattern         = regexp.MustCompile(`(?i)emit\s+(?:a\s+)?synthetic\s+(?:todowrite|tool\s*call\s+todo)`)
	mockQuestionsPattern    = regexp.MustCompile(`(?i)emit\s+(?:a\s+)?synthetic\s+questions?`)
	mockFreeWritePattern    = regexp.MustCompile(`(?i)free[-\s]?write|freeform|text[-\s]?only`)
	// mockStreamUpdatesPattern drives the streaming/coalescing specs: it asks for a fixed number of updates so a
	// test can assert the client coalesced them into the expected number of frames. The plural "updates" is
	// load-bearing: "emit 1 ... update" (singular) deliberately does not match and falls through to the default
	// cycle stream, which is how provider-usage-tooltip starts a long turn.
	mockStreamUpdatesPattern = regexp.MustCompile(`(?i)emit\s+(\d+)\s+(coalesced\s+)?agent stream updates`)
	mockUserMsgBeforeTurn    = regexp.MustCompile(`(?i)emit\s+synthetic\s+user\s+message\s+before\s+accepting\s+turn`)
	mockWithholdUserMsg      = regexp.MustCompile(`(?i)withhold\s+synthetic\s+user\s+message\s+until\s+interrupted`)
	mockAssistantBeforeUser  = regexp.MustCompile(`(?i)emit\s+(\d+)\s+assistant\s+messages\s+before\s+synthetic\s+user\s+message`)
	mockImageMarkdown        = regexp.MustCompile(`(?i)^emit settled assistant image markdown:\s*(!\[[^\]\r\n]*\]\(.+\))\s*$`)
	// mockUserDelayPattern delays the echoed user message. The delay matters beyond pacing: while it is
	// running the turn has not started, which is the window where "interrupt before the first turn" lives.
	mockUserDelayPattern = regexp.MustCompile(`(?i)delay\s+synthetic\s+user\s+message\s+by\s+(\d+)\s*ms`)
	// mockSteeringReplayPattern replays a provider-shaped foreground shell tool call inside one turn.
	mockSteeringReplayPattern = regexp.MustCompile(`(?i)replay a (claude|codex)-shaped foreground shell tool call`)
	// mockLargePayloadPattern asks for a single large timeline item of a given byte size and kind.
	mockLargePayloadPattern = regexp.MustCompile(`(?i)emit\s+(\d+)\s+(?:byte\s+)?(?:large\s+)?(diff|file|image)\s+agent stream (?:update|payload)`)
)

// MockDirectives is what a prompt asks the scripted provider to do.
type MockDirectives struct {
	PlanApproval      bool
	TurnFailure       bool
	CustomMessage     bool
	Notification      bool
	ToolCallTodo      bool
	Questions         bool
	QuestionFreeWrite bool
	UserMessageFirst  bool
	// WithholdUserMessage keeps the turn running without echoing the prompt, so a spec can interrupt
	// before the provider ever acknowledges the message.
	WithholdUserMessage bool
	AssistantBeforeUser int
	// StreamUpdates is the number of stream updates to emit; 0 means "not a stress prompt".
	StreamUpdates int
	// StreamCoalesced distinguishes the stress shapes: coalesced emits assistant messages, otherwise
	// the updates arrive as todo items.
	StreamCoalesced bool
	// ImageMarkdown is a settled assistant message carrying an image.
	ImageMarkdown string
	// UserMessageDelayMs delays the echoed user message, capped so a spec cannot park a turn for minutes.
	UserMessageDelayMs int
	// SteeringReplay is "" | "claude" | "codex".
	SteeringReplay string
	// LargePayloadBytes/LargePayloadKind describe a single oversized timeline item; kind is "" when absent.
	LargePayloadBytes int
	LargePayloadKind  string
	// StructuredBranch asks for a JSON {title, branch} response, the workspace auto-name path.
	StructuredBranch bool
}

// ParseMockDirectives reads the phrases a prompt uses to steer the scripted provider.
func ParseMockDirectives(prompt string) MockDirectives {
	text := strings.TrimSpace(prompt)
	directives := MockDirectives{
		PlanApproval:        mockPlanApprovalPattern.MatchString(text),
		TurnFailure:         mockTurnFailurePattern.MatchString(text),
		CustomMessage:       mockCustomMsgPattern.MatchString(text),
		Notification:        mockNotificationPattern.MatchString(text),
		ToolCallTodo:        mockTodoPattern.MatchString(text),
		Questions:           mockQuestionsPattern.MatchString(text),
		UserMessageFirst:    mockUserMsgBeforeTurn.MatchString(text),
		WithholdUserMessage: mockWithholdUserMsg.MatchString(text),
		StructuredBranch:    isStructuredBranchPrompt(text),
	}
	if directives.Questions {
		directives.QuestionFreeWrite = mockFreeWritePattern.MatchString(text)
	}
	if match := mockStreamUpdatesPattern.FindStringSubmatch(text); match != nil {
		if count, err := strconv.Atoi(match[1]); err == nil && count > 0 {
			if count > 5000 {
				count = 5000
			}
			directives.StreamUpdates = count
			directives.StreamCoalesced = strings.TrimSpace(match[2]) != ""
		}
	}
	if match := mockAssistantBeforeUser.FindStringSubmatch(text); match != nil {
		if count, err := strconv.Atoi(match[1]); err == nil && count > 0 {
			if count > 500 {
				count = 500
			}
			directives.AssistantBeforeUser = count
		}
	}
	if match := mockImageMarkdown.FindStringSubmatch(text); match != nil {
		directives.ImageMarkdown = match[1]
	}
	if match := mockUserDelayPattern.FindStringSubmatch(text); match != nil {
		if delay, err := strconv.Atoi(match[1]); err == nil && delay > 0 {
			if delay > 2000 {
				delay = 2000
			}
			directives.UserMessageDelayMs = delay
		}
	}
	if match := mockSteeringReplayPattern.FindStringSubmatch(text); match != nil {
		directives.SteeringReplay = strings.ToLower(match[1])
	}
	if match := mockLargePayloadPattern.FindStringSubmatch(text); match != nil {
		if bytes, err := strconv.Atoi(match[1]); err == nil && bytes > 0 {
			if bytes > 1_000_000 {
				bytes = 1_000_000
			}
			directives.LargePayloadBytes = bytes
			directives.LargePayloadKind = strings.ToLower(match[2])
		}
	}
	return directives
}

// isStructuredBranchPrompt matches the workspace auto-name request: the daemon asks the agent for a
// title and a git branch name as JSON. Node keys on the instruction text plus the field names.
func isStructuredBranchPrompt(text string) bool {
	hasBranchNamePrompt := strings.Contains(text, "Generate a title and a git branch name for a coding agent") &&
		(strings.Contains(text, "Return JSON only with fields 'title' and 'branch'.") ||
			strings.Contains(text, `"title"`) ||
			strings.Contains(text, `"branch"`))
	if hasBranchNamePrompt {
		return true
	}
	return strings.Contains(text, "You must respond with JSON only that matches this JSON Schema") &&
		strings.Contains(text, `"title"`) &&
		strings.Contains(text, `"branch"`)
}

// hasAny reports whether a prompt asked for anything scripted.
func (d MockDirectives) hasAny() bool {
	return d.PlanApproval || d.TurnFailure || d.CustomMessage || d.Notification || d.ToolCallTodo ||
		d.Questions || d.UserMessageFirst || d.WithholdUserMessage || d.AssistantBeforeUser > 0 ||
		d.StreamUpdates > 0 || d.ImageMarkdown != "" || d.UserMessageDelayMs > 0 ||
		d.SteeringReplay != "" || d.LargePayloadKind != "" || d.StructuredBranch
}
