// Override of packages/app/src/components/ui/menu (the menu engine). Same vocabulary — root,
// trigger, surface, items, labels, hints, sub pages — rendered with shadcn's DropdownMenu or
// ContextMenu, whichever root the items sit under. A menu with `compactMode="sheet"` on a phone is
// a bottom sheet instead, showing one page at a time with a back button (docs/menus.md).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { Check, ChevronRight } from "lucide-react";
import invariant from "tiny-invariant";
import { useIsCompactFormFactor } from "@/constants/layout";
import { cn } from "cn";
import { composeHandlers } from "~/lib/compose";
import {
  ContextMenu as ContextMenuRoot,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "~/components/ui/context-menu";
import {
  DropdownMenu as DropdownMenuRoot,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  MenuSheet,
  MenuSheetHeader,
  SHEET_LABEL,
  SHEET_ROW,
  SHEET_SEPARATOR,
} from "~/components/sheet-menu";
import { Spinner } from "~/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

export {
  currentPageId,
  isSubPageOpen,
  MENU_ROOT_PATH,
  type MenuPath,
} from "@/components/ui/menu/menu-navigation";

export type Placement = "top" | "bottom" | "left" | "right";
export type Alignment = "start" | "center" | "end";
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Size {
  width: number;
  height: number;
}

export type MenuPresentation = "popover" | "sheet";
export type MenuCompactMode = "popover" | "sheet";
export type MenuKind = "dropdown" | "context";

export interface MenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Runs an item's action, closing the menu first when the item asks for it. */
  selectItem: (onSelect: (() => void) | undefined, closeOnSelect: boolean) => void;
  presentation: MenuPresentation;
  /** Sub pages pushed in a sheet, root first. A popover shows submenus as flyouts instead. */
  path: readonly string[];
  openSub: (id: string) => void;
  goBack: () => void;
}

const MenuKindContext = createContext<MenuKind>("dropdown");
const MenuStateContext = createContext<MenuContextValue | null>(null);
const MenuPagesContext = createContext<ReadonlyMap<string, MenuPageDefinition>>(new Map());
// The surface's minimum width: packages/app's flyouts took it (MenuFlyout's minWidth), not the
// surface's width; they size to their rows.
const MenuSurfaceMinWidthContext = createContext<CSSProperties["minWidth"]>(undefined);

export function useMenuContext(componentName: string): MenuContextValue {
  const value = useContext(MenuStateContext);
  invariant(value, `${componentName} must be used inside a menu`);
  return value;
}

export function useMenuDepth(): number {
  return 0;
}

export const MENU_ITEM_HEIGHT = { xs: 40, md: 28 } as const;

/** Where a row's text starts, measured from the surface edge (4px inset + 8px padding + 1px). */
export function menuRowContentInset(): number {
  return 13;
}

export function MenuRoot({
  open,
  defaultOpen,
  onOpenChange,
  compactMode = "popover",
  kind = "dropdown",
  modal,
  children,
}: PropsWithChildren<{
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  compactMode?: MenuCompactMode;
  kind?: MenuKind;
  modal?: boolean;
}>): ReactElement {
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
  const controlled = open !== undefined;
  const isOpen = controlled ? open : internalOpen;
  const isCompact = useIsCompactFormFactor();
  const presentation: MenuPresentation = isCompact && compactMode === "sheet" ? "sheet" : "popover";
  const [path, setPath] = useState<readonly string[]>([]);
  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );
  useEffect(() => {
    if (!isOpen) setPath([]);
  }, [isOpen]);
  const openSub = useCallback((id: string) => setPath((current) => [...current, id]), []);
  const goBack = useCallback(() => setPath((current) => current.slice(0, -1)), []);
  const selectItem = useCallback(
    (onSelect: (() => void) | undefined, closeOnSelect: boolean) => {
      if (closeOnSelect) setOpen(false);
      onSelect?.();
    },
    [setOpen],
  );
  const value = useMemo<MenuContextValue>(
    () => ({ open: isOpen, setOpen, selectItem, presentation, path, openSub, goBack }),
    [goBack, isOpen, openSub, path, presentation, selectItem, setOpen],
  );
  let root: ReactNode = (
    <DropdownMenuRoot open={isOpen} onOpenChange={setOpen} modal={modal}>
      {children}
    </DropdownMenuRoot>
  );
  // Radix opens a context menu at the pointer and owns its open state.
  if (kind === "context") {
    root = (
      <ContextMenuRoot onOpenChange={setOpen} modal={modal}>
        {children}
      </ContextMenuRoot>
    );
  }
  // A sheet is not a Radix menu: its trigger, surface and rows read the open state themselves.
  if (presentation === "sheet") root = children;
  return (
    <MenuKindContext value={kind}>
      <MenuStateContext value={value}>{root}</MenuStateContext>
    </MenuKindContext>
  );
}

