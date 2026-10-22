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
	mockTodoPattern         = regexp.MustCompile(`(?i)emit\s+(?:a\s+)?synthetic\s+(?:todowrite|tool\s*call\s*todo)`)
	mockQuestionsPattern    = regexp.MustCompile(`(?i)emit\s+(?:a\s+)?synthetic\s+questions?`)
	// mockStreamUpdatesPattern drives the streaming/coalescing specs: it asks for a fixed number of updates so a
	// test can assert the client coalesced them into the expected number of frames.
	mockStreamUpdatesPattern = regexp.MustCompile(`(?i)emit\s+(\d+)\s+(coalesced\s+)?agent\s+stream\s+updates`)
	mockUserMsgBeforeTurn    = regexp.MustCompile(`(?i)emit\s+synthetic\s+user\s+message\s+before\s+accepting\s+turn`)
	mockAssistantBeforeUser  = regexp.MustCompile(`(?i)emit\s+(\d+)\s+assistant\s+messages\s+before\s+synthetic\s+user\s+message`)
	mockImageMarkdown        = regexp.MustCompile(`(?i)^emit settled assistant image markdown:\s*(!\[[^\]\r\n]*\]\(.+\))\s*$`)
)

// MockDirectives is what a prompt asks the scripted provider to do.
type MockDirectives struct {
	PlanApproval        bool
	TurnFailure         bool
	CustomMessage       bool
	Notification        bool
	ToolCallTodo        bool
	Questions           bool
	UserMessageFirst    bool
	AssistantBeforeUser int
	// StreamUpdates is the number of assistant deltas to emit; 0 means "use the model's natural cadence".
	StreamUpdates int
	// ImageMarkdown is a settled assistant message carrying an image.
	ImageMarkdown string
}

// ParseMockDirectives reads the phrases a prompt uses to steer the scripted provider.
func ParseMockDirectives(prompt string) MockDirectives {
	text := strings.TrimSpace(prompt)
	directives := MockDirectives{
		PlanApproval:     mockPlanApprovalPattern.MatchString(text),
		TurnFailure:      mockTurnFailurePattern.MatchString(text),
		CustomMessage:    mockCustomMsgPattern.MatchString(text),
		Notification:     mockNotificationPattern.MatchString(text),
		ToolCallTodo:     mockTodoPattern.MatchString(text),
		Questions:        mockQuestionsPattern.MatchString(text),
		UserMessageFirst: mockUserMsgBeforeTurn.MatchString(text),
	}
	if match := mockStreamUpdatesPattern.FindStringSubmatch(text); match != nil {
		if count, err := strconv.Atoi(match[1]); err == nil && count > 0 {
			directives.StreamUpdates = count
		}
	}
	if match := mockAssistantBeforeUser.FindStringSubmatch(text); match != nil {
		if count, err := strconv.Atoi(match[1]); err == nil && count > 0 {
			directives.AssistantBeforeUser = count
		}
	}
	if match := mockImageMarkdown.FindStringSubmatch(text); match != nil {
		directives.ImageMarkdown = match[1]
	}
	return directives
}

// hasAny reports whether a prompt asked for anything scripted.
func (d MockDirectives) hasAny() bool {
	return d.PlanApproval || d.TurnFailure || d.CustomMessage || d.Notification || d.ToolCallTodo ||
		d.Questions || d.UserMessageFirst || d.AssistantBeforeUser > 0 || d.StreamUpdates > 0 ||
		d.ImageMarkdown != ""
}
