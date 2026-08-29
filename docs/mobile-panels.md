# Mobile panels

“Mobile panels” is the existing module name for panel behavior in compact,
narrow browser viewports. It does not imply a native application target.

Compact layouts have three mutually exclusive destinations:

- `agent-list` on the left;
- `agent` in the center;
- `file-explorer` on the right.

They form one interaction rather than two independent drawers. The
implementation lives in `packages/app/src/mobile-panels/`.

## State ownership

The panel store owns durable intent:

```ts
interface MobilePanelSelection {
  target: "agent-list" | "agent" | "file-explorer";
  revision: number;
}
```

Every semantic target change increments `revision`. Repeating the current
target is idempotent. Compact panel selection is not persisted; a cold start
begins at `agent`.

The motion layer owns transient state:

- one normalized position (`-1` left, `0` center, `1` right);
- the current motion target;
- the active pointer gesture's starting revision;
- the last settled target.

React owns presentation: whether an overlay is displayed and may receive
pointer events. Motion state does not own `display` or `pointerEvents`.

## One position

Both panel transforms and both backdrop opacities derive from the same
normalized position. Viewport width is only a projection input, so a resize
changes geometry without changing the selected panel.

Do not add separate position, backdrop, or width-synchronization state. One
position prevents the left and right panels, backdrops, and transitions from
disagreeing.

## Ordering and interruption

A pointer gesture captures the current revision when it begins. Its updates and
completion are accepted only while that revision remains current.

A newer store command interrupts an active gesture and moves toward the new
canonical target. Stale gesture updates and stale animation completions are
ignored. A cancelled gesture returns to the latest canonical target.

Gesture arbitration has two phases:

1. Before activation, decide whether horizontal movement may begin.
2. After activation, stop running the begin check and let the captured revision
   own updates.

## Integration rules

- Callers request semantic targets through `panel-store`; they do not write
  motion values.
- Use the four explicit adapters in `mobile-panels/gestures.ts` for open and
  close gestures.
- Render compact side panels through `MobilePanelOverlay`; do not duplicate its
  backdrop, pointer-event, or presentation lifecycle.
- Keep the selected panel present in the same render that changes selection;
  adding it later can produce a blank frame.
- Stop background polling, timers, and animation subscriptions when retained
  content is not active.

## Tests

`packages/app/src/mobile-panels/model.test.ts` covers commands, gestures,
cancellation, interruption, rapid commands, stale completion, and viewport
width projection. Add a sequence there whenever ordering or ownership changes.
Also verify the compact browser UI with pointer input at a narrow viewport.