export interface MenuTriggerState {
  pressed: boolean;
  hovered: boolean;
  open: boolean;
}

export interface MenuTriggerProps extends Omit<
  ComponentProps<"button">,
  "children" | "style" | "ref"
> {
  ref?: Ref<HTMLButtonElement>;
  style?: CSSProperties | ((state: MenuTriggerState) => unknown);
  children: ReactNode | ((state: MenuTriggerState) => ReactNode);
  onPress?: () => void;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityRole?: string;
  accessibilityState?: unknown;
  accessibilityHint?: string;
  hitSlop?: unknown;
  accessible?: boolean;
}

export function MenuTrigger({
  ref,
  style,
  children,
  onPress,
  testID,
  accessibilityLabel,
  accessibilityRole: _role,
  accessibilityState: _state,
  accessibilityHint: _hint,
  hitSlop: _hitSlop,
  accessible: _accessible,
  onClick,
  onPointerEnter,
  onPointerLeave,
  ...props
}: MenuTriggerProps): ReactElement {
  const { open, setOpen, presentation } = useMenuContext("MenuTrigger");
  const [hovered, setHovered] = useState(false);
  const content =
    typeof children === "function" ? children({ pressed: false, hovered, open }) : children;
  if (presentation === "sheet") {
    return (
      <button
        type="button"
        ref={ref}
        data-testid={testID}
        aria-label={accessibilityLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        style={typeof style === "object" ? style : undefined}
        {...props}
        onClick={composeHandlers(onClick, () => {
          onPress?.();
          setOpen(!open);
        })}
      >
        {content}
      </button>
    );
  }
  return (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        ref={ref}
        data-testid={testID}
        aria-label={accessibilityLabel}
        style={typeof style === "object" ? style : undefined}
        onClick={composeHandlers(onClick, onPress ? () => onPress() : undefined)}
        onPointerEnter={composeHandlers(onPointerEnter, () => setHovered(true))}
        onPointerLeave={composeHandlers(onPointerLeave, () => setHovered(false))}
        {...props}
      >
        {content}
      </button>
    </DropdownMenuTrigger>
  );
}

export interface MenuPageDefinition {
  id: string;
  title: string;
  content: ReactNode;
  hoverIntent?: boolean;
}

export interface MenuSurfaceProps {
  children: ReactNode;
  pages?: readonly MenuPageDefinition[];
  sheetTitle?: string;
  side?: Placement;
  align?: Alignment;
  offset?: number;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  maxHeight?: number;
  fullWidth?: boolean;
  horizontalPadding?: number;
  scrollable?: boolean;
  testID?: string;
  keyboardFocusScope?: unknown;
  className?: string;
}

export function MenuSurface({
  children,
  pages,
  sheetTitle,
  side = "bottom",
  align = "start",
  offset = 4,
  width,
  minWidth,
  maxWidth,
  maxHeight,
  testID,
  className,
}: MenuSurfaceProps): ReactElement {
  const kind = useContext(MenuKindContext);
  const menu = useMenuContext("MenuSurface");
  const pageMap = useMemo(() => new Map((pages ?? []).map((page) => [page.id, page])), [pages]);
  const style = useMemo(
    () => ({ width, minWidth, maxWidth, maxHeight }),
    [maxHeight, maxWidth, minWidth, width],
  );
  const body = (
    <MenuSurfaceMinWidthContext value={minWidth}>
      <MenuPagesContext value={pageMap}>{children}</MenuPagesContext>
    </MenuSurfaceMinWidthContext>
  );
  if (menu.presentation === "sheet") {
    return (
      <MenuSheetSurface sheetTitle={sheetTitle} pageMap={pageMap} testID={testID}>
        {children}
      </MenuSheetSurface>
    );
  }
  // Without a fixed width the surface sizes to its rows between min and max width, as the Expo
  // engine's did; shadcn's content otherwise takes the trigger's width.
  const surfaceClassName = cn(width === undefined && "w-max", className);
  if (kind === "context") {
    return (
      <ContextMenuContent
        data-testid={testID}
        style={style}
        className={surfaceClassName}
        onCloseAutoFocus={keepFocusElsewhere}
      >
        {body}
      </ContextMenuContent>
    );
  }
  return (
    <DropdownMenuContent
      side={side}
      align={align}
      sideOffset={offset}
      data-testid={testID}
      style={style}
      className={surfaceClassName}
      onCloseAutoFocus={keepFocusElsewhere}
    >
      {body}
    </DropdownMenuContent>
  );
}

/**
 * A content-sized bottom sheet: the root page under its title, or a pushed sub page under its own
 * title and a back button.
 */
function MenuSheetSurface({
  children,
  sheetTitle,
  pageMap,
  testID,
}: {
  children: ReactNode;
  sheetTitle: string | undefined;
  pageMap: ReadonlyMap<string, MenuPageDefinition>;
  testID: string | undefined;
}): ReactElement {
  const menu = useMenuContext("MenuSurface");
  const openPageId = menu.path.at(-1);
  const openPage = openPageId ? pageMap.get(openPageId) : undefined;
  const title = openPage?.title ?? sheetTitle;
  return (
    <MenuSheet open={menu.open} onOpenChange={menu.setOpen} title={title ?? ""} testID={testID}>
      <MenuPagesContext value={pageMap}>
        {title ? <MenuSheetHeader title={title} onBack={openPage ? menu.goBack : null} /> : null}
        {openPage ? openPage.content : children}
      </MenuPagesContext>
    </MenuSheet>
  );
}

/**
 * A closing menu hands focus back to its trigger, unless what the menu did already moved focus
 * (a "New agent" item focusing the new composer) — then focus stays there.
 */
function keepFocusElsewhere(event: Event) {
  const active = document.activeElement;
  if (active && active !== document.body) event.preventDefault();
}

export function useMenuSurface(_componentName: string) {
  return useContext(MenuPagesContext);
}

export type ActionStatus = "idle" | "pending" | "success";

export interface MenuItemProps {
  description?: string;
  onSelect?: () => void;
  disabled?: boolean;
  muted?: boolean;
  destructive?: boolean;
  selected?: boolean;
  showSelectedCheck?: boolean;
  active?: boolean;
  leading?: ReactElement | null;
  trailing?: ReactElement | null;
  /** @deprecated Use `status` instead */
  loading?: boolean;
  status?: ActionStatus;
  pendingLabel?: string;
  successLabel?: string;
  closeOnSelect?: boolean;
  testID?: string;
  tooltip?: string;
  className?: string;
}

const SUCCESS_ICON = <Check className="size-4 text-status-success" />;
const SELECTED_ICON = <Check className="size-4 text-muted-foreground" />;
const PENDING_ICON = <Spinner />;

/** The row's label and leading glyph for its action status: pending and success swap both. */
function resolveItemStatus(input: {
  children: ReactNode;
  leading: ReactElement | null | undefined;
  status: ActionStatus | undefined;
  loading: boolean | undefined;
  pendingLabel: string | undefined;
  successLabel: string | undefined;
}): { label: ReactNode; lead: ReactNode; isPending: boolean; isSuccess: boolean } {
  const isPending = input.status === "pending" || input.loading === true;
  const isSuccess = input.status === "success";
  if (isPending)
    return {
      label: input.pendingLabel || input.children,
      lead: PENDING_ICON,
      isPending,
      isSuccess,
    };
  if (isSuccess)
    return {
      label: input.successLabel || input.children,
      lead: SUCCESS_ICON,
      isPending,
      isSuccess,
    };
  return { label: input.children, lead: input.leading ?? null, isPending, isSuccess };
}

function MenuItemBody({
  label,
  description,
  isSuccess,
}: {
  label: ReactNode;
  description: string | undefined;
  isSuccess: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className={cn("truncate", isSuccess && "text-status-success")}>{label}</span>
      {description ? (
        <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{description}</span>
      ) : null}
    </span>
  );
}

function WithMenuTooltip({
  tooltip,
  children,
}: {
  tooltip: string | undefined;
  children: ReactElement;
}) {
  if (!tooltip) return children;
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

/** The trailing slot: the caller's, else the selected check when it is not drawn up front. */
function resolveTrail(
  trailing: ReactElement | null | undefined,
  showSelectedCheck: boolean,
  selected: boolean | undefined,
): ReactNode {
  if (trailing) return trailing;
  return !showSelectedCheck && selected === true ? SELECTED_ICON : null;
}

function itemStateClassName(
  active: boolean,
  muted: boolean,
  className: string | undefined,
): string {
  return cn(
    active && "bg-accent text-accent-foreground",
    muted && "text-muted-foreground",
    className,
  );
}

export function MenuItem({
  children,
  description,
  onSelect,
  disabled,
  muted = false,
  destructive,
  selected,
  showSelectedCheck = false,
  active = false,
  leading,
  trailing,
  loading,
  status,
  pendingLabel,
  successLabel,
  closeOnSelect = true,
  testID,
  tooltip,
  className,
}: PropsWithChildren<MenuItemProps>): ReactElement {
  const kind = useContext(MenuKindContext);
  const menu = useMenuContext("MenuItem");
  const Item = kind === "context" ? ContextMenuItem : DropdownMenuItem;
  const { label, lead, isPending, isSuccess } = resolveItemStatus({
    children,
    leading,
    status,
    loading,
    pendingLabel,
    successLabel,
  });
  const trail = resolveTrail(trailing, showSelectedCheck, selected);
  const handleSelect = useCallback(
    (event: Event) => {
      if (!closeOnSelect) event.preventDefault();
      onSelect?.();
    },
    [closeOnSelect, onSelect],
  );
  const selectCheck = showSelectedCheck ? (
    <span className="flex size-4 shrink-0 items-center justify-center">
      {selected ? <Check className="size-4" /> : null}
    </span>
  ) : null;
  const trailView = trail ? (
    <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      {trail}
    </span>
  ) : null;
  const itemBody = (
    <MenuItemBody
      label={label}
      description={isPending || isSuccess ? undefined : description}
      isSuccess={isSuccess}
    />
  );
  const isDisabled = Boolean(disabled) || isPending || isSuccess;
  const isDestructive = Boolean(destructive) && !isSuccess;
  const stateClassName = itemStateClassName(active, muted, className);
  if (menu.presentation === "sheet") {
    return (
      <SheetMenuItem
        disabled={isDisabled}
        destructive={isDestructive}
        selected={selected}
        onSelect={onSelect}
        closeOnSelect={closeOnSelect}
        testID={testID}
        className={stateClassName}
      >
        {selectCheck}
        {lead}
        {itemBody}
        {trailView}
      </SheetMenuItem>
    );
  }
  return (
    <WithMenuTooltip tooltip={tooltip}>
      <Item
        disabled={isDisabled}
        variant={isDestructive ? "destructive" : "default"}
        onSelect={handleSelect}
        data-testid={testID}
        aria-checked={selected}
        className={stateClassName}
      >
        {selectCheck}
        {lead}
        {itemBody}
        {trailView}
      </Item>
    </WithMenuTooltip>
  );
}

function SheetMenuItem({
  disabled,
  destructive,
  selected,
  onSelect,
  closeOnSelect,
  testID,
  className,
  children,
}: PropsWithChildren<{
  disabled: boolean;
  destructive: boolean;
  selected: boolean | undefined;
  onSelect: (() => void) | undefined;
  closeOnSelect: boolean;
  testID: string | undefined;
  className: string;
}>) {
  const { selectItem } = useMenuContext("MenuItem");
  const handleClick = useCallback(
    () => selectItem(onSelect, closeOnSelect),
    [closeOnSelect, onSelect, selectItem],
  );
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      aria-checked={selected}
      data-testid={testID}
      onClick={handleClick}
      className={cn(SHEET_ROW, destructive && "text-destructive", className)}
    >
      {children}
    </button>
  );
}

function SheetSubTrigger({
  id,
  disabled,
  testID,
  hasValue,
  children,
}: PropsWithChildren<{ id: string; disabled?: boolean; testID?: string; hasValue: boolean }>) {
  const { openSub } = useMenuContext("MenuSubTrigger");
  const handleClick = useCallback(() => openSub(id), [id, openSub]);
  return (
    <button
      type="button"
      role="menuitem"
      aria-haspopup="menu"
      disabled={disabled}
      data-testid={testID}
      onClick={handleClick}
      className={SHEET_ROW}
    >
      {children}
      <ChevronRight className={cn("size-3.5 text-muted-foreground", !hasValue && "ml-auto")} />
    </button>
  );
}

export function MenuSubTrigger({
  id,
  value,
  indicator = false,
  leading,
  disabled,
  testID,
  children,
}: PropsWithChildren<{
  id: string;
  value?: string;
  indicator?: boolean;
  leading?: ReactElement | null;
  disabled?: boolean;
  testID?: string;
}>): ReactElement {
  const kind = useContext(MenuKindContext);
  const menu = useMenuContext("MenuSubTrigger");
  const page = useContext(MenuPagesContext).get(id);
  const surfaceMinWidth = useContext(MenuSurfaceMinWidthContext);
  const flyoutStyle = useMemo(() => ({ minWidth: surfaceMinWidth }), [surfaceMinWidth]);
  const valueView = value ? (
    <span className="-mr-0.5 ml-auto min-w-0 truncate pl-2 text-muted-foreground">{value}</span>
  ) : null;
  const indicatorView = indicator ? (
    <span
      className="-mr-0.5 size-1.5 shrink-0 rounded-full bg-primary"
      data-testid="menu-sub-indicator"
    />
  ) : null;
  if (menu.presentation === "sheet") {
    return (
      <SheetSubTrigger id={id} disabled={disabled} testID={testID} hasValue={Boolean(value)}>
        {leading}
        <span className="truncate">{children}</span>
        {valueView}
        {indicatorView}
      </SheetSubTrigger>
    );
  }
  const Sub = kind === "context" ? ContextMenuSub : DropdownMenuSub;
  const SubTrigger = kind === "context" ? ContextMenuSubTrigger : DropdownMenuSubTrigger;
  const SubContent = kind === "context" ? ContextMenuSubContent : DropdownMenuSubContent;
  return (
    <Sub>
      <SubTrigger disabled={disabled} data-testid={testID}>
        {leading}
        <span className="truncate">{children}</span>
        {valueView}
        {indicatorView}
      </SubTrigger>
      <SubContent style={flyoutStyle}>{page?.content}</SubContent>
    </Sub>
  );
}

export function MenuLabel({
  children,
  testID,
  className,
}: PropsWithChildren<{ style?: unknown; testID?: string; className?: string }>): ReactElement {
  const kind = useContext(MenuKindContext);
  const { presentation } = useMenuContext("MenuLabel");
  if (presentation === "sheet") {
    return (
      <div data-testid={testID} className={cn(SHEET_LABEL, className)}>
        {children}
      </div>
    );
  }
  const Label = kind === "context" ? ContextMenuLabel : DropdownMenuLabel;
  return (
    <Label data-testid={testID} className={className}>
      {children}
    </Label>
  );
}

export function MenuSeparator({ testID }: { style?: unknown; testID?: string }): ReactElement {
  const kind = useContext(MenuKindContext);
  const { presentation } = useMenuContext("MenuSeparator");
  if (presentation === "sheet")
    return <div role="separator" data-testid={testID} className={SHEET_SEPARATOR} />;
  const Separator = kind === "context" ? ContextMenuSeparator : DropdownMenuSeparator;
  return <Separator data-testid={testID} />;
}

/** A row that says something instead of doing something; with `trailing`, a key and its value. */
export function MenuHint({
  children,
  trailing,
  testID,
}: PropsWithChildren<{ trailing?: ReactNode; style?: unknown; testID?: string }>): ReactElement {
  return (
    <div
      data-testid={testID}
      className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground"
    >
      <span className="min-w-0 shrink">{children}</span>
      {trailing}
    </div>
  );
}

function stopMenuTypeahead(event: KeyboardEvent) {
  // Radix menus treat letters as typeahead; keep them for the text field.
  if (event.key !== "Escape") event.stopPropagation();
}

export function MenuTextField({
  initialValue,
  onChangeText,
  placeholder,
  accessibilityLabel,
  autoFocus = false,
  editable = true,
  onSubmitEditing,
  testID,
}: {
  initialValue?: string;
  onChangeText?: (value: string) => void;
  placeholder?: string;
  accessibilityLabel?: string;
  autoFocus?: boolean;
  editable?: boolean;
  onSubmitEditing?: () => void;
  testID?: string;
}): ReactElement {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      stopMenuTypeahead(event);
      if (event.key === "Enter") {
        event.preventDefault();
        onSubmitEditing?.();
      }
    },
    [onSubmitEditing],
  );
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onChangeText?.(event.target.value),
    [onChangeText],
  );
  return (
    <input
      defaultValue={initialValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      aria-label={accessibilityLabel}
      autoFocus={autoFocus}
      disabled={!editable}
      data-testid={testID}
      className="mx-1 my-0.5 h-7 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    />
  );
}
