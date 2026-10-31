// Override of packages/app/src/components/ui/combobox.tsx: a searchable list anchored to a trigger
// the caller owns — a popover on desktop, a bottom drawer on a phone. Filtering, ranking, the
// custom-value row and the keyboard model are the shared modules the Expo combobox used.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { Check, File, Folder, Search } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useTranslation } from "react-i18next";
import {
  AdaptiveTextInput,
  InlineHeaderView,
  SheetHeaderView,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { getNextActiveIndex } from "@/components/ui/combobox-keyboard";
import {
  buildVisibleComboboxOptions,
  getComboboxFallbackIndex,
  type ComboboxOptionModel,
} from "@/components/ui/combobox-options";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { useIsCompactFormFactor } from "@/constants/layout";
import { cn } from "cn";
import { SnapDrawer } from "~/components/snap-drawer";
import { DrawerTitle } from "~/components/ui/drawer";

export type ComboboxOption = ComboboxOptionModel;
export type ComboboxDesktopPlacement = "top-start" | "bottom-start";

export interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onSelect: (id: string) => void;
  renderOption?: (input: {
    option: ComboboxOption;
    selected: boolean;
    active: boolean;
    onPress: () => void;
  }) => ReactElement;
  onSearchQueryChange?: (query: string) => void;
  searchable?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  allowCustomValue?: boolean;
  customValuePrefix?: string;
  customValueDescription?: string;
  customValueKind?: "directory" | "file";
  title?: string;
  /**
   * Structured header. When provided, replaces `title` + `stickyHeader` and
   * is rendered via the shared SheetHeaderView (mobile) / InlineHeaderView
   * (desktop).
   */
  header?: SheetHeader;
  mobileChildrenScrollEnabled?: boolean;
  /** Let custom desktop children own scrolling, for example a virtualized list. */
  desktopChildrenScrollEnabled?: boolean;
  /** Classes for the phone sheet's scrolling content around custom children. */
  mobileChildrenContentClassName?: string;
  presentation?: "push" | "replace";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  desktopPlacement?: ComboboxDesktopPlacement;
  desktopPreventInitialFlash?: boolean;
  /** Minimum width for the desktop popover (overrides trigger-based width). */
  desktopMinWidth?: number;
  /** Keep the desktop popover at its opening width as its content changes. */
  desktopLockWidth?: boolean;
  /** Fixed height for the desktop popover (overrides default 400px max). */
  desktopFixedHeight?: number;
  /** Content rendered above the scroll area on desktop (sticky header). */
  stickyHeader?: ReactNode;
  /** Content rendered below the scroll area. */
  footer?: ReactNode;
  /** When true, selecting an option does not close the picker (multi-select mode). */
  keepOpenOnSelect?: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  children?: ReactNode;
}

const DEFAULT_MAX_HEIGHT = 400;
const MOBILE_SNAP_POINTS = [0.6, 0.9];

