// A searchable list anchored to a trigger the caller owns: shadcn's Popover + Command on desktop and
// Drawer + Command on a phone. The options are filtered and ranked by combobox-options (Command's
// own filter is off), and Command owns the highlighted row and the arrow and Enter keys.
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
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
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

const DEFAULT_MAX_HEIGHT = 400;

export interface ComboboxItemProps {
  label: string;
  description?: string;
  kind?: "directory" | "file";
  leadingSlot?: ReactNode;
  trailingSlot?: ReactNode;
  // The row inside a CommandItem, which owns selection, highlight and the press.
  selected?: boolean;
  active?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  elevated?: boolean;
  onPress?: () => void;
  testID?: string;
}

// Inside the list a row is a Command item, which owns the press; elsewhere (a footer action) the
// row is a button of its own.
const InCommandListContext = createContext(false);

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
  const inList = useContext(InCommandListContext);
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

export function ComboboxEmpty({ children }: { children: ReactNode }): ReactElement {
  return <CommandEmpty data-testid="combobox-empty-text">{children}</CommandEmpty>;
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
    <CommandItem value={option.id} onSelect={handleSelect} data-checked={selected}>
      <InCommandListContext value>
        {renderOption ? (
          renderOption({ option, selected, active: false, onPress: handleSelect })
        ) : (
          <ComboboxItem label={option.label} description={option.description} kind={option.kind} />
        )}
      </InCommandListContext>
    </CommandItem>
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

/** At least the trigger's width (or `minWidth`), at most 400px unless locked; height capped. */
function frameStyleFor(input: {
  minWidth: number | undefined;
  anchorWidth: number | null;
  lockWidth: boolean;
  fixedHeight: number | undefined;
}): CSSProperties {
  const floor = Math.max(input.minWidth ?? 0, input.anchorWidth ?? 200);
  const heightCap = input.fixedHeight ?? DEFAULT_MAX_HEIGHT;
  return {
    ...(input.lockWidth
      ? { width: floor, minWidth: floor, maxWidth: floor }
      : { width: "auto", minWidth: floor, maxWidth: Math.max(400, floor) }),
    maxHeight: `min(var(--radix-popover-content-available-height), ${heightCap}px)`,
    ...(input.fixedHeight != null
      ? { height: `min(var(--radix-popover-content-available-height), ${input.fixedHeight}px)` }
      : null),
  };
}

function preventDefault(event: Event): void {
  event.preventDefault();
}

function focusCommandRoot(event: Event): void {
  if (!(event.currentTarget instanceof HTMLElement)) return;
  const target =
    event.currentTarget.querySelector<HTMLElement>("[cmdk-input]") ??
    event.currentTarget.querySelector<HTMLElement>("[cmdk-root]");
  if (!target) return;
  event.preventDefault();
  target.focus();
}

// Command's own filter is off: the options arrive filtered and ranked.
function ComboboxCommand({
  search,
  searchTestID,
  searchPlaceholder,
  onSearchChange,
  emptyText,
  options,
  value,
  onSelect,
  renderOption,
}: {
  search: boolean;
  searchTestID: string | undefined;
  searchPlaceholder: string | undefined;
  onSearchChange: (query: string) => void;
  emptyText: string;
  options: ComboboxOption[];
  value: string;
  onSelect: (id: string) => void;
  renderOption: RenderOptionFn | undefined;
}) {
  const { t } = useTranslation();
  return (
    <Command shouldFilter={false} tabIndex={-1} className="min-h-0 flex-1">
      {search ? (
        <CommandInput
          placeholder={searchPlaceholder ?? t("common.placeholders.search")}
          aria-label={searchPlaceholder ?? t("common.placeholders.search")}
          onValueChange={onSearchChange}
          autoFocus
          data-testid={searchTestID}
        />
      ) : null}
      <CommandList>
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
        {options.map((option) => (
          <OptionRow
            key={option.id}
            option={option}
            selected={option.id === value}
            onSelect={onSelect}
            renderOption={renderOption}
          />
        ))}
      </CommandList>
    </Command>
  );
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

function ComboboxFrame({
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
        onOpenAutoFocus={focusCommandRoot}
        onInteractOutside={onInteractOutside}
        // A dialog opened over the list (provider settings, shortcuts) takes focus; the list stays.
        onFocusOutside={preventDefault}
        style={frameStyle}
        className="overflow-hidden p-0"
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
  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id);
      if (!keepOpenOnSelect) handleClose();
    },
    [handleClose, keepOpenOnSelect, onSelect],
  );
  // The trigger toggles the list itself; a press on it is not an outside press.
  const handleInteractOutside = useCallback(
    (event: { target: EventTarget | null; preventDefault: () => void }) => {
      const anchor = anchorRef.current;
      if (anchor && event.target instanceof Node && anchor.contains(event.target))
        event.preventDefault();
    },
    [anchorRef],
  );
  const headerSearch = header?.search;
  const handleSearchChange = useCallback(
    (query: string) => {
      if (headerSearch) headerSearch.onChange(query);
      else setQuery(query);
    },
    [headerSearch, setQuery],
  );
  const frameStyle = useMemo(
    () =>
      frameStyleFor({
        minWidth: desktopMinWidth,
        anchorWidth,
        lockWidth: desktopLockWidth,
        fixedHeight: desktopFixedHeight,
      }),
    [anchorWidth, desktopFixedHeight, desktopLockWidth, desktopMinWidth],
  );

  const resolvedTitle = title ?? t("common.actions.select");
  const body = children ? (
    <>
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
    </>
  ) : (
    <ComboboxCommand
      search={Boolean(headerSearch) || searchable}
      searchTestID={headerSearch?.testID}
      searchPlaceholder={resolvePlaceholder(
        headerSearch?.placeholder,
        searchPlaceholder,
        placeholder,
      )}
      onSearchChange={handleSearchChange}
      emptyText={emptyText ?? t("common.empty.noOptionsMatchSearch")}
      options={visibleOptions}
      value={value}
      onSelect={handleSelect}
      renderOption={renderOption}
    />
  );

  return (
    <ComboboxFrame
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
      {body}
    </ComboboxFrame>
  );
}
