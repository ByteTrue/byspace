// Override of packages/app/src/components/adaptive-modal-sheet.tsx: a dialog on desktop and a
// bottom drawer on a phone, with the same header (back, leading icon, title, actions, close,
// search), body and footer strip.
import { useCallback, useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft, Search, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useTranslation } from "react-i18next";
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import { useIsCompactFormFactor } from "@/constants/layout";
import { ICON_SIZE } from "@/styles/theme";
import { cn } from "cn";
import { SnapDrawer } from "~/components/snap-drawer";
import { DrawerTitle } from "~/components/ui/drawer";

export { AdaptiveTextInput, type AdaptiveTextInputProps } from "@/components/adaptive-text-input";

// Horizontal indent token shared by the sheet header (title, back arrow,
// leading icon, search input icon) and any row primitive rendered inside the
// sheet body. Rows whose leading icon should line up with the header must
// match this padding.
export const SHEET_HORIZONTAL_PADDING_SCALE = 6;

export interface SheetHeaderSearch {
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  resetKey?: string | number;
  placeholder?: string;
  autoFocus?: boolean;
  testID?: string;
}

export interface SheetHeaderBack {
  onPress: () => void;
  label?: string;
  accessibilityLabel?: string;
}

export interface SheetHeader {
  title: string;
  subtitle?: ReactNode;
  back?: SheetHeaderBack;
  leading?: ReactNode;
  actions?: ReactNode;
  search?: SheetHeaderSearch;
}

const WEB_EXIT_DURATION_MS = 160;
const ICON_BUTTON =
  "flex shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:text-foreground";

