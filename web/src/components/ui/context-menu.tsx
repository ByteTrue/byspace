"use client"

import * as React from "react"
import { cn } from "cn"
import { ContextMenu as ContextMenuPrimitive } from "radix-ui"
import { ChevronRightIcon, CheckIcon } from "lucide-react"

// BySpace: geometry follows packages/app's menu engine (components/ui/menu/menu-item.tsx,
// menu-overlay.tsx), so menus measure the same as in the Expo app: a 1px-bordered surface at least
// 180px wide with 4px above and below its rows; rows inset 4px with a 1px transparent border, 8px
// padding and gap, an 18px line, 28px tall (40px on a phone); a 16px leading slot (an icon given
// size 14 is centred in it, an unsized one fills it); labels 12px in; full-width separators; a
// flyout 6px over its parent; the focused row keeps its text colour.

function ContextMenu({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

function ContextMenuTrigger({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      className={cn("select-none", className)}
      {...props}
    />
  )
}

function ContextMenuGroup({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Group>) {
  return (
    <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />
  )
}

function ContextMenuPortal({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Portal>) {
  return (
    <ContextMenuPrimitive.Portal data-slot="context-menu-portal" {...props} />
  )
}

function ContextMenuSub({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Sub>) {
  return <ContextMenuPrimitive.Sub data-slot="context-menu-sub" {...props} />
}

function ContextMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.RadioGroup>) {
  return (
    <ContextMenuPrimitive.RadioGroup
      data-slot="context-menu-radio-group"
      {...props}
    />
  )
}

// BySpace: as packages/app's menus did (lib/overlay-root.ts focusFirstElement), opening a menu
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

// BySpace: 8px inside the window and the md shadow, as DropdownMenuContent.
function ContextMenuContent({
  className,
  ref,
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
}) {
  const focusFirstRef = useFocusFirstMenuItem(ref)
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        ref={focusFirstRef}
        collisionPadding={collisionPadding}
        className={cn("z-50 max-h-(--radix-context-menu-content-available-height) min-w-[180px] origin-(--radix-context-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-lg border bg-popover px-0 py-1 text-popover-foreground shadow-md duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", className )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/context-menu-item relative flex cursor-default mx-1 min-h-7 items-center gap-2 rounded-md border border-transparent px-2 py-1 text-sm leading-[18px] max-md:min-h-10 outline-hidden select-none focus:bg-accent data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg[width='24']:not([class*='size-'])]:size-4 [&>svg[width='14']:first-of-type:not(.ml-auto)]:mx-px data-[variant=destructive]:*:[svg]:text-destructive",
        className
      )}
      {...props}
    />
  )
}

function ContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.SubTrigger
      data-slot="context-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "flex cursor-default mx-1 min-h-7 items-center gap-2 rounded-md border border-transparent px-2 py-1 text-sm leading-[18px] max-md:min-h-10 outline-hidden select-none focus:bg-accent data-inset:pl-7 data-open:bg-accent [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg[width='24']:not([class*='size-'])]:size-4 [&>svg[width='14']:first-of-type:not(.ml-auto)]:mx-px",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" size={14} />
    </ContextMenuPrimitive.SubTrigger>
  )
}

function ContextMenuSubContent({
  className,
  // BySpace: a flyout overlaps its parent menu by 6px, as packages/app's did (SUBMENU_OVERLAP 5 from
  // the row's full-width wrapper), so the pointer never crosses a gap. The row is inset 5px, hence -1.
  sideOffset = -1,
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPrimitive.SubContent
      data-slot="context-menu-sub-content"
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cn("z-50 min-w-[180px] origin-(--radix-context-menu-content-transform-origin) overflow-hidden rounded-lg border bg-popover px-0 py-1 text-popover-foreground shadow-md duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", className )}
      {...props}
    />
  )
}

function ContextMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.CheckboxItem> & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.CheckboxItem
      data-slot="context-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        "relative flex cursor-default mx-1 min-h-7 items-center gap-2 rounded-md border border-transparent py-1 pr-8 pl-2 text-sm leading-[18px] max-md:min-h-10 outline-hidden select-none focus:bg-accent data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg[width='24']:not([class*='size-'])]:size-4 [&>svg[width='14']:first-of-type:not(.ml-auto)]:mx-px",
        className
      )}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute right-2">
        <ContextMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  )
}

function ContextMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.RadioItem> & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.RadioItem
      data-slot="context-menu-radio-item"
      data-inset={inset}
      className={cn(
        "relative flex cursor-default mx-1 min-h-7 items-center gap-2 rounded-md border border-transparent py-1 pr-8 pl-2 text-sm leading-[18px] max-md:min-h-10 outline-hidden select-none focus:bg-accent data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg[width='24']:not([class*='size-'])]:size-4 [&>svg[width='14']:first-of-type:not(.ml-auto)]:mx-px",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute right-2">
        <ContextMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  )
}

function ContextMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.Label
      data-slot="context-menu-label"
      data-inset={inset}
      className={cn(
        "px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground data-inset:pl-7",
        className
      )}
      {...props}
    />
  )
}

function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn("my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function ContextMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="context-menu-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
}
