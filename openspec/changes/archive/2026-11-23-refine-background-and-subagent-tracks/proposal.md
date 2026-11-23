# Proposal

## Why

The background-work popover uses terminal-like rows for semantic status, keeps finished work under a running-only badge, and makes row actions hard to scan. Subagent rows and keyboard behavior do not yet match the reference interaction model, and AskUser question text inherits an ancestor's selection ban.

## What Changes

- Hide the Background trigger when there is no active or temporarily unresolved work, and present active work with readable titles, secondary facts, status, and elapsed time.
- Make stop row-scoped with stopping, success, failure/retry, stale-list retry, and unresolved-stop dismissal states.
- Keep existing managed-child and provider-native subagent timeline navigation while refining row hierarchy, progress, and actions.
- Add horizontal overflow treatment and ArrowUp/ArrowDown/Home/End navigation to the shared tracks popover using the existing shadcn components.
- Allow AskUser question titles to be selected and copied without making choice controls selectable text.
- Preserve compact-form-factor behavior, focus management, Escape/outside dismissal, and the existing BySpace visual system.

## Capabilities

### New Capabilities

- `background-work-track`: Background trigger visibility, row presentation, and stop/error behavior.
- `subagent-track`: Subagent row hierarchy, progress, navigation, and actions.
- `agent-questionnaire`: Selectable question content and accessible choice interaction.

### Modified Capabilities

None; the repository has no main OpenSpec capability specs.

## Impact

- `web/src/composer/pi-background-terminal.tsx`, `web/src/composer/tracks.tsx`, `web/src/subagents/track.tsx`, and the agent-panel visibility condition.
- `web/src/ui/questionnaire.tsx` and its agent-stream consumer.
- Background activity supplied by `align-agent-provider-protocols`; no shell output or history will be invented where providers do not expose it.
- Component, keyboard, browser, and compact-layout tests.
