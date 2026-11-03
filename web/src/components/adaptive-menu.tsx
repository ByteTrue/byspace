// shadcn's DropdownMenu and ContextMenu, plus the Expo app's `compactMode="sheet"`: on a phone such
// a menu is a bottom sheet (~/components/sheet-menu) that shows one page at a time — a submenu
// becomes a page with a back button. Everywhere else every export is the shadcn component itself.
// Same names and props as ~/components/ui/dropdown-menu and ~/components/ui/context-menu.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight } from "lucide-react";
import { Slot } from "radix-ui";
import { useIsCompactFormFactor } from "@/constants/layout";
import { cn } from "cn";
import {
  MenuSheet,
  MenuSheetHeader,
  SHEET_LABEL,
  SHEET_ROW,
  SHEET_SEPARATOR,
} from "~/components/sheet-menu";
import * as Context from "~/components/ui/context-menu";
import * as Dropdown from "~/components/ui/dropdown-menu";

export type CompactMode = "popover" | "sheet";

interface SheetMenuState {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Sub pages pushed, root first. */
  path: readonly string[];
  push: (id: string) => void;
  back: () => void;
  pageSlot: HTMLElement | null;
  setPageSlot: (node: HTMLElement | null) => void;
}

const SheetMenuContext = createContext<SheetMenuState | null>(null);
const SheetSubContext = createContext<{ id: string; title?: ReactNode } | null>(null);
const SheetRadioContext = createContext<{
  value?: string;
  onValueChange?: (value: string) => void;
} | null>(null);

function useSheet(): SheetMenuState | null {
  return useContext(SheetMenuContext);
}

function SheetMenuRoot({
  open,
  defaultOpen,
  onOpenChange,
  children,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
  const isOpen = open ?? internalOpen;
  const [path, setPath] = useState<readonly string[]>([]);
  const [pageSlot, setPageSlot] = useState<HTMLElement | null>(null);
  const setOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange, open],
  );
  useEffect(() => {
    if (!isOpen) setPath([]);
  }, [isOpen]);
  const push = useCallback((id: string) => setPath((current) => [...current, id]), []);
  const back = useCallback(() => setPath((current) => current.slice(0, -1)), []);
  const value = useMemo(
    () => ({ open: isOpen, setOpen, path, push, back, pageSlot, setPageSlot }),
    [back, isOpen, pageSlot, path, push, setOpen],
  );
  return <SheetMenuContext value={value}>{children}</SheetMenuContext>;
}

/** Radix's item select: the action runs, then the menu closes unless the handler prevented it. */
function runSelect(sheet: SheetMenuState, onSelect: ((event: Event) => void) | undefined) {
  const event = new Event("menu.itemSelect", { cancelable: true });
  onSelect?.(event);
  if (!event.defaultPrevented) sheet.setOpen(false);
}

function SheetContent({
  children,
  sheetTitle,
  testID,
}: {
  children: ReactNode;
  sheetTitle: string | undefined;
  testID: string | undefined;
}) {
  const sheet = useSheet();
  if (!sheet) return null;
  // The root stays mounted under an open sub page: its submenus own the pages' content.
  return (
    <MenuSheet
      open={sheet.open}
      onOpenChange={sheet.setOpen}
      title={sheetTitle ?? ""}
      titleVisible={Boolean(sheetTitle)}
      testID={testID}
    >
      <div className={sheet.path.length > 0 ? "hidden" : "contents"}>
        {sheetTitle ? <MenuSheetHeader title={sheetTitle} onBack={null} asSheetTitle /> : null}
        {children}
      </div>
      <div ref={sheet.setPageSlot} className="contents" />
    </MenuSheet>
  );
}

function SheetTrigger({
  asChild,
  children,
  onClick,
  ...props
}: ComponentProps<"button"> & { asChild?: boolean }) {
  const sheet = useSheet();
  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (!event.defaultPrevented) sheet?.setOpen(!sheet.open);
    },
    [onClick, sheet],
  );
  const Component = asChild ? Slot.Root : "button";
  return (
    <Component
      type={asChild ? undefined : "button"}
      aria-haspopup="menu"
      aria-expanded={sheet?.open}
      data-state={sheet?.open ? "open" : "closed"}
      {...props}
      onClick={handleClick}
    >
      {children}
    </Component>
  );
}

