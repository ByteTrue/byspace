# Mobile panels

Compact layouts have three mutually exclusive destinations:

- `agent-list` on the left
- `agent` in the center
- `file-explorer` on the right

They are one interaction, not two independent drawers. The transition model is `model.ts` and
the gesture rules are `gesture-intent.ts`, both in `web/src/core/mobile-panels/`; `provider.tsx`
runs them on the DOM, writing the position straight to the panel and backdrop styles, and
`web/src/mobile-panels/gesture.ts` holds the arithmetic of the four gestures (open and close, left
and right). The gestures listen for touch events on the document and cancel the page scroll once a
swipe is horizontal; a mouse drags them too. On Android with gesture navigation the system back
gesture owns both screen edges, so the open swipes need three-button navigation there.

## Ownership

React/Zustand owns the durable intent:

```ts
interface MobilePanelSelection {
  target: "agent-list" | "agent" | "file-explorer";
  revision: number;
}
```

Every semantic target change increments `revision`. Repeating the current target is idempotent.
Compact panel selection is not persisted; a cold start begins at `agent`.

The runtime in `provider.tsx` owns transient motion:

- one normalized position (`-1` left, `0` center, `1` right)
- the current motion target
- the active gesture's starting revision
- the last settled target

React publishes the active panel only when the canonical target and the runtime's position agree at
the final anchor. Retained content never observes gesture previews, progress, or an unsettled target.
The panel hosts stay mounted; the runtime reveals their overlays through inline styles while React
owns pointer events and accessibility.

## Why one position

Both transforms and both backdrop opacities are derived from the same normalized position. Window
width is only a projection input. Rotation changes the projection, not the panel state.

This makes these invalid states unrepresentable:

- a panel and its backdrop disagreeing
- left and right drawers both claiming to be open
- a width-sync effect resetting an active drag
- one animation context settling a transition owned by the other

Do not add another panel translate, backdrop opacity, or width synchronization effect.

## Ordering and interruption

A gesture captures the current revision when it becomes active. Per-frame updates are accepted only
while that revision still owns the gesture.

When a React command arrives during a drag, its newer revision clears gesture ownership and starts
motion toward the new target. The older gesture's remaining updates and finish callback are ignored.
Canceled gestures return to the latest canonical target. A successful gesture starts its finishing
motion immediately; the matching React command adopts that motion instead of restarting it. Position
settlement and command acceptance may arrive in either order. Activity changes after both agree on
the same target.

Manual gesture arbitration has two phases:

1. Before activation, determine whether horizontal intent may begin.
2. After activation, stop running begin checks and let the active revision own updates.

Re-running the begin gate after activation self-cancels the gesture because an active gesture is, by
definition, no longer eligible to begin.

## Integration rules

- Callers request semantic targets through `panel-store`; they never write the runtime's position.
- A focused interactive surface may block panel-opening gestures through
  `useBlockMobilePanelOpenGestures` (the terminal does). Register only while the conflicting
  interaction is active and unregister when the surface is hidden or unfocused. The blocker never
  disables gestures that close an already-open panel.
- Mobile sidebars render through `MobilePanelOverlay`; do not duplicate overlay lifecycle or motion
  styles in sidebar components.
- Gesture start and progress must not update React state. The overlay is already mounted and
  offscreen; only the position and the styles derived from it move during a drag.
- Hidden tabs and workspaces use `RetainedPanel`. It owns visibility, pointer events, and the active
  signal consumed by `useRetainedPanelActive`.
- Panels whose host already owns visibility use `RetainedPanelActivity` to provide the same active
  signal without adding another layout root. Persistent animations, timers, polling, and shared
  clocks subscribe to that signal and stop when their last visible consumer leaves.
- `useIsMobilePanelActive` follows the settled target, not the requested target. Position at the
  canonical target's anchor is the settlement signal; animation duration and completion callbacks
  do not own activity. Cancellation publishes nothing.

## Tests

`web/src/core/mobile-panels/model.test.ts` exercises command, drag, cancellation, interruption,
rapid-command, position-settlement, and width-projection sequences through the transition model. Add
a sequence there whenever ownership or ordering changes.
