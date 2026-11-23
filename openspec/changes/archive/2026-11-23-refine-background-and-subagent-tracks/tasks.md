# Tasks

## 1. Background activity view state and rows

- [x] 1.1 Build a single background-track view state from the normalized provider activity model; verify unit tests cover zero-active visibility, active badge counts, completed-row removal, unresolved stops, and stale-list retention.
- [x] 1.2 Replace terminal-style rows with two-line semantic title/metadata presentation and horizontal overflow treatment; verify component tests cover description/command fallbacks, long titles, elapsed time, and normal typography.
- [x] 1.3 Implement row-scoped stopping, success removal, failure retry/dismiss, and list retry; verify asynchronous tests prove duplicate stops are blocked and other rows are unaffected.
- [x] 1.4 Remove pane-focus-dependent visibility and keep the trigger available whenever actionable work exists; verify agent-panel tests with an unfocused pane.

## 2. Shared tracks and subagents

- [x] 2.1 Add ArrowUp/ArrowDown/Home/End roving focus, nonshrinking pills, and overflow fades to the shared tracks popover; verify browser tests cover arrows, Tab, Enter/Space, Escape, outside dismissal, and focus restoration.
- [x] 2.2 Refine subagent rows with title/facts/progress and CSS hover/focus actions while keeping compact actions visible; verify wide and compact component tests plus accessible long-title labels.
- [x] 2.3 Preserve managed-child and provider-native opening, pagination, and finished-child archive/retry behavior; verify navigation tests use the correct target IDs and archive only the selected child.

## 3. AskUser text selection

- [x] 3.1 Add select-text to questionnaire titles while leaving choice labels select-none; verify a regression test under the agent stream's select-none ancestor covers title copying and unchanged pointer/keyboard choice behavior.

## 4. Integration verification

- [x] 4.1 Run the touched web Vitest/browser tests and capture wide and compact UI evidence for empty, active, stopping, failed-stop, stale-list, native-subagent, and AskUser states.
- [x] 4.2 Run npm run typecheck, npm run lint, and npm run format:check for the completed UI change and resolve any regressions it introduced.
