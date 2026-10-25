package sdk

import (
	"strconv"
	"strings"
)

// BuildSubagentSubtitle composes the one-liner shown under a subagent's title.
//
// Ported from claude/subagents/presentation.ts. The parts are the title, the model's display
// label, the reasoning effort and the token count, joined with " · " and skipping whatever is
// missing. An empty result must be nil, not an empty string: the client renders a blank subtitle
// row otherwise.
func BuildSubagentSubtitle(title, model, effort *string, totalTokens *int64) *string {
	parts := make([]string, 0, 4)
	appendPart := func(value string) {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			parts = append(parts, trimmed)
		}
	}

	if title != nil {
		appendPart(*title)
	}
	if model != nil {
		appendPart(*model)
	}
	if effort != nil {
		appendPart(*effort)
	}
	if totalTokens != nil && *totalTokens > 0 {
		appendPart(formatTokens(*totalTokens))
	}

	if len(parts) == 0 {
		return nil
	}
	joined := strings.Join(parts, " · ")
	return &joined
}

// formatTokens renders a token count compactly: 1.2k, 34k, 1.5M.
//
// Full counts ("15359 tokens") push the model and effort off the row in the Subagents panel,
// which is a narrow list.
func formatTokens(tokens int64) string {
	switch {
	case tokens < 1000:
		return strconv.FormatInt(tokens, 10) + " tok"
	case tokens < 1000000:
		return trimZero(float64(tokens)/1000) + "k tok"
	default:
		return trimZero(float64(tokens)/1000000) + "M tok"
	}
}

// trimZero formats with one decimal, dropping a trailing ".0".
func trimZero(value float64) string {
	formatted := strconv.FormatFloat(value, 'f', 1, 64)
	return strings.TrimSuffix(formatted, ".0")
}

// RefreshSubagentSubtitle recomputes a descriptor's subtitle from its raw facts.
//
// Called after any event that fills in a previously-missing value, so the subtitle grows from
// "check the logs" to "check the logs · Sonnet · high · 12.3k tok" as the subagent reports.
func RefreshSubagentSubtitle(descriptor *SubagentDescriptor) {
	descriptor.Subtitle = BuildSubagentSubtitle(descriptor.Title, descriptor.Model, descriptor.Effort, descriptor.TotalTokens)
}