type ItemProps = ComponentProps<typeof Dropdown.DropdownMenuItem>;

function SheetItem({
  className,
  inset: _inset,
  variant = "default",
  onSelect,
  onClick,
  children,
  ...props
}: ItemProps) {
  const sheet = useSheet()!;
  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event as never);
      runSelect(sheet, onSelect);
    },
    [onClick, onSelect, sheet],
  );
  return (
    <button
      type="button"
      role="menuitem"
      data-variant={variant}
      className={cn(SHEET_ROW, variant === "destructive" && "text-destructive", className)}
      {...(props as ComponentProps<"button">)}
      onClick={handleClick}
    >
      {children}
    </button>
  );
}

function SheetIndicator({ visible }: { visible: boolean }) {
  return (
    <span className="pointer-events-none absolute right-3 flex items-center justify-center">
      {visible ? <Check /> : null}
    </span>
  );
}

type CheckboxItemProps = ComponentProps<typeof Dropdown.DropdownMenuCheckboxItem>;

function SheetCheckboxItem({
  className,
  inset: _inset,
  checked,
  onCheckedChange,
  onSelect,
  children,
  ...props
}: CheckboxItemProps) {
  const sheet = useSheet()!;
  const isChecked = checked === true;
  const handleClick = useCallback(() => {
    onCheckedChange?.(!isChecked);
    runSelect(sheet, onSelect);
  }, [isChecked, onCheckedChange, onSelect, sheet]);
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={isChecked}
      className={cn(SHEET_ROW, "pr-9", className)}
      {...(props as ComponentProps<"button">)}
      onClick={handleClick}
    >
      <SheetIndicator visible={isChecked} />
      {children}
    </button>
  );
}

type RadioItemProps = ComponentProps<typeof Dropdown.DropdownMenuRadioItem>;

function SheetRadioItem({
  className,
  inset: _inset,
  value,
  onSelect,
  children,
  ...props
}: RadioItemProps) {
  const sheet = useSheet()!;
  const group = useContext(SheetRadioContext);
  const isChecked = group?.value === value;
  const handleClick = useCallback(() => {
    group?.onValueChange?.(value);
    runSelect(sheet, onSelect);
  }, [group, onSelect, sheet, value]);
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={isChecked}
      className={cn(SHEET_ROW, "pr-9", className)}
      {...(props as ComponentProps<"button">)}
      onClick={handleClick}
    >
      <SheetIndicator visible={isChecked} />
      {children}
    </button>
  );
}

function SheetSub({ title, children }: { title?: ReactNode; children?: ReactNode }) {
  const id = useId();
  const value = useMemo(() => ({ id, title }), [id, title]);
  return <SheetSubContext value={value}>{children}</SheetSubContext>;
}

function SheetSubTrigger({
  className,
  inset: _inset,
  children,
  ...props
}: ComponentProps<typeof Dropdown.DropdownMenuSubTrigger>) {
  const sheet = useSheet()!;
  const sub = useContext(SheetSubContext);
  const handleClick = useCallback(() => {
    if (sub) sheet.push(sub.id);
  }, [sheet, sub]);
  return (
    <button
      type="button"
      role="menuitem"
      aria-haspopup="menu"
      className={cn(SHEET_ROW, className)}
      {...(props as ComponentProps<"button">)}
      onClick={handleClick}
    >
      {children}
      <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />
    </button>
  );
}

/** A sub page: shown while it is the open page, kept (hidden) while a deeper page is. */
function SheetSubContent({ children }: { children?: ReactNode }) {
  const sheet = useSheet()!;
  const sub = useContext(SheetSubContext);
  const index = sub ? sheet.path.indexOf(sub.id) : -1;
  if (index < 0 || !sheet.pageSlot) return null;
  const isOpenPage = index === sheet.path.length - 1;
  return createPortal(
    <div className={isOpenPage ? "contents" : "hidden"}>
      <MenuSheetHeader title={sub?.title ?? ""} onBack={sheet.back} />
      {children}
    </div>,
    sheet.pageSlot,
  );
}

// ---- dropdown ----

