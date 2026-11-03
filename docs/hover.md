# Hover

Read this before writing hover code. Hover-to-reveal is CSS: the row is a Tailwind `group`, and
what it reveals is a descendant switched by `group-hover`. Copy the workspace row in
`web/src/sidebar/workspace-row.tsx`.

## The pattern

```tsx
<div className="group/workspace-row">
  {" "}
  {/* the hover target */}
  <a className="... hover:bg-sidebar-accent">
    {" "}
    {/* the row's own press */}
    <span className="group-hover/workspace-row:invisible max-md:hidden">{diffStat}</span>
  </a>
  <button
    className="invisible group-hover/workspace-row:visible data-[state=open]:visible max-md:visible"
    tabIndex={isCompact ? undefined : -1}
  >
    {/* kebab */}
  </button>
</div>
```

- **The `group` element holds everything the pointer can move into.** CSS `:hover` stays on an
  ancestor while the pointer is over any descendant, so buttons nested in the row never take the
  hover away. A revealed control that sits outside the group loses hover as the pointer crosses
  to it.
- **Hide with `invisible`, not by unmounting.** The revealed control and what it replaces share
  one slot, so nothing reflows under the pointer.
- **A control whose menu is open stays visible** (`data-[state=open]:visible`). The menu takes the
  pointer off the row; if the trigger hid with the hover, an open menu would sit under nothing.
- **Compact layouts have no hover**: `max-md:visible` shows the control on phones, where it is
  always there.
- **A control that only appears on hover is not a Tab stop on desktop** (`tabIndex={-1}` unless
  compact), so the Tab order does not depend on where the pointer happens to be.

## Geometry

Hover must not change the hover target's size or position: no hover-only `padding`, `border`,
`width`, or a sibling that mounts and pushes the target. The pointer ends up outside the moved
box, the hover drops, the box moves back, and it flickers. Change colour, opacity, or content
that fits the same fixed box. Give a row that swaps content on hover a `min-h-*` so the swap
cannot change its height.

## Hover in JavaScript

Use `onPointerEnter` / `onPointerLeave` only when code, not styling, needs to know: a timer, a
tooltip, a hover intent delay. Touch fires pointer events too, so check `event.pointerType ===
"mouse"` when the behaviour is hover-only, and never make a pointer-enter handler the only way to
reach a control.

## Floating content

Content that renders in a portal (a hover card, a tooltip) cannot be inside the group. Use Radix:
`HoverCard` keeps the card open while the pointer is over the trigger or the card, and
`closeDelay` covers the gap between them. `web/src/sidebar/workspace-hover-card.tsx` is the
example: no delay to open, 100ms grace to close, and no opening on focus, so a row that keeps focus
after a click does not hold its card open.

## Checklist

- [ ] The `group` element contains every element the pointer moves into while using the feature.
- [ ] Revealed controls use `invisible` / `group-hover:visible`, not conditional rendering.
- [ ] Hover changes no size, padding, or border of the hover target.
- [ ] An open menu keeps its trigger visible.
- [ ] Compact layouts show the controls without hover.
- [ ] You hovered the row in the dev server and moved the pointer slowly onto every revealed
      control without losing it.