export function SheetHeaderView({
  header,
  onClose,
  showCloseButton = true,
  testID,
}: {
  header: SheetHeader;
  onClose: () => void;
  showCloseButton?: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  const back = header.back;
  const search = header.search;
  return (
    <div className="shrink-0 border-b" data-testid={testID}>
      <div className="flex items-center gap-2 px-6 py-4">
        {back ? (
          <button
            type="button"
            onClick={back.onPress}
            aria-label={back.accessibilityLabel ?? back.label ?? t("common.actions.back")}
            data-testid="sheet-header-back"
            className={ICON_BUTTON}
          >
            <ArrowLeft size={18} />
          </button>
        ) : null}
        {header.leading ? (
          <div className="flex items-center justify-center">{header.leading}</div>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-sm leading-[normal] font-medium text-foreground">
            {header.title}
          </span>
          {header.subtitle}
        </div>
        {header.actions ? <div className="flex items-center gap-2">{header.actions}</div> : null}
        {showCloseButton ? (
          <button
            type="button"
            aria-label={t("common.actions.close")}
            onClick={onClose}
            className={cn(ICON_BUTTON, "p-2")}
          >
            <X size={16} />
          </button>
        ) : null}
      </div>
      {search ? (
        <div className="flex items-center gap-2 px-6 pb-3" data-sheet-search="">
          <Search size={ICON_SIZE.md} className="shrink-0 text-muted-foreground" />
          <AdaptiveTextInput
            className="min-w-0 flex-1 bg-transparent py-2 text-sm leading-[normal] outline-none"
            placeholder={search.placeholder ?? t("common.actions.search")}
            resetKey={search.resetKey}
            onChangeText={search.onChange}
            onFocus={search.onFocus}
            onBlur={search.onBlur}
            autoCapitalize="none"
            autoCorrect="off"
            autoFocus={search.autoFocus}
            testID={search.testID}
          />
        </div>
      ) : null}
    </div>
  );
}

/** The header inside a desktop combobox popover: a row only when it has controls, then search. */
export function InlineHeaderView({ header }: { header: SheetHeader }) {
  const { t } = useTranslation();
  const back = header.back;
  const hasInlineRow = Boolean(back || header.leading || header.actions);
  if (!hasInlineRow && !header.search) return null;
  return (
    <div className="shrink-0">
      {hasInlineRow ? (
        <div className="flex items-center gap-2 px-3 pt-2">
          {back ? (
            <button
              type="button"
              onClick={back.onPress}
              aria-label={back.accessibilityLabel ?? back.label ?? t("common.actions.back")}
              data-testid="sheet-header-back"
              className={ICON_BUTTON}
            >
              <ArrowLeft size={16} />
            </button>
          ) : null}
          {header.leading ? (
            <div className="flex items-center justify-center">{header.leading}</div>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {header.title}
          </span>
          {header.actions ? <div className="flex items-center gap-2">{header.actions}</div> : null}
        </div>
      ) : null}
      {header.search ? (
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search size={ICON_SIZE.sm} className="shrink-0 text-muted-foreground" />
          <AdaptiveTextInput
            className="min-w-0 flex-1 bg-transparent py-2 text-sm leading-[normal] outline-none"
            placeholder={header.search.placeholder ?? t("common.actions.search")}
            resetKey={header.search.resetKey}
            onChangeText={header.search.onChange}
            onFocus={header.search.onFocus}
            onBlur={header.search.onBlur}
            autoCapitalize="none"
            autoCorrect="off"
            autoFocus={header.search.autoFocus}
            testID={header.search.testID}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * packages/app centres the card in an overlay padded 24px on every side, so a percentage height
 * is of the viewport less 48px; here the card is fixed to the viewport, so the inset is put back.
 */
function insetPercent(height: number | string | undefined): number | string | undefined {
  if (typeof height !== "string" || !height.endsWith("%")) return height;
  return `calc((100% - 3rem) * ${Number.parseFloat(height) / 100})`;
}

export interface AdaptiveModalSheetProps {
  header: SheetHeader;
  visible: boolean;
  onClose: () => void;
  /** After the close animation has finished. */
  onDismiss?: () => void;
  children: ReactNode;
  /** Sticky footer rendered below the scrollable content. */
  footer?: ReactNode;
  footerClassName?: string;
  /** Drawer snap points on a phone, as fractions ("65%") of the screen. */
  snapPoints?: string[];
  testID?: string;
  /** Override the max width of the desktop card. */
  desktopMaxWidth?: number;
  /** Bound an author-owned list without changing content-sized first-party dialogs. */
  desktopHeight?: number | string;
  /** Whether the host supplies the scroll container. */
  scrollable?: boolean;
  presentation?: "push" | "replace";
  /** Full body viewport below the header, including space beyond the content. */
  bodyClassName?: string;
  /** Layout for the sheet body, over the sheet's own content inset. */
  contentClassName?: string;
  contentStyle?: CSSProperties;
  sizeContentToCurrentSnapPoint?: boolean;
  contextBridge?: unknown;
}

function toSnapFraction(point: string): number {
  const value = Number.parseFloat(point);
  return point.trim().endsWith("%") ? value / 100 : value;
}

export function AdaptiveModalSheet({
  header,
  visible,
  onClose,
  onDismiss,
  children,
  footer,
  footerClassName,
  snapPoints,
  testID,
  desktopMaxWidth,
  desktopHeight,
  scrollable = true,
  contentClassName,
  contentStyle,
  bodyClassName,
}: AdaptiveModalSheetProps) {
  const isMobile = useIsCompactFormFactor();
  const fractions = useMemo(() => (snapPoints ?? ["65%", "90%"]).map(toSnapFraction), [snapPoints]);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const wasVisibleRef = useRef(visible);

  // The dialog has no "closed and gone" event; report it once the exit animation is over.
  useEffect(() => {
    const wasVisible = wasVisibleRef.current;
    wasVisibleRef.current = visible;
    if (visible || !wasVisible || isMobile) return;
    const timeout = window.setTimeout(() => onDismissRef.current?.(), WEB_EXIT_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [isMobile, visible]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );
  const desktopStyle = useMemo(
    () => ({ maxWidth: desktopMaxWidth ?? 520, height: insetPercent(desktopHeight) }),
    [desktopHeight, desktopMaxWidth],
  );
  // On open packages/app focuses an autoFocus header search, and otherwise shows no focus at all.
  // Radix's own open focus takes the first button (the close X), and after a menu or the keyboard
  // the browser draws its ring, so the card itself takes focus instead (Tab still reaches the X).
  // A field the body focuses itself is already focused by now, and Radix leaves it there.
  const autoFocusSearch = Boolean(header.search?.autoFocus);
  const handleOpenAutoFocus = useCallback(
    (event: Event) => {
      if (!(event.currentTarget instanceof HTMLElement)) return;
      const field = autoFocusSearch
        ? event.currentTarget.querySelector<HTMLElement>(
            "[data-sheet-search] input, [data-sheet-search] textarea",
          )
        : null;
      event.preventDefault();
      (field ?? event.currentTarget).focus();
    },
    [autoFocusSearch],
  );
  const handleDrawerAnimationEnd = useCallback((open: boolean) => {
    if (!open) onDismissRef.current?.();
  }, []);

  const body = (
    <div
      className={cn(
        "relative flex min-h-0 flex-1 flex-col",
        !scrollable && "overflow-hidden",
        bodyClassName,
      )}
    >
      {scrollable ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div
            className={cn("flex grow flex-col gap-4 p-6", contentClassName)}
            style={contentStyle}
          >
            {children}
          </div>
        </div>
      ) : (
        <div
          className={cn("flex min-h-0 flex-1 flex-col gap-4 p-6", contentClassName)}
          style={contentStyle}
        >
          {children}
        </div>
      )}
    </div>
  );
  const footerView = footer ? (
    <div
      className={cn(
        "flex shrink-0 items-center justify-between gap-2 border-t bg-muted/50 px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-3",
        footerClassName,
      )}
    >
      {footer}
    </div>
  ) : null;

  if (isMobile) {
    return (
      <SnapDrawer
        open={visible}
        onOpenChange={handleOpenChange}
        snapPoints={fractions}
        onAnimationEnd={handleDrawerAnimationEnd}
        data-testid={testID}
        aria-describedby={undefined}
        className="bg-background"
      >
        <DrawerTitle className="sr-only">{header.title}</DrawerTitle>
        <SheetHeaderView header={header} onClose={onClose} />
        {body}
        {footerView}
      </SnapDrawer>
    );
  }

  return (
    <DialogPrimitive.Root open={visible} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        {/* The card sits inside the overlay (Radix's "scrollable overlay" shape), as packages/app's
            card sits inside its overlay view: the testID names both, so a test can reach the
            card's controls through it and the overlay still covers the page. */}
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-black/50 duration-150 data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0"
          data-testid={testID}
        >
          <DialogPrimitive.Content
            aria-describedby={undefined}
            onOpenAutoFocus={handleOpenAutoFocus}
            className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc((100%-3rem)*0.85)] w-[calc(100%-3rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg outline-none duration-150 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95"
            style={desktopStyle}
          >
            <DialogPrimitive.Title className="sr-only">{header.title}</DialogPrimitive.Title>
            <SheetHeaderView header={header} onClose={onClose} />
            {body}
            {footerView}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
