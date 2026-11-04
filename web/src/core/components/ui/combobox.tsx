// A list anchored to a trigger the caller owns: shadcn's Combobox, its search input inside the
// popup. The options arrive filtered and ranked by combobox-options (the Combobox's own filter is
// off); the Combobox owns the highlighted row and the arrow and Enter keys. A caller that brings its
// own content (children, not a list) gets shadcn's Popover, or a Drawer on a phone.
import { cn } from "cn";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { ArrowLeft, File, Folder } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SheetSearchField, type SheetHeader } from "@/components/adaptive-modal-sheet";
import {
  buildVisibleComboboxOptions,
  type ComboboxOptionModel,
} from "@/components/ui/combobox-options";
import { useIsCompactFormFactor } from "@/constants/layout";
import { Button } from "~/components/ui/button";
import {
  Combobox as ComboboxRoot,
  ComboboxContent,
  ComboboxEmpty as ComboboxEmptyRow,
  ComboboxInput,
  ComboboxItem as ComboboxListItem,
  ComboboxList,
} from "~/components/ui/combobox";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "~/components/ui/drawer";
import { Popover, PopoverAnchor, PopoverContent } from "~/components/ui/popover";

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
  /** A header row (back, leading, title, actions, search) above the list. */
  header?: SheetHeader;
  mobileChildrenScrollEnabled?: boolean;
  /** Let custom desktop children own scrolling, for example a virtualized list. */
  desktopChildrenScrollEnabled?: boolean;
  /** Classes for the phone drawer's scrolling content around custom children. */
  mobileChildrenContentClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  desktopPlacement?: ComboboxDesktopPlacement;
  /** Minimum width for the desktop popover (overrides trigger-based width). */
  desktopMinWidth?: number;
  /** Keep the desktop popover at its opening width as its content changes. */
  desktopLockWidth?: boolean;
  /** Fixed height for the desktop popover (overrides default 400px max). */
  desktopFixedHeight?: number;
  /** Content rendered above the list. */
  stickyHeader?: ReactNode;
  /** Content rendered below the list. */
  footer?: ReactNode;
  /** When true, selecting an option does not close the picker (multi-select mode). */
  keepOpenOnSelect?: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  children?: ReactNode;
}

export interface ComboboxItemProps {
  label: string;
  description?: string;
  kind?: "directory" | "file";
  leadingSlot?: ReactNode;
  trailingSlot?: ReactNode;
  // The row inside a combobox item, which owns selection, highlight and the press.
  selected?: boolean;
  active?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  elevated?: boolean;
  onPress?: () => void;
  testID?: string;
}

// Inside the list a row is a combobox item, which owns the press; elsewhere (a footer action) the
// row is a button of its own.
const InListContext = createContext(false);

/** A list row's content: leading icon, label, description, trailing slot. */
export function ComboboxItem({
  label,
  description,
  kind,
  leadingSlot,
  trailingSlot,
  accessibilityLabel,
  disabled,
  onPress,
  testID,
}: ComboboxItemProps): ReactElement {
  const inList = useContext(InListContext);
  let leading: ReactNode = leadingSlot ?? null;
  if (!leading && kind === "directory") leading = <Folder />;
  else if (!leading && kind === "file") leading = <File />;
  if (!inList) {
    return (
      <Button
        variant="ghost"
        className="w-full justify-start"
        disabled={disabled}
        onClick={onPress}
        aria-label={accessibilityLabel ?? label}
        data-testid={testID}
      >
        {leading}
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        {trailingSlot}
      </Button>
    );
  }
  return (
    <span
      className="flex min-w-0 flex-1 items-center gap-2"
      aria-label={accessibilityLabel ?? label}
      data-testid={testID}
    >
      {leading}
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate">{label}</span>
        {description ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground">{description}</span>
        ) : null}
      </span>
      {trailingSlot}
    </span>
  );
}

type RenderOptionFn = NonNullable<ComboboxProps["renderOption"]>;