export function SearchInput({
  placeholder,
  onChangeText,
  onSubmitEditing,
  autoFocus = false,
  resetKey,
}: {
  placeholder: string;
  onChangeText: (text: string) => void;
  onSubmitEditing?: () => void;
  autoFocus?: boolean;
  useBottomSheetInput?: boolean;
  resetKey?: string | number;
}): ReactElement {
  const inputRef = useRef<EditingTextInputHandle>(null);
  useEffect(() => {
    if (!autoFocus) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [autoFocus]);
  return (
    <div className="flex shrink-0 items-center gap-2 border-b px-3">
      <Search size={16} className="shrink-0 text-muted-foreground" />
      <AdaptiveTextInput
        ref={inputRef}
        className="h-10 min-w-0 flex-1 bg-transparent text-sm"
        placeholder={placeholder}
        resetKey={resetKey}
        onChangeText={onChangeText}
        autoCapitalize="none"
        autoCorrect="off"
        onSubmitEditing={onSubmitEditing}
      />
    </div>
  );
}

export interface ComboboxItemProps {
  label: string;
  description?: string;
  kind?: "directory" | "file";
  leadingSlot?: ReactNode;
  trailingSlot?: ReactNode;
  selected?: boolean;
  active?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  /** Rows on a raised background step one shade further on hover. */
  elevated?: boolean;
  onPress: () => void;
  testID?: string;
}

export function ComboboxItem({
  label,
  description,
  kind,
  leadingSlot,
  trailingSlot,
  selected,
  active,
  disabled,
  accessibilityLabel,
  elevated,
  onPress,
  testID,
}: ComboboxItemProps): ReactElement {
  let leading: ReactNode = null;
  if (leadingSlot) leading = leadingSlot;
  else if (kind === "directory") leading = <Folder size={16} className="text-muted-foreground" />;
  else if (kind === "file") leading = <File size={16} className="text-muted-foreground" />;
  return (
    <button
      type="button"
      data-testid={testID}
      disabled={disabled}
      onClick={onPress}
      aria-label={accessibilityLabel ?? label}
      className={cn(
        "flex min-h-9 w-full items-center gap-2 px-3 py-2 text-left outline-none disabled:opacity-55",
        elevated ? "hover:bg-accent active:bg-accent" : "hover:bg-muted active:bg-muted",
        active && "bg-muted",
      )}
    >
      {leading ? (
        <span className="flex w-4 shrink-0 items-center justify-center">{leading}</span>
      ) : null}
      <span className={cn("min-w-0 flex-1", description && "flex items-baseline gap-2")}>
        <span className="block shrink-0 truncate text-sm text-foreground">{label}</span>
        {description ? (
          <span className="block min-w-0 shrink truncate text-xs text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      {selected || trailingSlot ? (
        <span className="ml-auto flex items-center gap-1">
          <span className="flex w-4 items-center justify-center">
            {selected ? <Check size={16} className="text-muted-foreground" /> : null}
          </span>
          {trailingSlot}
        </span>
      ) : null}
    </button>
  );
}

export function ComboboxEmpty({ children }: { children: ReactNode }): ReactElement {
  return (
    <span
      data-testid="combobox-empty-text"
      className="block px-3 py-2 text-sm text-muted-foreground"
    >
      {children}
    </span>
  );
}

type RenderOptionFn = NonNullable<ComboboxProps["renderOption"]>;

function OptionRow({
  option,
  selected,
  active,
  onSelect,
  renderOption,
}: {
  option: ComboboxOption;
  selected: boolean;
  active: boolean;
  onSelect: (id: string) => void;
  renderOption: RenderOptionFn | undefined;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const handlePress = useCallback(() => onSelect(option.id), [onSelect, option.id]);
  useEffect(() => {
    if (active) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <div ref={rowRef}>
      {renderOption ? (
        renderOption({ option, selected, active, onPress: handlePress })
      ) : (
        <ComboboxItem
          label={option.label}
          description={option.description}
          kind={option.kind}
          selected={selected}
          active={active}
          onPress={handlePress}
        />
      )}
    </div>
  );
}

function OptionsList({
  options,
  value,
  activeIndex,
  emptyText,
  onSelect,
  renderOption,
}: {
  options: ComboboxOption[];
  value: string;
  activeIndex: number;
  emptyText: string;
  onSelect: (id: string) => void;
  renderOption: RenderOptionFn | undefined;
}): ReactElement {
  if (options.length === 0) return <ComboboxEmpty>{emptyText}</ComboboxEmpty>;
  return (
    <>
      {options.map((option, index) => (
        <OptionRow
          key={option.id}
          option={option}
          selected={option.id === value}
          active={index === activeIndex}
          onSelect={onSelect}
          renderOption={renderOption}
        />
      ))}
    </>
  );
}

function resolveInitialActiveIndex(
  options: ComboboxOption[],
  searching: boolean,
  value: string,
): number {
  if (options.length === 0) return -1;
  const fallbackIndex = getComboboxFallbackIndex(options.length, "below-search");
  if (searching) return fallbackIndex;
  const selectedIndex = options.findIndex((option) => option.id === value);
  return selectedIndex >= 0 ? selectedIndex : fallbackIndex;
}

function useAnchorWidth(anchorRef: RefObject<HTMLElement | null>, isOpen: boolean): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!isOpen) return;
    const measured = anchorRef.current?.getBoundingClientRect().width ?? 0;
    setWidth(measured > 0 ? measured : null);
  }, [anchorRef, isOpen]);
  return width;
}

