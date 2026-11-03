import * as React from "react"
import { cn } from "cn"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"
import { CheckIcon, ChevronRightIcon } from "lucide-react"
import { stopContextMenu } from "./menu-events"

// BySpace: geometry follows the Expo app's menu engine (components/ui/menu/menu-item.tsx,
// menu-overlay.tsx), so menus measure the same as in the Expo app: a 1px-bordered surface at least
// 180px wide with 4px above and below its rows; rows inset 4px with a 1px transparent border, 8px
// padding and gap, an 18px line, 28px tall (40px on a phone); a 16px leading slot (an icon given
// size 14 is centred in it, an unsized one fills it); labels 12px in; full-width separators; a
// flyout 6px over its parent; the focused row keeps its text colour.

function DropdownMenu({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return (
    <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
  )
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...props}
    />
  )
}

// BySpace: as the Expo app's menus did (lib/overlay-root.ts focusFirstElement), opening a menu
// focuses its first enabled row, so the row is highlighted and the arrow keys start from it. Radix
// focuses the content itself on a pointer open; this moves that focus on to the first row.
function useFocusFirstMenuItem(ref: React.Ref<HTMLDivElement> | undefined) {
  return React.useCallback(
    (node: HTMLDivElement | null) => {
      if (typeof ref === "function") ref(node)
      else if (ref) ref.current = node
      if (!node) return
      requestAnimationFrame(() => {
        if (document.activeElement !== node) return
        node
          .querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')
          ?.focus({ preventScroll: true })
      })
    },
    [ref]
  )
}

// BySpace: no exit animation, as the Expo app's menus on the web (menu-overlay.tsx passes no
// `exiting` there): a closing menu stays mounted while it animates out, and its outside-press
// handler would close a menu a quick press on the trigger had just reopened.
// BySpace: every menu surface stays 8px inside the window (the Expo app's menu-anchor EDGE_PADDING)
// and draws the md shadow, submenus too.
function DropdownMenuContent({
  className,
  ref,
  align = "start",
  sideOffset = 4,
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  const focusFirstRef = useFocusFirstMenuItem(ref)
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        ref={focusFirstRef}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        align={align}
        onContextMenu={stopContextMenu}
        // BySpace: transition-none, see context-menu.tsx (the origin must not glide).
        className={cn("z-50 max-h-(--radix-dropdown-menu-content-available-height) w-(--radix-dropdown-menu-trigger-width) min-w-[180px] transition-none origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-lg border bg-popover px-0 py-1 text-popover-foreground shadow-md duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95", className )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return (
    <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/dropdown-menu-item relative flex cursor-default mx-1 min-h-7 items-center gap-2 rounded-md border border-transparent px-2 py-1 text-sm leading-[18px] max-md:min-h-10 outline-hidden select-none focus:bg-accent data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg[width='24']:not([class*='size-'])]:size-4 [&>svg[width='14']:first-of-type:not(.ml-auto)]:mx-px data-[variant=destructive]:*:[svg]:text-destructive",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        "relative flex cursor-default mx-1 min-h-7 items-center gap-2 rounded-md border border-transparent py-1 pr-8 pl-2 text-sm leading-[18px] max-md:min-h-10 outline-hidden select-none focus:bg-accent data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg[width='24']:not([class*='size-'])]:size-4 [&>svg[width='14']:first-of-type:not(.ml-auto)]:mx-px",
        className
      )}
      checked={checked}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return (
    <DropdownMenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn(
        "relative flex cursor-default mx-1 min-h-7 items-center gap-2 rounded-md border border-transparent py-1 pr-8 pl-2 text-sm leading-[18px] max-md:min-h-10 outline-hidden select-none focus:bg-accent data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg[width='24']:not([class*='size-'])]:size-4 [&>svg[width='14']:first-of-type:not(.ml-auto)]:mx-px",
        className
      )}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  )
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground data-inset:pl-7",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSub({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "flex cursor-default mx-1 min-h-7 items-center gap-2 rounded-md border border-transparent px-2 py-1 text-sm leading-[18px] max-md:min-h-10 outline-hidden select-none focus:bg-accent data-inset:pl-7 data-open:bg-accent [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg[width='24']:not([class*='size-'])]:size-4 [&>svg[width='14']:first-of-type:not(.ml-auto)]:mx-px",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" size={14} />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

function DropdownMenuSubContent({
  className,
  // BySpace: a flyout overlaps its parent menu by 6px, as the Expo app's did (SUBMENU_OVERLAP 5 from
  // the row's full-width wrapper), so the pointer never crosses a gap. The row is inset 5px, hence -1.
  sideOffset = -1,
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      onContextMenu={stopContextMenu}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cn("z-50 min-w-[180px] transition-none origin-(--radix-dropdown-menu-content-transform-origin) overflow-hidden rounded-lg border bg-popover px-0 py-1 text-popover-foreground shadow-md duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95", className )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