export function DropdownMenu({
  compactMode = "popover",
  ...props
}: ComponentProps<typeof Dropdown.DropdownMenu> & { compactMode?: CompactMode }) {
  const isCompact = useIsCompactFormFactor();
  if (isCompact && compactMode === "sheet") {
    const { open, defaultOpen, onOpenChange, children } = props;
    return (
      <SheetMenuRoot open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
        {children}
      </SheetMenuRoot>
    );
  }
  return <Dropdown.DropdownMenu {...props} />;
}

export function DropdownMenuTrigger(props: ComponentProps<typeof Dropdown.DropdownMenuTrigger>) {
  if (useSheet())
    return <SheetTrigger {...(props as ComponentProps<"button"> & { asChild?: boolean })} />;
  return <Dropdown.DropdownMenuTrigger {...props} />;
}

export function DropdownMenuContent({
  sheetTitle,
  ...props
}: ComponentProps<typeof Dropdown.DropdownMenuContent> & {
  /** The root page's heading in the phone sheet. */
  sheetTitle?: string;
}) {
  if (useSheet()) {
    return (
      <SheetContent
        sheetTitle={sheetTitle}
        testID={(props as { "data-testid"?: string })["data-testid"]}
      >
        {props.children}
      </SheetContent>
    );
  }
  return <Dropdown.DropdownMenuContent {...props} />;
}

export function DropdownMenuItem(props: ItemProps) {
  if (useSheet()) return <SheetItem {...props} />;
  return <Dropdown.DropdownMenuItem {...props} />;
}

export function DropdownMenuCheckboxItem(props: CheckboxItemProps) {
  if (useSheet()) return <SheetCheckboxItem {...props} />;
  return <Dropdown.DropdownMenuCheckboxItem {...props} />;
}

export function DropdownMenuRadioGroup(
  props: ComponentProps<typeof Dropdown.DropdownMenuRadioGroup>,
) {
  const { value, onValueChange } = props;
  const group = useMemo(() => ({ value, onValueChange }), [onValueChange, value]);
  if (useSheet()) {
    return (
      <SheetRadioContext value={group}>
        <div role="group">{props.children}</div>
      </SheetRadioContext>
    );
  }
  return <Dropdown.DropdownMenuRadioGroup {...props} />;
}

export function DropdownMenuRadioItem(props: RadioItemProps) {
  if (useSheet()) return <SheetRadioItem {...props} />;
  return <Dropdown.DropdownMenuRadioItem {...props} />;
}

export function DropdownMenuLabel({
  className,
  inset,
  ...props
}: ComponentProps<typeof Dropdown.DropdownMenuLabel>) {
  if (useSheet())
    return <div className={cn(SHEET_LABEL, className)} {...(props as ComponentProps<"div">)} />;
  return <Dropdown.DropdownMenuLabel className={className} inset={inset} {...props} />;
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof Dropdown.DropdownMenuSeparator>) {
  if (useSheet()) return <div role="separator" className={cn(SHEET_SEPARATOR, className)} />;
  return <Dropdown.DropdownMenuSeparator className={className} {...props} />;
}

export function DropdownMenuGroup(props: ComponentProps<typeof Dropdown.DropdownMenuGroup>) {
  if (useSheet()) return <div role="group">{props.children}</div>;
  return <Dropdown.DropdownMenuGroup {...props} />;
}

export function DropdownMenuSub({
  title,
  ...props
}: ComponentProps<typeof Dropdown.DropdownMenuSub> & {
  /** The page's heading in the phone sheet. */
  title?: ReactNode;
}) {
  if (useSheet()) return <SheetSub title={title}>{props.children}</SheetSub>;
  return <Dropdown.DropdownMenuSub {...props} />;
}

export function DropdownMenuSubTrigger(
  props: ComponentProps<typeof Dropdown.DropdownMenuSubTrigger>,
) {
  if (useSheet()) return <SheetSubTrigger {...props} />;
  return <Dropdown.DropdownMenuSubTrigger {...props} />;
}

export function DropdownMenuSubContent(
  props: ComponentProps<typeof Dropdown.DropdownMenuSubContent>,
) {
  if (useSheet()) return <SheetSubContent>{props.children}</SheetSubContent>;
  return <Dropdown.DropdownMenuSubContent {...props} />;
}