function useComboboxCopy(input: {
  searchPlaceholder: string | undefined;
  placeholder: string | undefined;
  emptyText: string | undefined;
  title: string | undefined;
}) {
  const { t } = useTranslation();
  return {
    placeholder: input.searchPlaceholder ?? input.placeholder ?? t("common.placeholders.search"),
    emptyText: input.emptyText ?? t("common.empty.noOptionsMatchSearch"),
    title: input.title ?? t("common.actions.select"),
  };
}

/** Open state (controlled or not) and the search query, which resets whenever the list opens. */
function useComboboxOpenState({
  open,
  onOpenChange,
  onSearchQueryChange,
}: {
  open: boolean | undefined;
  onOpenChange: ((open: boolean) => void) | undefined;
  onSearchQueryChange: ((query: string) => void) | undefined;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = typeof open === "boolean";
  const isOpen = isControlled ? open : internalOpen;
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResetKey, setSearchResetKey] = useState(0);
  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) setInternalOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [isControlled, onOpenChange],
  );
  const setQuery = useCallback(
    (nextQuery: string) => {
      setSearchQuery(nextQuery);
      onSearchQueryChange?.(nextQuery);
    },
    [onSearchQueryChange],
  );
  const handleClose = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSearchResetKey((key) => key + 1);
  }, [setOpen, setQuery]);
  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setSearchResetKey((key) => key + 1);
  }, [isOpen, setQuery]);
  const handleRootOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) setOpen(true);
      else handleClose();
    },
    [handleClose, setOpen],
  );
  return { isOpen, searchQuery, setQuery, searchResetKey, handleClose, handleRootOpenChange };
}

/** The keyboard-highlighted option: arrows move it, Enter picks it, opening starts it on the value. */
function useComboboxNavigation({
  isOpen,
  options,
  searching,
  value,
  enabled,
  onSelect,
}: {
  isOpen: boolean;
  options: ComboboxOption[];
  searching: boolean;
  value: string;
  enabled: boolean;
  onSelect: (id: string) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(-1);
  useEffect(() => {
    if (!isOpen) return;
    setActiveIndex(resolveInitialActiveIndex(options, searching, value));
  }, [isOpen, options, searching, value]);
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!enabled || event.nativeEvent.isComposing) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const key = event.key;
        setActiveIndex((current) =>
          getNextActiveIndex({ currentIndex: current, itemCount: options.length, key }),
        );
        return;
      }
      if (event.key === "Enter" && options.length > 0) {
        event.preventDefault();
        const index = activeIndex >= 0 && activeIndex < options.length ? activeIndex : 0;
        onSelect(options[index].id);
      }
    },
    [activeIndex, enabled, onSelect, options],
  );
  return { activeIndex, handleKeyDown };
}

function popoverBody(hasChildren: boolean, childrenScroll: boolean): "list" | "scroll" | "fill" {
  if (!hasChildren) return "list";
  return childrenScroll ? "scroll" : "fill";
}

