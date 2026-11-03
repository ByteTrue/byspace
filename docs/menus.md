# Menus

Menus are shadcn's `DropdownMenu` and `ContextMenu` (`web/src/components/ui/`), used at the call
site as shadcn documents them. There is no menu engine of our own: the Expo app's (popover on wide
screens, bottom sheet on phones, submenu pages as data) was removed when the app moved to shadcn
components as shipped. A phone gets the same popover as a desktop.

`web/src/core/components/ui/context-menu.tsx` is the one wrapper that stays. A context-menu row is
shadcn's `ContextMenuTrigger` around a div that also presses: click, Enter/Space, press-in and long
press. Use its `ContextMenuTrigger` for a row that both opens something and has a right-click menu;
use shadcn's directly when the area has no press of its own.

## When the items differ per form factor

A menu whose contents depend on what else is on screen gets one component per surface, not one
component with `isMobile` branches inside it. The workspace header menu is the example
(`web/src/core/screens/workspace/workspace-header-menu.tsx`): compact has no tab strip, so it
carries new-tab actions, while wide leaves those to the strip's `+` menu and lists workspace
actions only. Items both surfaces share live in one component that each menu renders, from the same
callbacks, so the two can't drift.

## Item states

A chosen value is a `DropdownMenuCheckboxItem` (or `DropdownMenuRadioItem` in a
`DropdownMenuRadioGroup`), never a `DropdownMenuItem` with a check drawn in by hand: the role is
what makes a choice list audible as on/off things. A row whose submenu is open is Radix's
`data-state="open"` on the `DropdownMenuSubTrigger`, which shadcn already styles.

An item whose request is still running stays in the menu with a `Spinner` and a pending label, and
the menu stays open (`onSelect` calls `event.preventDefault()`) until the request settles. A
trailing hint is `DropdownMenuShortcut`, or `Shortcut` (`web/src/components/shortcut.tsx`) for a
key chord.

Give options icons; leave the root rows without them. The root is labels and their current values,
and a column of icons there is decoration competing with the values you actually came to read.

## When a decision earns a submenu

Put a decision behind a submenu when its options are not the point — the current _value_ is. The
root row then reads as the answer (`Grouping  Project ›`) and costs one line instead of one line
per option. A menu whose every option is on screen at once does not survive its third decision.

Independent toggles stay on their page as checkbox items. A pick-one group can share that page
below a `DropdownMenuSeparator`; make selecting the checked row clear it, so "none" doesn't need a
row of its own.

## When a list of destinations is a menu

A set of destinations is not a menu. Search, Schedules, and Tunnels are rows above the workspace
list (`SidebarNavRows` in `web/src/sidebar/nav-menu.tsx`), each highlighted like a selected
workspace while you are on its page. They used to sit behind a "BySpace ⌄" menu: the product name
with a chevron read as an account switcher, the pages could not be seen until the menu was opened,
and once on a page nothing showed where you were.

A list that already has a row treatment — rows you hover, drag out of, or click a kebab on — is not
a menu either. Folding it into one means two presentations of the same list, plus a popover that
covers the content it was meant to sit beside.

A list of rows that carry buttons of their own (the composer's track panels) is a `Popover`, not a
menu: a menu item cannot hold other controls.

Reach for a menu when the items are actions, when the surface must escape its container (a clipped
or scrolled ancestor), or when the list is long enough that leaving it open would push the page
around.

## Gotchas

- **The shortcut engine asks whether a layer owns the keyboard.** Every Radix layer counts, so
  Escape closes the menu instead of leaving the page or interrupting the agent behind it
  (`web/src/core/lib/overlay-root.ts`). An overlay of your own needs `role="dialog"` and
  `data-state="open"` to count.
- **React bubbles a portal's events through the component tree, not the DOM.** A right-click in a
  row's portaled menu reached the context-menu trigger of the area around the row and opened that
  menu too; the context-menu wrapper ignores a `contextmenu` whose target is outside its own
  element. A press inside a menu opened from a list row (a `Command` item) selected the row under
  it; the accessory stops propagation
  (`web/src/core/screens/workspace/workspace-tab-trailing-accessory.tsx`).
- **A closing menu is still on screen for its fade-out.** A press that lands during it counts as
  outside the menu being reopened and closes that one too. Tests wait for
  `getByRole("menu")` to reach zero before opening the next menu, as a person's next click does.
