package providers

import (
	"fmt"
	"strings"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

// The default turn's scripted content.
//
// Ported verbatim from mock-load-test-agent.ts. The text is not decoration: specs assert on
// "Cycle 1", on the tool-call badges the cycle produces, and on the nested codemode rows folding
// under their parent. Changing a paragraph changes what those specs can see.

const mockSyntheticStreamEnd = "\n\n_(end of synthetic stream)_\n"

// mockCycleEvent is one step of a cycle's queue.
type mockCycleEvent struct {
	Kind string // assistant_token | reasoning_token | tool_running | tool_completed | usage

	Text     string
	CallID   string
	Name     string
	Detail   map[string]any
	Metadata map[string]any
}

func mockIntroParagraph(cycle int) string {
	return strings.Join([]string{
		fmt.Sprintf("## Cycle %d", cycle),
		"",
		"I'll take a look at the scroll anchor behavior you described. Let me start by walking through how the conversation list currently handles streaming updates and where the auto-scroll logic actually lives. My instinct is that the anchor is supposed to pin to the bottom only when the user is already there, but I want to confirm that against the code rather than guess. This kind of behavior is usually a thin layout effect over a ref, and the bugs tend to come from event ordering rather than the math itself, so the first useful step is to read the relevant files.",
	}, "\n")
}

func mockReasoningText() string {
	return "Need to find the scroll container, the layout effect that watches for new messages, and any gesture handler that might fight with programmatic scrolling. Probably a ref on the FlatList plus a near-bottom threshold."
}

// mockLongReasoningText is the extra reasoning repeated per cycle when mockReasoningText is set.
func mockLongReasoningText() string {
	return strings.Join([]string{
		"Tracing the stream pipeline: tokens arrive coalesced, so per-frame work must stay bounded.",
		"The reveal pacing lives in the text-reveal module; the scroll pin has to respect its cuts.",
		"A content-size observer is the only reliable growth signal across web and native runtimes.",
		"Guard the pin with a near-bottom check so a reading user is never yanked back to the tail.",
		"Pin the detail scroll to its tail on growth; release as soon as the reader scrolls up.",
	}, " ")
}

func mockMidParagraph() string {
	return strings.Join([]string{
		"Now I have a clearer picture. The auto-scroll uses a ref on the FlatList and tracks whether the user has scrolled away from the bottom by comparing the offset against the content size. There are a few subtle issues worth flagging before we change anything:",
		"",
		"- The threshold for 'near the bottom' is hardcoded at 80px, which feels too tight on dense content where headers and tool calls take up a lot of vertical space.",
		"- We rely on `onContentSizeChange` to detect new content, but that fires after layout, not as the streaming delta arrives, so we end up scrolling one frame late on fast streams.",
		"- The gesture handler does not pause scroll-to-bottom while the user is actively dragging, which means a drag in progress can be visually overridden mid-frame.",
		"- Coalescing happens upstream, so the FlatList sees fewer updates than the wire — but each batch can still cause a relayout.",
		"",
		"Let me make a small adjustment to the threshold and add a flag for active gestures, then run a quick command to confirm the order of events when streaming is fast.",
	}, "\n")
}

func mockClosingParagraph() string {
	return "The change should keep scroll-to-bottom working when the user is at the bottom while not yanking the viewport when they are reading earlier messages. The bash output confirms the `userIsAtBottom` flag flips correctly during a simulated streaming burst, and the gesture flag suppresses scroll while a drag is active. If you want, I can follow up with a regression test that drives the FlatList with synthetic deltas at high frequency to lock in the behavior. For now, I'll stop here so you can take a look."
}

func mockEditDiff(filePath string) string {
	return strings.Join([]string{
		fmt.Sprintf("diff --git a/%s b/%s", filePath, filePath),
		fmt.Sprintf("--- a/%s", filePath),
		fmt.Sprintf("+++ b/%s", filePath),
		"@@ -42,7 +42,9 @@",
		"   const ref = useRef<FlatList>(null);",
		"   const [userIsAtBottom, setUserIsAtBottom] = useState(true);",
		"-  const NEAR_BOTTOM_PX = 80;",
		"+  const NEAR_BOTTOM_PX = 160;",
		"+  const isDraggingRef = useRef(false);",
		"",
		"-  if (userIsAtBottom) ref.current?.scrollToEnd({ animated: true });",
		"+  if (userIsAtBottom && !isDraggingRef.current) {",
		"+    ref.current?.scrollToEnd({ animated: true });",
		"+  }",
	}, "\n")
}

// mockTokenize breaks text into the sub-word pieces the stream emits.
//
// Words of five characters or fewer stay whole; longer ones split into a leading four-character
// piece and then four-character runs. This is the frame count the coalescing and paced-reveal
// specs measure against — splitting on spaces alone emits an order of magnitude fewer frames and
// every measurement built on them goes wrong.
func mockTokenize(text string) []string {
	var tokens []string
	runes := []rune(text)
	index := 0
	for index < len(runes) {
		leading := 0
		for index+leading < len(runes) && isMockSpace(runes[index+leading]) {
			leading++
		}
		if leading > 0 {
			start := index
			index += leading
			if index >= len(runes) || isMockSpace(runes[index]) {
				// A whitespace-only run reaches the end of the text.
				tokens = append(tokens, string(runes[start:index]))
				continue
			}
			// Leading whitespace travels with the word that follows it.
			word := index
			for word < len(runes) && !isMockSpace(runes[word]) {
				word++
			}
			if word-index <= 5 {
				tokens = append(tokens, string(runes[start:word]))
			} else {
				tokens = append(tokens, string(runes[start:index+4]))
				for cut := index + 4; cut < word; cut += 4 {
					end := cut + 4
					if end > word {
						end = word
					}
					tokens = append(tokens, string(runes[cut:end]))
				}
			}
			index = word
			continue
		}
		word := index
		for word < len(runes) && !isMockSpace(runes[word]) {
			word++
		}
		if word-index <= 5 {
			tokens = append(tokens, string(runes[index:word]))
		} else {
			tokens = append(tokens, string(runes[index:index+4]))
			for cut := index + 4; cut < word; cut += 4 {
				end := cut + 4
				if end > word {
					end = word
				}
				tokens = append(tokens, string(runes[cut:end]))
			}
		}
		index = word
	}
	return tokens
}

func isMockSpace(r rune) bool {
	return r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == '\v' || r == '\f'
}

// mockCodemodeScript is the script the cycle's codemode call runs. Its three nested calls are what
// nested-codemode-rows.spec.ts asserts on, by file and by command.
func mockCodemodeScript() string {
	return strings.Join([]string{
		"// Run verification script via Code Mode",
		"const testFiles = await tools.find({ pattern: '*.test.ts' });",
		"const config = await tools.read({ path: 'packages/app/src/tool-calls/detail-level/nested-codemode.ts' });",
		"const testResult = await tools.bash({ command: 'npx vitest run --bail=1' });",
		"return { testCount: testFiles.length, passed: testResult.exitCode === 0 };",
	}, "\n")
}

// buildMockCycleQueue is one cycle of the default stream: prose, reasoning, a read, a grep, an
// edit, a shell command, a codemode call with its three nested calls, closing prose, then usage.
func buildMockCycleQueue(turnID string, cycle int, reasoningRepeat int) []mockCycleEvent {
	queue := make([]mockCycleEvent, 0, 64)

	pushTokens := func(text, kind string) {
		for _, token := range mockTokenize(text) {
			queue = append(queue, mockCycleEvent{Kind: kind, Text: token})
		}
	}
	pushTokens(mockIntroParagraph(cycle), "assistant_token")

	repeat := reasoningRepeat
	if repeat < 1 {
		repeat = 1
	}
	parts := make([]string, 0, repeat)
	for index := 0; index < repeat; index++ {
		part := mockReasoningText()
		if reasoningRepeat > 1 {
			part += " " + mockLongReasoningText()
		}
		parts = append(parts, part)
	}
	pushTokens(strings.Join(parts, " "), "reasoning_token")

	readDetail := map[string]any{
		"type":     "read",
		"filePath": "packages/app/src/components/conversation-list.tsx",
	}
	readID := fmt.Sprintf("%s:read:%d", turnID, cycle)
	queue = append(queue,
		mockCycleEvent{Kind: "tool_running", CallID: readID, Name: "read", Detail: readDetail},
		mockCycleEvent{
			Kind: "tool_completed", CallID: readID, Name: "read",
			Detail: mergeMockDetail(readDetail, map[string]any{
				"content": "export function ConversationList() {\n  const ref = useRef<FlatList>(null);\n  // ...\n}",
			}),
		},
	)

	grepDetail := map[string]any{
		"type":     "search",
		"query":    "scrollToEnd",
		"toolName": "grep",
		"mode":     "files_with_matches",
	}
	grepID := fmt.Sprintf("%s:grep:%d", turnID, cycle)
	queue = append(queue,
		mockCycleEvent{Kind: "tool_running", CallID: grepID, Name: "grep", Detail: grepDetail},
		mockCycleEvent{
			Kind: "tool_completed", CallID: grepID, Name: "grep",
			Detail: mergeMockDetail(grepDetail, map[string]any{
				"filePaths": []string{
					"packages/app/src/components/conversation-list.tsx",
					"packages/app/src/hooks/use-scroll-anchor.ts",
				},
				"numFiles":   2,
				"numMatches": 5,
			}),
		},
	)

	pushTokens(mockMidParagraph(), "assistant_token")

	editFile := "packages/app/src/hooks/use-scroll-anchor.ts"
	editDetail := map[string]any{
		"type":        "edit",
		"filePath":    editFile,
		"oldString":   "const NEAR_BOTTOM_PX = 80;",
		"newString":   "const NEAR_BOTTOM_PX = 160;",
		"unifiedDiff": mockEditDiff(editFile),
	}
	editID := fmt.Sprintf("%s:edit:%d", turnID, cycle)
	queue = append(queue,
		mockCycleEvent{Kind: "tool_running", CallID: editID, Name: "edit", Detail: editDetail},
		mockCycleEvent{Kind: "tool_completed", CallID: editID, Name: "edit", Detail: editDetail},
	)

	shellDetail := map[string]any{
		"type":     "shell",
		"command":  "node scripts/simulate-stream-burst.mjs",
		"cwd":      "/tmp/byspace-mock-load",
		"output":   "[burst] tick 1 userIsAtBottom=true\n[burst] tick 2 userIsAtBottom=true\n[burst] drag-start isDragging=true\n[burst] tick 3 suppressed\n[burst] drag-end isDragging=false\n",
		"exitCode": 0,
	}
	shellID := fmt.Sprintf("%s:bash:%d", turnID, cycle)
	queue = append(queue,
		mockCycleEvent{Kind: "tool_running", CallID: shellID, Name: "bash", Detail: shellDetail},
		mockCycleEvent{Kind: "tool_completed", CallID: shellID, Name: "bash", Detail: shellDetail},
	)

	codemodeID := fmt.Sprintf("%s:codemode:%d", turnID, cycle)
	codemodeDetail := map[string]any{
		"type":   "unknown",
		"input":  map[string]any{"code": mockCodemodeScript()},
		"output": nil,
	}
	queue = append(queue, mockCycleEvent{
		Kind: "tool_running", CallID: codemodeID, Name: "codemode", Detail: codemodeDetail,
	})

	nestedCalls := []struct {
		suffix          string
		name            string
		detail          map[string]any
		completedDetail map[string]any
	}{
		{
			suffix: "0",
			name:   "find",
			detail: map[string]any{"type": "search", "query": "*.test.ts", "toolName": "glob"},
			completedDetail: map[string]any{
				"type": "search", "query": "*.test.ts", "toolName": "glob",
				"filePaths": []string{
					"packages/app/src/agent-stream/view.test.tsx",
					"packages/app/src/tool-calls/detail-level/nested-codemode.test.ts",
				},
				"numFiles": 2,
			},
		},
		{
			suffix: "1",
			name:   "read",
			detail: map[string]any{
				"type":     "read",
				"filePath": "packages/app/src/tool-calls/detail-level/nested-codemode.ts",
			},
			completedDetail: map[string]any{
				"type":     "read",
				"filePath": "packages/app/src/tool-calls/detail-level/nested-codemode.ts",
				"content":  "export interface NestedCodemodeProjection {\n  tail: StreamItem[];\n  head: StreamItem[] | null;\n  groupsByParentItemId: Map<string, OverviewToolCallGroup>;\n}",
			},
		},
		{
			suffix: "2",
			name:   "bash",
			detail: map[string]any{"type": "shell", "command": "npx vitest run --bail=1", "cwd": "/tmp/byspace-mock-load"},
			completedDetail: map[string]any{
				"type": "shell", "command": "npx vitest run --bail=1", "cwd": "/tmp/byspace-mock-load",
				"output": "✓ 2 tests passed (450ms)\n", "exitCode": 0,
			},
		},
	}
	for _, nested := range nestedCalls {
		// parentToolCallId is what folds these under the codemode row instead of presenting them as
		// calls the agent made on its own.
		metadata := map[string]any{"parentToolCallId": codemodeID}
		callID := fmt.Sprintf("%s/%s", codemodeID, nested.suffix)
		queue = append(queue,
			mockCycleEvent{Kind: "tool_running", CallID: callID, Name: nested.name, Detail: nested.detail, Metadata: metadata},
			mockCycleEvent{Kind: "tool_completed", CallID: callID, Name: nested.name, Detail: nested.completedDetail, Metadata: metadata},
		)
	}
	queue = append(queue, mockCycleEvent{
		Kind: "tool_completed", CallID: codemodeID, Name: "codemode",
		Detail: mergeMockDetail(codemodeDetail, map[string]any{
			"output": map[string]any{
				"content": []map[string]any{
					{"type": "text", "text": "{\n  \"testCount\": 2,\n  \"passed\": true\n}"},
				},
			},
		}),
		Metadata: map[string]any{
			// The parent badge reads its counts from here, not from counting the children.
			"nestedSummary": map[string]any{
				"editedFileCount":  0,
				"commandCount":     1,
				"readFileCount":    1,
				"searchCount":      1,
				"otherToolCount":   0,
				"byspaceCallCount": 0,
			},
		},
	})

	pushTokens(mockClosingParagraph(), "assistant_token")
	queue = append(queue, mockCycleEvent{Kind: "usage"})
	return queue
}

// buildMockBurstyQueue is the bursty model's cycle: prose only, with no tools, so the arrival
// pattern is the only variable under measurement.
func buildMockBurstyQueue(cycle int) []mockCycleEvent {
	joined := strings.Join([]string{mockIntroParagraph(cycle), mockMidParagraph(), mockClosingParagraph()}, "\n\n")
	events := make([]mockCycleEvent, 0, 64)
	for _, token := range mockTokenize(joined) {
		events = append(events, mockCycleEvent{Kind: "assistant_token", Text: token})
	}
	return events
}

// nextMockBurstSize picks how many tokens arrive together.
//
// A deterministic hash of the burst index rather than a random draw, so a run is reproducible.
func nextMockBurstSize(profile *MockBurstProfile, sequence int) int {
	hash := uint32(sequence+1) * 2654435761
	hash ^= hash >> 15
	hash *= 2246822519
	hash ^= hash >> 13
	minimum := profile.MinTokens
	if minimum < 1 {
		minimum = 1
	}
	maximum := profile.MaxTokens
	if maximum < minimum {
		maximum = minimum
	}
	span := uint32(maximum-minimum) + 1
	return minimum + int(hash%span)
}

func mergeMockDetail(base, extra map[string]any) map[string]any {
	merged := make(map[string]any, len(base)+len(extra))
	for key, value := range base {
		merged[key] = value
	}
	for key, value := range extra {
		merged[key] = value
	}
	return merged
}

// mockToolCallItem renders a cycle event's tool step as a timeline item.
func mockToolCallItem(event mockCycleEvent, status string) sdk.TimelineItem {
	return sdk.TimelineItem{
		Type:     "tool_call",
		CallID:   event.CallID,
		Name:     event.Name,
		Status:   status,
		Detail:   event.Detail,
		Metadata: event.Metadata,
	}
}