export function Combobox({
  options,
  value,
  onSelect,
  renderOption,
  onSearchQueryChange,
  searchable = true,
  placeholder,
  searchPlaceholder,
  emptyText,
  allowCustomValue = false,
  customValuePrefix = "Use",
  customValueDescription,
  customValueKind,
  title,
  header,
  mobileChildrenScrollEnabled = true,
  desktopChildrenScrollEnabled = true,
  mobileChildrenContentClassName,
  open,
  onOpenChange,
  desktopPlacement = "bottom-start",
  desktopMinWidth,
  desktopLockWidth = false,
  desktopFixedHeight,
  stickyHeader,
  footer,
  keepOpenOnSelect = false,
  anchorRef,
  children,
}: ComboboxProps): ReactElement | null {
  const isMobile = useIsCompactFormFactor();
  const copy = useComboboxCopy({ searchPlaceholder, placeholder, emptyText, title });
  const { isOpen, searchQuery, setQuery, searchResetKey, handleClose, handleRootOpenChange } =
    useComboboxOpenState({ open, onOpenChange, onSearchQueryChange });
  const anchorWidth = useAnchorWidth(anchorRef, isOpen && !isMobile);

  const visibleOptions = useMemo(
    () =>
      buildVisibleComboboxOptions({
        options,
        searchQuery,
        searchable,
        allowCustomValue,
        customValuePrefix,
        customValueDescription,
        customValueKind,
      }),
    [
      allowCustomValue,
      customValueDescription,
      customValueKind,
      customValuePrefix,
      options,
      searchQuery,
      searchable,
    ],
  );
  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id);
      if (!keepOpenOnSelect) handleClose();
    },
    [handleClose, keepOpenOnSelect, onSelect],
  );
  const hasChildren = Boolean(children);
  const { activeIndex, handleKeyDown } = useComboboxNavigation({
    isOpen,
    options: visibleOptions,
    searching: searchable && searchQuery.trim().length > 0,
    value,
    enabled: !hasChildren,
    onSelect: handleSelect,
  });
  // The trigger toggles the list itself; a press on it is not an outside press.
  const handleInteractOutside = useCallback(
    (event: { target: EventTarget | null; preventDefault: () => void }) => {
      const anchor = anchorRef.current;
      if (anchor && event.target instanceof Node && anchor.contains(event.target))
        event.preventDefault();
    },
    [anchorRef],
  );

  const list = (
    <OptionsList
      options={visibleOptions}
      value={value}
      activeIndex={activeIndex}
      emptyText={copy.emptyText}
      onSelect={handleSelect}
      renderOption={renderOption}
    />
  );
  const body = hasChildren ? children : list;
  const search = useMemo(
    () => ({ placeholder: copy.placeholder, onChangeText: setQuery, resetKey: searchResetKey }),
    [copy.placeholder, searchResetKey, setQuery],
  );
  const frame = useMemo(
    () => ({
      minWidth: desktopMinWidth,
      anchorWidth,
      lockWidth: desktopLockWidth,
      fixedHeight: desktopFixedHeight,
    }),
    [anchorWidth, desktopFixedHeight, desktopLockWidth, desktopMinWidth],
  );
  if (isMobile) {
    return (
      <ComboboxSheet
        open={isOpen}
        onOpenChange={handleRootOpenChange}
        onKeyDown={handleKeyDown}
        onClose={handleClose}
        title={copy.title}
        header={header}
        stickyHeader={stickyHeader}
        search={!hasChildren && searchable ? search : null}
        scrollBody={!hasChildren || mobileChildrenScrollEnabled}
        bodyClassName={mobileChildrenContentClassName}
        footer={footer}
      >
        {body}
      </ComboboxSheet>
    );
  }
  return (
    <ComboboxPopover
      open={isOpen}
      onOpenChange={handleRootOpenChange}
      anchorRef={anchorRef}
      placement={desktopPlacement}
      onKeyDown={handleKeyDown}
      onInteractOutside={handleInteractOutside}
      frame={frame}
      header={header}
      stickyHeader={stickyHeader}
      search={!hasChildren && !header && searchable ? search : null}
      body={popoverBody(hasChildren, desktopChildrenScrollEnabled)}
      footer={footer}
    >
      {body}
    </ComboboxPopover>
  );
}

interface ComboboxSearch {
  placeholder: string;
  onChangeText: (text: string) => void;
  resetKey: number;
}

