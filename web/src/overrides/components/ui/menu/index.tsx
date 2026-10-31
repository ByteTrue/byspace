// Override of packages/app/src/components/ui/menu (the menu engine). Same vocabulary — root,
// trigger, surface, items, labels, hints, sub pages — rendered with shadcn's DropdownMenu or
// ContextMenu, whichever root the items sit under.
import {
  createContext,
  useCallback,
  useContext,
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
import { Check } from "lucide-react";
import invariant from "tiny-invariant";
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
}

const MenuKindContext = createContext<MenuKind>("dropdown");
const MenuStateContext = createContext<MenuContextValue | null>(null);
const MenuPagesContext = createContext<ReadonlyMap<string, MenuPageDefinition>>(new Map());

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
  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );
  const selectItem = useCallback(
    (onSelect: (() => void) | undefined, closeOnSelect: boolean) => {
      if (closeOnSelect) setOpen(false);
      onSelect?.();
    },
    [setOpen],
  );
  const value = useMemo<MenuContextValue>(
    () => ({ open: isOpen, setOpen, selectItem, presentation: "popover" }),
    [isOpen, selectItem, setOpen],
  );
  return (
    <MenuKindContext value={kind}>
      <MenuStateContext value={value}>
        {kind === "context" ? (
          // Radix opens a context menu at the pointer and owns its open state.
          <ContextMenuRoot onOpenChange={setOpen} modal={modal}>
            {children}
          </ContextMenuRoot>
        ) : (
          <DropdownMenuRoot open={isOpen} onOpenChange={setOpen} modal={modal}>
            {children}
          </DropdownMenuRoot>
        )}
      </MenuStateContext>
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
  const { open } = useMenuContext("MenuTrigger");
  const [hovered, setHovered] = useState(false);
  const content =
    typeof children === "function" ? children({ pressed: false, hovered, open }) : children;
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
  const pageMap = useMemo(() => new Map((pages ?? []).map((page) => [page.id, page])), [pages]);
  const style = useMemo(
    () => ({ width, minWidth, maxWidth, maxHeight }),
    [maxHeight, maxWidth, minWidth, width],
  );
  const body = <MenuPagesContext value={pageMap}>{children}</MenuPagesContext>;
  // Without a fixed width the surface sizes to its rows between min and max width, as the Expo
  // engine's did; shadcn's content otherwise takes the trigger's width.
  const surfaceClassName = cn(width === undefined && "w-max", className);
  if (kind === "context") {
    return (
      <ContextMenuContent data-testid={testID} style={style} className={surfaceClassName}>
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
    >
      {body}
    </DropdownMenuContent>
  );
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

const SUCCESS_ICON = <Check className="text-status-success" />;
const SELECTED_ICON = <Check className="text-muted-foreground" />;
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
        <span className="line-clamp-2 text-xs text-muted-foreground">{description}</span>
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
  const Item = kind === "context" ? ContextMenuItem : DropdownMenuItem;
  const { label, lead, isPending, isSuccess } = resolveItemStatus({
    children,
    leading,
    status,
    loading,
    pendingLabel,
    successLabel,
  });
  const showCheckAtEnd = !showSelectedCheck && selected === true;
  const trail = trailing ?? (showCheckAtEnd ? SELECTED_ICON : null);
  const handleSelect = useCallback(
    (event: Event) => {
      if (!closeOnSelect) event.preventDefault();
      onSelect?.();
    },
    [closeOnSelect, onSelect],
  );
  return (
    <WithMenuTooltip tooltip={tooltip}>
      <Item
        disabled={Boolean(disabled) || isPending || isSuccess}
        variant={destructive && !isSuccess ? "destructive" : "default"}
        onSelect={handleSelect}
        data-testid={testID}
        aria-checked={selected}
        className={cn(
          active && "bg-accent text-accent-foreground",
          muted && "text-muted-foreground",
          className,
        )}
      >
        {showSelectedCheck ? (
          <span className="flex size-4 shrink-0 items-center justify-center">
            {selected ? <Check /> : null}
          </span>
        ) : null}
        {lead}
        <MenuItemBody
          label={label}
          description={isPending || isSuccess ? undefined : description}
          isSuccess={isSuccess}
        />
        {trail ? (
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            {trail}
          </span>
        ) : null}
      </Item>
    </WithMenuTooltip>
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
  const page = useContext(MenuPagesContext).get(id);
  const Sub = kind === "context" ? ContextMenuSub : DropdownMenuSub;
  const SubTrigger = kind === "context" ? ContextMenuSubTrigger : DropdownMenuSubTrigger;
  const SubContent = kind === "context" ? ContextMenuSubContent : DropdownMenuSubContent;
  return (
    <Sub>
      <SubTrigger disabled={disabled} data-testid={testID}>
        {leading}
        <span className="truncate">{children}</span>
        {value ? (
          <span className="ml-auto min-w-0 truncate pl-2 text-muted-foreground">{value}</span>
        ) : null}
        {indicator ? (
          <span
            className="size-1.5 shrink-0 rounded-full bg-primary"
            data-testid="menu-sub-indicator"
          />
        ) : null}
      </SubTrigger>
      <SubContent>{page?.content}</SubContent>
    </Sub>
  );
}

export function MenuLabel({
  children,
  testID,
  className,
}: PropsWithChildren<{ style?: unknown; testID?: string; className?: string }>): ReactElement {
  const kind = useContext(MenuKindContext);
  const Label = kind === "context" ? ContextMenuLabel : DropdownMenuLabel;
  return (
    <Label data-testid={testID} className={className}>
      {children}
    </Label>
  );
}

export function MenuSeparator({ testID }: { style?: unknown; testID?: string }): ReactElement {
  const kind = useContext(MenuKindContext);
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
      className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs text-muted-foreground"
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
