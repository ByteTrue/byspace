# Hover

Read this before writing hover code. Hover-to-reveal is CSS: the row is a Tailwind `group`, and
what it reveals is a descendant switched by `group-hover`. In the sidebar, shadcn's
`SidebarMenuAction showOnHover` does all of it; copy the workspace row in
`web/src/sidebar/workspace-row.tsx`.

## The pattern

```tsx
<SidebarMenuItem>
  {/* the hover target: shadcn's group/menu-item */}
  <SidebarMenuButton asChild isActive={selected}>
    <a href={route}>…</a>
  </SidebarMenuButton>
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <SidebarMenuAction showOnHover tabIndex={isCompact ? undefined : -1}>
        <EllipsisVertical />
      </SidebarMenuAction>
    </DropdownMenuTrigger>
    …
  </DropdownMenu>
</SidebarMenuItem>
```

`showOnHover` shows the action while the item is hovered or has focus inside it, while its menu is
open (`aria-expanded`), and always below `md`, where there is no hover. `SidebarMenuButton` keeps
room for the action at its end, so trailing content (a diff stat) never sits under it.

- **The `group` element holds everything the pointer can move into.** CSS `:hover` stays on an
  ancestor while the pointer is over any descendant, so an action inside the item never takes the
  hover away. An action outside the group loses hover as the pointer crosses to it.
- **Hide by opacity, not by unmounting**, as shadcn does. The revealed control keeps its box, so
  nothing reflows under the pointer.
- **A control whose menu is open stays shown.** The menu takes the pointer off the row; if the
  trigger hid with the hover, an open menu would sit under nothing.
- **A control that only appears on hover is not a Tab stop on desktop** (`tabIndex={-1}` unless
  compact), so the Tab order does not depend on where the pointer happens to be.
- **Outside the sidebar**, reveal the same way with `group-hover/<name>:opacity-100` on an
  `opacity-0` control (`web/src/sidebar/list-parts.tsx`).
- **In e2e, assert the opacity.** Playwright counts an `opacity: 0` element as visible; use
  `expectHoverActionHidden` / `expectHoverActionShown` (`web/e2e/support/helpers/sidebar.ts`).

## Geometry

Hover must not change the hover target's size or position: no hover-only `padding`, `border`,
`width`, or a sibling that mounts and pushes the target. The pointer ends up outside the moved
box, the hover drops, the box moves back, and it flickers. Change colour, opacity, or content
that fits the same fixed box.

## Hover in JavaScript

Use `onPointerEnter` / `onPointerLeave` only when code, not styling, needs to know: a timer, a
tooltip, a hover intent delay. Touch fires pointer events too, so check `event.pointerType ===
"mouse"` when the behaviour is hover-only, and never make a pointer-enter handler the only way to
reach a control.

## Floating content

Use the right surface for the content:

- **Information worth a card** — a full path, branch details, usage, an explanation, or several
  fields — belongs in `InfoHoverCard`, composed with `InfoHoverCardTrigger` and
  `InfoHoverCardContent` from `web/src/components/info-hover-card.tsx`.
- **A short name for a button, control, or tab** stays a normal shadcn `Tooltip`; use
  `WithTooltip` where that wrapper already fits. Do not turn every tooltip into a card.

Content that renders in a portal cannot be inside the CSS hover group. The shared card is Radix:
it keeps the card open while the pointer is over the trigger or the card, and `closeDelay` covers
the gap between them. `web/src/sidebar/workspace-hover-card.tsx` is the rich-content example. The
shared policy is no delay to open, 100ms grace to close, and no opening on focus, so a row that
keeps focus after a click does not hold its card open. A mouse press closes the card before a drag
can capture the pointer; unmounting its trigger also closes it, because a removed trigger cannot
report the pointer leaving. Set `readOnly` on a read-only card that can cover another row: it
disables hit testing on both the card and Radix's portal wrapper. Keep cards with copy buttons or
other controls interactive. Compact layouts
do not show the card or notify the caller that it opened; information and actions they need must
have a non-hover path.

## Checklist

- [ ] The `group` element contains every element the pointer moves into while using the feature.
- [ ] Revealed controls hide by opacity (`showOnHover` in the sidebar), not by conditional rendering.
- [ ] Hover changes no size, padding, or border of the hover target.
- [ ] An open menu keeps its trigger shown.
- [ ] Compact layouts show the controls without hover.
- [ ] You hovered the row in the dev server and moved the pointer slowly onto every revealed
      control without losing it.