function OptionRow({
  option,
  selected,
  onSelect,
  renderOption,
}: {
  option: ComboboxOption;
  selected: boolean;
  onSelect: (id: string) => void;
  renderOption: RenderOptionFn | undefined;
}) {
  const handleSelect = useCallback(() => onSelect(option.id), [onSelect, option.id]);
  return (
    <ComboboxListItem value={option}>
      <InListContext value>
        {renderOption ? (
          renderOption({ option, selected, active: false, onPress: handleSelect })
        ) : (
          <ComboboxItem label={option.label} description={option.description} kind={option.kind} />
        )}
      </InListContext>
    </ComboboxListItem>
  );
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
  }, [setOpen, setQuery]);
  useEffect(() => {
    if (isOpen) setQuery("");
  }, [isOpen, setQuery]);
  const handleRootOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) setOpen(true);
      else handleClose();
    },
    [handleClose, setOpen],
  );
  return { isOpen, searchQuery, setQuery, handleClose, handleRootOpenChange };
}

function HeaderRow({ header, title }: { header: SheetHeader | undefined; title: string }) {
  const { t } = useTranslation();
  if (!header) return <span className="truncate font-medium">{title}</span>;
  const back = header.back;
  return (
    <div className="flex items-center gap-2">
      {back ? (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={back.onPress}
          aria-label={back.accessibilityLabel ?? back.label ?? t("common.actions.back")}
          data-testid="sheet-header-back"
        >
          <ArrowLeft />
        </Button>
      ) : null}
      {header.leading}
      <span className="min-w-0 flex-1 truncate font-medium">{header.title}</span>
      {header.actions ? <div className="flex items-center gap-2">{header.actions}</div> : null}
    </div>
  );
}

/**
 * At least the trigger's width (or `minWidth`), at most 400px unless locked. The triggers are small
 * buttons, so the list sizes to its rows rather than to the trigger as shadcn's input-anchored one
 * does. A fixed height is the model browser's, which pages between views of different lengths.
 */
function frameStyleFor(input: {
  minWidth: number | undefined;
  anchorWidth: number | null;
  lockWidth: boolean;
  fixedHeight: number | undefined;
  availableHeight: string;
}): CSSProperties {
  const floor = Math.max(input.minWidth ?? 0, input.anchorWidth ?? 200);
  return {
    ...(input.lockWidth
      ? { width: floor, minWidth: floor, maxWidth: floor }
      : { width: "auto", minWidth: floor, maxWidth: Math.max(400, floor) }),
    ...(input.fixedHeight != null
      ? { height: `min(${input.availableHeight}, ${input.fixedHeight}px)` }
      : null),
  };
}

function preventDefault(event: Event): void {
  event.preventDefault();
}

function resolvePlaceholder(...candidates: (string | undefined)[]): string | undefined {
  return candidates.find((candidate) => candidate !== undefined);
}

function ComboboxChildren({
  scroll,
  contentClassName,
  children,
}: {
  scroll: boolean;
  contentClassName: string | undefined;
  children: ReactNode;
}) {
  if (!scroll) return <div className="flex min-h-0 flex-1 flex-col">{children}</div>;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={contentClassName}>{children}</div>
    </div>
  );
}

/** A caller's own content (not a list): shadcn's Popover, or a Drawer on a phone. */
function ContentFrame({
  isMobile,
  open,
  onOpenChange,
  anchorRef,
  placement,
  frameStyle,
  onInteractOutside,
  header,
  title,
  stickyHeader,
  footer,
  children,
}: {
  isMobile: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: RefObject<HTMLElement | null>;
  placement: ComboboxDesktopPlacement;
  frameStyle: CSSProperties;
  onInteractOutside: (event: { target: EventTarget | null; preventDefault: () => void }) => void;
  header: SheetHeader | undefined;
  title: string;
  stickyHeader: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const footerView = footer ? <div className="shrink-0 border-t">{footer}</div> : null;
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent
          aria-describedby={undefined}
          data-testid={open ? "combobox-sheet" : undefined}
        >
          <DrawerHeader>
            <DrawerTitle asChild>
              <div>
                <HeaderRow header={header} title={title} />
              </div>
            </DrawerTitle>
          </DrawerHeader>
          {stickyHeader}
          {children}
          {footerView}
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={anchorRef as RefObject<HTMLElement>} />
      <PopoverContent
        side={placement === "top-start" ? "top" : "bottom"}
        align="start"
        collisionPadding={16}
        data-testid={open ? "combobox-desktop-container" : undefined}
        onInteractOutside={onInteractOutside}
        // A dialog opened over the list (provider settings, shortcuts) takes focus; the list stays.
        onFocusOutside={preventDefault}
        style={frameStyle}
        className="flex flex-col overflow-hidden p-0"
      >
        {header ? (
          <div className="px-2 pt-2">
            <HeaderRow header={header} title={title} />
          </div>
        ) : null}
        {stickyHeader}
        {children}
        {footerView}
      </PopoverContent>
    </Popover>
  );
}

