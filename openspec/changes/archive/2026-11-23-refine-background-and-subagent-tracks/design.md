# Design

## Context

The shared composer tracks use shadcn Popover and BySpace styling. Current background rows retain all terminal records while their badge counts only running records, and visibility can depend on pane focus. Subagent navigation already supports managed children and provider-native read-only timelines. Question text sits under `select-none` in the agent stream.

## Goals / Non-Goals

**Goals:**

- Present semantic activity with readable hierarchy and predictable asynchronous row states.
- Share keyboard and overflow behavior between background and subagent tracks.
- Reuse current navigation and provider data without introducing a second activity system.

**Non-Goals:**

- Port paseo's compact React Native bottom sheets or its component styling.
- Add shell output, history, or progress fields that providers cannot supply.
- Replace managed subagent tabs or provider-native timeline pagination.

## Decisions

### Derive trigger and rows from one view state

Active work drives the badge and trigger visibility. Finished rows leave the active list; a failed stop can keep its row temporarily with an inline error and retry/dismiss actions. A list failure retains the last rows with a retry affordance instead of clearing them. Visibility does not require keyboard focus in the agent pane.

### Use readable two-line activity rows

The primary line uses description, then command/kind as fallbacks, in normal UI typography. The secondary line shows a distinct command or metadata such as kind, status, and elapsed time. Stop belongs to one row, exposes a stopping state, and disables duplicate submission while pending. Long titles truncate and horizontal overflow gets fades rather than wrapping the whole popover into terminal text.

### Extend the existing tracks popover for keyboard navigation

Keep Popover, nested action buttons, Enter/Space activation, Escape/outside dismissal, and focus preservation. Add roving row focus for ArrowUp/ArrowDown/Home/End and nonshrinking trigger pills. Compact layouts keep actions visible; wider layouts reveal secondary actions with CSS group-hover/focus-within.

### Keep subagent opening behavior and refine only presentation

Rows use title plus factual metadata, progress where supplied, and Archive for finished managed children when progress or retry remains useful. Selecting a row follows the existing managed-child or provider-native timeline path.

### Opt question titles back into text selection

Add `select-text` to the shared questionnaire title. Choice labels and buttons remain `select-none` so dragging or clicking a choice does not accidentally select control text.

## Risks / Trade-offs

- [Provider activity fields differ] → Render fallbacks and consume the normalized model from the provider-parity change rather than adding provider-specific markup.
- [Roving focus can conflict with nested buttons] → Test Tab, arrows, Enter/Space, Escape, and focus restoration in browser tests.
- [Transient stopped rows can make a zero badge look inconsistent] → Keep only unresolved stop errors visible and remove successful/acknowledged stops immediately.

## Migration Plan

Implement view-state and component tests first, update the shared track and rows, then remove the focus-based visibility condition and add the questionnaire selection regression. Validate wide and compact layouts with browser evidence. No data or wire migration is required after the provider activity contract is available.