export const DropdownMenuShortcut = Dropdown.DropdownMenuShortcut;

// ---- context ----

/** Context menus are sheets on a phone unless told otherwise, as in the Expo app. */
export function ContextMenu({
  compactMode = "sheet",
  ...props
}: ComponentProps<typeof Context.ContextMenu> & { compactMode?: CompactMode }) {
  const isCompact = useIsCompactFormFactor();
  if (isCompact && compactMode === "sheet") {
    return <SheetMenuRoot onOpenChange={props.onOpenChange}>{props.children}</SheetMenuRoot>;
  }
  return <Context.ContextMenu {...props} />;
}

/**
 * The context gesture opens the sheet: right click, or a long press where the browser turns it
 * into one (Android). iOS has none; rows also carry a kebab for the same menu.
 */
export function ContextMenuTrigger({
  asChild,
  children,
  onContextMenu,
  ...props
}: ComponentProps<typeof Context.ContextMenuTrigger>) {
  const sheet = useSheet();
  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLSpanElement>) => {
      onContextMenu?.(event);
      if (event.defaultPrevented) return;
      event.preventDefault();
      sheet?.setOpen(true);
    },
    [onContextMenu, sheet],
  );
  if (!sheet) {
    return (
      <Context.ContextMenuTrigger asChild={asChild} onContextMenu={onContextMenu} {...props}>
        {children}
      </Context.ContextMenuTrigger>
    );
  }
  const Component = asChild ? Slot.Root : "span";
  return (
    <Component {...(props as ComponentProps<"span">)} onContextMenu={handleContextMenu}>
      {children}
    </Component>
  );
}

export function ContextMenuContent({
  sheetTitle,
  ...props
}: ComponentProps<typeof Context.ContextMenuContent> & { sheetTitle?: string }) {
  if (useSheet()) {
    return (
      <SheetContent
        sheetTitle={sheetTitle}
        testID={(props as { "data-testid"?: string })["data-testid"]}
      >
        {props.children}
      </SheetContent>
    );
  }
  return <Context.ContextMenuContent {...props} />;
}

export function ContextMenuItem(props: ComponentProps<typeof Context.ContextMenuItem>) {
  if (useSheet()) return <SheetItem {...(props as ItemProps)} />;
  return <Context.ContextMenuItem {...props} />;
}

export function ContextMenuCheckboxItem(
  props: ComponentProps<typeof Context.ContextMenuCheckboxItem>,
) {
  if (useSheet()) return <SheetCheckboxItem {...(props as CheckboxItemProps)} />;
  return <Context.ContextMenuCheckboxItem {...props} />;
}

export function ContextMenuLabel({
  className,
  ...props
}: ComponentProps<typeof Context.ContextMenuLabel>) {
  if (useSheet())
    return <div className={cn(SHEET_LABEL, className)} {...(props as ComponentProps<"div">)} />;
  return <Context.ContextMenuLabel className={className} {...props} />;
}

export function ContextMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof Context.ContextMenuSeparator>) {
  if (useSheet()) return <div role="separator" className={cn(SHEET_SEPARATOR, className)} />;
  return <Context.ContextMenuSeparator className={className} {...props} />;
}

export function ContextMenuSub({
  title,
  ...props
}: ComponentProps<typeof Context.ContextMenuSub> & { title?: ReactNode }) {
  if (useSheet()) return <SheetSub title={title}>{props.children}</SheetSub>;
  return <Context.ContextMenuSub {...props} />;
}

export function ContextMenuSubTrigger(props: ComponentProps<typeof Context.ContextMenuSubTrigger>) {
  if (useSheet())
    return (
      <SheetSubTrigger {...(props as ComponentProps<typeof Dropdown.DropdownMenuSubTrigger>)} />
    );
  return <Context.ContextMenuSubTrigger {...props} />;
}

export function ContextMenuSubContent(props: ComponentProps<typeof Context.ContextMenuSubContent>) {
  if (useSheet()) return <SheetSubContent>{props.children}</SheetSubContent>;
  return <Context.ContextMenuSubContent {...props} />;
}