function isInRadixLayer(event: Event | undefined): boolean {
  const target =
    event instanceof FocusEvent ? (event.relatedTarget ?? event.target) : event?.target;
  return (
    target instanceof Element && target.closest("[data-radix-popper-content-wrapper]") !== null
  );
}

const optionId = (option: ComboboxOption) => option.id;
const listTestId = (isMobile: boolean) =>
  isMobile ? "combobox-sheet" : "combobox-desktop-container";
const optionLabel = (option: ComboboxOption) => option.label;
const sameOption = (left: ComboboxOption, right: ComboboxOption) => left.id === right.id;

interface ListOpenChangeDetails {
  reason: string;
  event: Event | undefined;
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
  const { t } = useTranslation();
  const isMobile = useIsCompactFormFactor();
  const { isOpen, searchQuery, setQuery, handleClose, handleRootOpenChange } = useComboboxOpenState(
    { open, onOpenChange, onSearchQueryChange },
  );
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
  const selectedOption = useMemo(
    () => options.find((option) => option.id === value) ?? null,
    [options, value],
  );
  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id);
      if (!keepOpenOnSelect) handleClose();
    },
    [handleClose, keepOpenOnSelect, onSelect],
  );
  // The trigger toggles the list itself; a press on it is not an outside press.
  const isAnchorEvent = useCallback(
    (target: EventTarget | null | undefined) => {
      const anchor = anchorRef.current;
      return Boolean(anchor && target instanceof Node && anchor.contains(target));
    },
    [anchorRef],
  );
  const handleInteractOutside = useCallback(
    (event: { target: EventTarget | null; preventDefault: () => void }) => {
      if (isAnchorEvent(event.target)) event.preventDefault();
    },
    [isAnchorEvent],
  );
  const handleListOpenChange = useCallback(
    (nextOpen: boolean, details: ListOpenChangeDetails) => {
      if (!nextOpen && details.reason === "outside-press" && isAnchorEvent(details.event?.target))
        return;
      // A row's own menu (a Radix dropdown in <body>) takes the pointer and focus; the list stays.
      if (!nextOpen && isInRadixLayer(details.event)) return;
      // A pick closes the list through handleSelect, which knows about keepOpenOnSelect.
      if (!nextOpen && details.reason === "item-press") return;
      handleRootOpenChange(nextOpen);
    },
    [handleRootOpenChange, isAnchorEvent],
  );
  const handleValueChange = useCallback(
    (next: ComboboxOption | null) => {
      if (next) handleSelect(next.id);
    },
    [handleSelect],
  );
  const headerSearch = header?.search;
  // A header search filters upstream (the caller's options already are); the query is the input's.
  const [headerQuery, setHeaderQuery] = useState("");
  const handleInputValueChange = useCallback(
    (query: string, details: { reason: string }) => {
      // Only typing edits the query; a pick or a close does not refill it with a label.
      if (details.reason !== "input-change" && details.reason !== "input-clear") return;
      if (headerSearch) {
        setHeaderQuery(query);
        headerSearch.onChange(query);
      } else setQuery(query);
    },
    [headerSearch, setQuery],
  );
  useEffect(() => {
    if (isOpen) setHeaderQuery("");
  }, [isOpen]);
  const frameStyle = useMemo(
    () =>
      frameStyleFor({
        minWidth: desktopMinWidth,
        anchorWidth,
        lockWidth: desktopLockWidth,
        fixedHeight: desktopFixedHeight,
        availableHeight: children
          ? "var(--radix-popover-content-available-height)"
          : "var(--available-height)",
      }),
    [anchorWidth, children, desktopFixedHeight, desktopLockWidth, desktopMinWidth],
  );

  const resolvedTitle = title ?? t("common.actions.select");
  if (children) {
    return (
      <ContentFrame
        isMobile={isMobile}
        open={isOpen}
        onOpenChange={handleRootOpenChange}
        anchorRef={anchorRef}
        placement={desktopPlacement}
        frameStyle={frameStyle}
        onInteractOutside={handleInteractOutside}
        header={header}
        title={resolvedTitle}
        stickyHeader={stickyHeader}
        footer={footer}
      >
        {headerSearch ? (
          <div className="p-2">
            <SheetSearchField search={headerSearch} />
          </div>
        ) : null}
        <ComboboxChildren
          scroll={isMobile ? mobileChildrenScrollEnabled : desktopChildrenScrollEnabled}
          contentClassName={isMobile ? mobileChildrenContentClassName : undefined}
        >
          {children}
        </ComboboxChildren>
      </ContentFrame>
    );
  }

  return (
    <ComboboxRoot
      items={visibleOptions}
      filter={null}
      open={isOpen}
      onOpenChange={handleListOpenChange}
      value={selectedOption}
      onValueChange={handleValueChange}
      inputValue={headerSearch ? headerQuery : searchQuery}
      onInputValueChange={handleInputValueChange}
      itemToStringValue={optionId}
      itemToStringLabel={optionLabel}
      isItemEqualToValue={sameOption}
      autoHighlight
    >
      <ListPopup
        open={isOpen}
        isMobile={isMobile}
        anchorRef={anchorRef}
        placement={desktopPlacement}
        frameStyle={frameStyle}
        header={header}
        title={resolvedTitle}
        search={Boolean(headerSearch) || searchable}
        searchLabel={resolvePlaceholder(headerSearch?.placeholder, searchPlaceholder, placeholder)}
        searchTestID={headerSearch?.testID}
        stickyHeader={stickyHeader}
        emptyText={emptyText}
        value={value}
        onSelect={handleSelect}
        renderOption={renderOption}
        footer={footer}
      />
    </ComboboxRoot>
  );
}