function ComboboxSheet({
  open,
  onOpenChange,
  onKeyDown,
  onClose,
  title,
  header,
  stickyHeader,
  search,
  scrollBody,
  bodyClassName,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onClose: () => void;
  title: string;
  header: SheetHeader | undefined;
  stickyHeader: ReactNode;
  search: ComboboxSearch | null;
  scrollBody: boolean;
  bodyClassName: string | undefined;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <SnapDrawer
      open={open}
      onOpenChange={onOpenChange}
      snapPoints={MOBILE_SNAP_POINTS}
      onKeyDown={onKeyDown}
      aria-describedby={undefined}
      className="bg-background"
      bodyClassName="pb-[env(safe-area-inset-bottom)]"
    >
      <DrawerTitle className="sr-only">{header?.title ?? title}</DrawerTitle>
      {header ? <SheetHeaderView header={header} onClose={onClose} /> : null}
      {header ? null : (
        <>
          <div className="px-6 pb-2">
            <span className="text-sm font-medium text-foreground">{title}</span>
          </div>
          {stickyHeader}
          {search ? <SearchInput {...search} /> : null}
        </>
      )}
      {scrollBody ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={cn("px-2 pt-1 pb-8", bodyClassName)}>{children}</div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      )}
      {footer ? <div className="shrink-0 border-t">{footer}</div> : null}
    </SnapDrawer>
  );
}

interface ComboboxFrame {
  minWidth: number | undefined;
  anchorWidth: number | null;
  lockWidth: boolean;
  fixedHeight: number | undefined;
}

/** At least the trigger's width (or `minWidth`), at most 400px unless locked; height capped. */
function frameStyleFor({
  minWidth,
  anchorWidth,
  lockWidth,
  fixedHeight,
}: ComboboxFrame): CSSProperties {
  const floor = Math.max(minWidth ?? 0, anchorWidth ?? 200);
  const heightCap = fixedHeight ?? DEFAULT_MAX_HEIGHT;
  return {
    ...(lockWidth
      ? { width: floor, minWidth: floor, maxWidth: floor }
      : { minWidth: floor, maxWidth: Math.max(400, floor) }),
    maxHeight: `min(var(--radix-popover-content-available-height), ${heightCap}px)`,
    ...(fixedHeight != null
      ? { height: `min(var(--radix-popover-content-available-height), ${fixedHeight}px)` }
      : null),
  };
}

function ComboboxPopover({
  open,
  onOpenChange,
  anchorRef,
  placement,
  onKeyDown,
  onInteractOutside,
  frame,
  header,
  stickyHeader,
  search,
  body,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: RefObject<HTMLElement | null>;
  placement: ComboboxDesktopPlacement;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onInteractOutside: (event: { target: EventTarget | null; preventDefault: () => void }) => void;
  frame: ComboboxFrame;
  header: SheetHeader | undefined;
  stickyHeader: ReactNode;
  search: ComboboxSearch | null;
  /** The options list, or custom children that scroll themselves ("fill") or in the frame. */
  body: "list" | "scroll" | "fill";
  footer: ReactNode;
  children: ReactNode;
}) {
  const { minWidth, anchorWidth, lockWidth, fixedHeight } = frame;
  const frameStyle = useMemo(
    () => frameStyleFor({ minWidth, anchorWidth, lockWidth, fixedHeight }),
    [anchorWidth, fixedHeight, lockWidth, minWidth],
  );
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Anchor virtualRef={anchorRef as RefObject<HTMLElement>} />
      {open ? (
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            side={placement === "top-start" ? "top" : "bottom"}
            align="start"
            sideOffset={4}
            collisionPadding={8}
            role="dialog"
            data-testid="combobox-desktop-container"
            onKeyDown={onKeyDown}
            onInteractOutside={onInteractOutside}
            style={frameStyle}
            className="z-50 flex flex-col overflow-hidden rounded-lg border bg-popover text-sm text-popover-foreground shadow-md outline-none duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95"
          >
            {header ? <InlineHeaderView header={header} /> : stickyHeader}
            {search ? <SearchInput {...search} autoFocus /> : null}
            {body === "list" ? (
              <div className="min-h-0 flex-1 overflow-y-auto py-1">{children}</div>
            ) : null}
            {body === "scroll" ? (
              <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
            ) : null}
            {body === "fill" ? (
              <div className="flex min-h-0 flex-1 flex-col">{children}</div>
            ) : null}
            {footer ? <div className="shrink-0 border-t">{footer}</div> : null}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      ) : null}
    </PopoverPrimitive.Root>
  );
}
