# Menus

One engine, in `web/src/core/components/ui/menu/`, drawn with shadcn's (Radix) `DropdownMenu` and
`ContextMenu` on wide screens and a bottom sheet (`web/src/components/sheet-menu.tsx`) on compact
ones. `web/src/core/components/ui/dropdown-menu.tsx` and `context-menu.tsx` are wrappers over it and
differ only in what opens them — a press, or a long press / right click. Import the
`DropdownMenu*` or `ContextMenu*` names; reach for `@/components/ui/menu` directly only when you
are building a third trigger shape.

Do not add a second menu implementation. The Expo app once had two, byte-identical from
`computePosition` down, and the copies drifted: only one of them ever grew a sheet.

## Two presentations

`MenuRoot` picks one from form factor, never from platform — a tablet in a narrow split view
sheets the same way a phone does.

| Screen                         | Surface                         | Submenus                                           |
| ------------------------------ | ------------------------------- | -------------------------------------------------- |
| Wide                           | Popover anchored to the trigger | Flyout overlapping the row, opened by hover intent |
| Compact, `compactMode="sheet"` | Bottom sheet                    | The page is replaced in place, with a back header  |
| Compact, default               | Popover                         | Same as wide                                       |

`compactMode` defaults to `"popover"`, so adopting the sheet is per-menu. That is deliberate:
flipping every menu in the app to sheets at once is not a change anyone can review. Opt a menu in
when you have actually looked at it on a phone.

`ContextMenu` is the exception: it defaults to `compactMode="sheet"` and opens on a long press
(`web/src/hooks/use-long-press.ts`) as well as a right click. Disable mobile triggering explicitly
on draggable rows, where long press belongs to drag instead.

## When the items differ per form factor

A menu whose contents depend on what else is on screen gets one component per surface, not one
component with `isMobile` branches inside it. The workspace header menu is the example
(`web/src/core/screens/workspace/workspace-header-menu.tsx`): compact has no tab strip, so it
carries new-tab actions, while wide leaves those to the strip's `+` menu and lists workspace
actions only. Items both surfaces share live in one component that each menu renders, from the same
callbacks, so the two can't drift.

## Selecting an item

A row that ends the surface goes through the engine. In the popover it is a Radix item, and
`closeOnSelect={false}` keeps the menu open; in the sheet it calls the engine's `selectItem`.
`MenuItem` is not the only row shape on the engine — `ComposerTrackRow`
(`web/src/core/composer/tracks.tsx`) is another, with its own icons and hover-revealed actions —
but both hand the press to the engine. A row that handles its own click leaves the surface open
behind whatever it opened.

## Pages

A submenu is a page, declared as data on the surface and reached by a `MenuSubTrigger` whose `id`
matches:

```tsx
<MenuSurface pages={pages} sheetTitle="Display">
  <MenuSubTrigger id="grouping" value="Project">
    Grouping
  </MenuSubTrigger>
</MenuSurface>
```

The popover opens a page as a Radix flyout beside its row; the sheet replaces the page in place
under a back header. Pages are data rather than nested children so one declaration drives both.
`menu-navigation.ts` holds the sheet's stack of open pages, and it is pure.

## A page that takes input

A menu page can hold a small form; `MenuTextField` is the field for it. It stops Radix's typeahead,
so letters type into the field instead of jumping to the row they start, and Enter submits.

## Hover intent

Radix opens a flyout when the pointer rests on its row and keeps it open while the pointer travels
toward it. The flyout also **overlaps its parent by 6px** (`DropdownMenuSubContent`'s
`sideOffset={-1}` from a row inset 5px) rather than sitting beside it. With a gap there is a strip
of nothing between the two surfaces, and every pixel of it is a chance to dismiss the menu you are
reaching for. Don't reintroduce the gap.

## Item states

`selected` and `active` are different questions and must not be merged.

| Prop       | Means                      | Draws                     |
| ---------- | -------------------------- | ------------------------- |
| `selected` | This is the chosen value   | A check, and nothing else |
| `active`   | This row's submenu is open | The fill, and no check    |

`selected` also announces itself as `aria-checked`, so a multi-select page is audible as the list
of on/off things it is.

A selected row does **not** get a background. A check and a fill are two separate claims about the
same state, and showing both makes a chosen row compete with the row the pointer is actually on.
`showSelectedCheck` moves the check to a reserved leading column when a group needs to stay
aligned whether ticked or not; otherwise it sits at the trailing edge and the leading slot is free
for the option's icon.

Give options icons; leave the root rows without them. The root is labels and their current values,
and a column of icons there is decoration competing with the values you actually came to read.

## Surface details

- The hover fill is **inset from the surface's edges and rounded** (`mx-1 rounded-md`) — a chip
  inside the menu, not a band across it.
- **A row is as tall as what is driving it** — 28px for a pointer (`min-h-7`), 40px below `md` for
  a thumb (`max-md:min-h-10`). The split is on breakpoint, not on presentation: the compact popover
  is worked with a thumb as much as a sheet is. `md` is where `useIsCompactFormFactor` divides, so
  row height and the popover/sheet choice turn over together.
- The label's line height is pinned at 18px; 18 + 8 padding + 2 border is the 28px row. Content
  that outgrows the minimum height makes the minimum mean nothing.
- Rows carry no vertical margin; the surface's padding is the inset above the first row and below
  the last. The separator is the one thing with vertical space of its own (`my-1`), and it runs the
  full width of the surface.

## When a decision earns a submenu

Put a decision behind a submenu when its options are not the point — the current _value_ is. The
root row then reads as the answer (`Grouping  Project ›`) and costs one line instead of one line
per option. A menu whose every option is on screen at once does not survive its third decision.

Independent toggles stay on their page as a checkmark list. A pick-one group can share that page
below a `MenuSeparator`; make selecting the checked row clear it, so "none" doesn't need a row of
its own.

## When a list of destinations is a menu

A set of destinations is not a menu. Search, Schedules, and Tunnels are rows above the workspace
list (`SidebarNavRows` in `web/src/sidebar/nav-menu.tsx`), each highlighted like a selected workspace while you are on
its page. They used to sit behind a "BySpace ⌄" menu: the product name with a chevron read as an
account switcher, the pages could not be seen until the menu was opened, and once on a page
nothing showed where you were.

A list that already has a row treatment — rows you hover, drag out of, or click a kebab on — is not
a menu either. Folding it into one means two presentations of the same list, plus a popover that
covers the content it was meant to sit beside.

Reach for a menu when the items are actions, when the surface must escape its container (a clipped
or scrolled ancestor), or when the list is long enough that leaving it open would push the page
around.

## Gotchas

- **The shortcut engine asks whether a layer owns the keyboard.** Every Radix layer counts, so
  Escape closes the menu instead of leaving the page or interrupting the agent behind it
  (`web/src/core/lib/overlay-root.ts`). An overlay of your own needs `role="dialog"` and
  `data-state="open"` to count.
- **React bubbles a portal's events through the component tree, not the DOM.** A right click on an
  item reached the context-menu trigger around the menu's own trigger and opened that menu on top;
  menu content stops `contextmenu` (`web/src/components/ui/menu-events.ts`).
- **No slide-in and no transition.** A surface fades and scales in place. A surface sliding in under
  the pointer takes the release of a right click as a press on its first item, and shadcn's
  `transition` glides the transform origin so the zoom drifts sideways.