function ListPopup({
  open,
  isMobile,
  anchorRef,
  placement,
  frameStyle,
  header,
  title,
  search,
  searchLabel,
  searchTestID,
  stickyHeader,
  emptyText,
  value,
  onSelect,
  renderOption,
  footer,
}: {
  open: boolean;
  isMobile: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  placement: ComboboxDesktopPlacement;
  frameStyle: CSSProperties;
  header: SheetHeader | undefined;
  title: string;
  search: boolean;
  searchLabel: string | undefined;
  searchTestID: string | undefined;
  stickyHeader: ReactNode;
  emptyText: string | undefined;
  value: string;
  onSelect: (id: string) => void;
  renderOption: RenderOptionFn | undefined;
  footer: ReactNode;
}) {
  const { t } = useTranslation();
  const label = searchLabel ?? t("common.placeholders.search");
  // In a Radix dialog the list portals into it: the dialog traps focus, takes pointer events from
  // everything outside it and closes on a press outside, so a list in <body> could not be used.
  const container = anchorRef.current?.closest<HTMLElement>('[role="dialog"]') ?? undefined;
  return (
    <ComboboxContent
      anchor={anchorRef}
      container={container}
      side={placement === "top-start" ? "top" : "bottom"}
      // The phone layout keeps the test id its drawer had. A list still closing has none, so it
      // is not mistaken for the next one opening.
      data-testid={open ? listTestId(isMobile) : undefined}
      style={isMobile ? undefined : frameStyle}
      // A phone has room for one list across the screen, as its drawer was.
      className={cn("flex flex-col", isMobile && "w-(--available-width) max-w-none")}
    >
      {header ? (
        <div className="px-2 pt-2">
          <HeaderRow header={header} title={title} />
        </div>
      ) : null}
      {search ? (
        <ComboboxInput
          showTrigger={false}
          placeholder={label}
          aria-label={label}
          autoCapitalize="none"
          data-testid={searchTestID}
        />
      ) : (
        // The Combobox takes its arrow and Enter keys on its input; a list without a search keeps
        // one, read-only and out of sight, to hold focus.
        <div className="sr-only">
          <ComboboxInput showTrigger={false} readOnly aria-label={title} />
        </div>
      )}
      {stickyHeader}
      <ComboboxEmptyRow data-testid="combobox-empty-text">
        {emptyText ?? t("common.empty.noOptionsMatchSearch")}
      </ComboboxEmptyRow>
      <ComboboxList className="min-h-0 flex-1">
        {(option: ComboboxOption) => (
          <OptionRow
            key={option.id}
            option={option}
            selected={option.id === value}
            onSelect={onSelect}
            renderOption={renderOption}
          />
        )}
      </ComboboxList>
      {footer ? <div className="shrink-0 border-t">{footer}</div> : null}
    </ComboboxContent>
  );
}
