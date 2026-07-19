# Floating Panels

Floating panels are Web popovers anchored to another element: tooltips, hover
cards, dropdowns, and autocomplete lists. Use an existing implementation rather
than introducing a shared abstraction.

## Canonical files

| File                                                       | Use case                          |
| ---------------------------------------------------------- | --------------------------------- |
| `packages/app/src/components/ui/combobox.tsx`              | Searchable anchored picker        |
| `packages/app/src/components/ui/tooltip.tsx`               | Non-interactive tooltip           |
| `packages/app/src/components/workspace-hover-card.tsx`     | Interactive hover card            |
| `packages/app/src/components/ui/autocomplete-popover.tsx`  | Composer autocomplete             |
| `packages/app/src/components/ui/floating-panel-portal.tsx` | Portal hosts and host measurement |

Copy the closest implementation and trim it. The cases have different focus,
interaction, and sizing requirements, so there is no generic floating-panel
primitive.

## Portal and layering

Use a Portal when the panel must escape clipping, stacking contexts, or the
anchor's layout bounds. Choose the host by layer:

- app-global overlays use the root host;
- content overlays use the current `FloatingPanelPortalHost` when app chrome
  must remain above them.

A portaled subtree can outlive the visible screen or pane that opened it. Gate
`visible` on the owning screen's focus signal. Inside an agent pane, include
`isPaneFocused` in that condition.

## Measurement and coordinates

`measureInWindow` returns window coordinates, while a Portal renders in its
host's coordinates. Measure both and subtract the host origin:

```ts
const [anchorRect, hostRect] = await Promise.all([
  measureAnchor(),
  measureFloatingPanelPortalHost(hostName),
]);

const left = anchorRect.x - hostRect.x;
const bottom = hostRect.height - (anchorRect.y - hostRect.y) + gap;
```

Do not use raw window coordinates as Portal-local coordinates. Re-measure when
the anchor, viewport, or relevant layout changes. Avoid per-frame measurement;
derive movement from the same state that moves the anchor when possible.

## Width

A combobox popover is never narrower than its trigger and may grow with content
up to a ceiling that is also no narrower than the trigger:

```ts
const floor = Math.max(desktopMinWidth ?? 0, referenceWidth ?? 200);
const frameStyle = { minWidth: floor, maxWidth: Math.max(400, floor) };
```

`desktopMinWidth` raises the floor; it does not cap the width.

## Prevent the measurement flash

Panels positioned from both the anchor rectangle and their own content size
need two measurements. A placeholder position such as `top: -9999` can still
produce one visible frame with the wrong intrinsic width and height.

Use both lifecycle gates:

1. Do not mount the floating content until the anchor rectangle exists.
2. Once the anchor exists, render at the final width with `opacity: 0` until the
   content size is known.

The first visible paint then uses final geometry. This is the canonical
"measure invisibly, then reveal" pattern.

## Hover gaps

If an interactive panel is separated from its trigger by a real visual gap,
use `useHoverSafeZone` from
`packages/app/src/hooks/use-hover-safe-zone.ts`. It keeps the panel open while
the pointer crosses the trigger, gap, and panel. The canonical caller is
`workspace-hover-card.tsx`.

## Checklist

- Reuse the closest canonical component.
- Gate visibility on the owning screen or pane lifecycle.
- Select the Portal host by the intended layer.
- Convert window measurements to host-relative coordinates.
- Hide content until every measurement needed for final placement exists.
- Keep interactive hover paths inside one region or use `useHoverSafeZone`.
