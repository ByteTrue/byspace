// shadcn's responsive dialog: a Dialog on desktop and a bottom Drawer on a phone, with one header
// (back, leading icon, title, subtitle, actions, search), body and footer.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ArrowLeft, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useIsCompactFormFactor } from "@/constants/layout";
import { cn } from "cn";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "~/components/ui/drawer";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";

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

// The dialog's close animation (shadcn's data-closed duration).
const EXIT_DURATION_MS = 200;

/** A header search field: shadcn's input group with the search icon. */
export function SheetSearchField({ search }: { search: SheetHeaderSearch }) {
  const { t } = useTranslation();
  const { onChange } = search;
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
    [onChange],
  );
  const placeholder = search.placeholder ?? t("common.actions.search");
  return (
    <InputGroup data-sheet-search="">
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput
        key={search.resetKey}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={handleChange}
        onFocus={search.onFocus}
        onBlur={search.onBlur}
        autoCapitalize="none"
        autoCorrect="off"
        autoFocus={search.autoFocus}
        data-testid={search.testID}
      />
    </InputGroup>
  );
}

function SheetHeaderRow({
  header,
  Title,
  Description,
}: {
  header: SheetHeader;
  Title: typeof DialogTitle | typeof DrawerTitle;
  Description: typeof DialogDescription | typeof DrawerDescription;
}) {
  const { t } = useTranslation();
  const back = header.back;
  return (
    <div className="flex items-center gap-2">
      {back ? (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={back.onPress}
          aria-label={back.accessibilityLabel ?? back.label ?? t("common.actions.back")}
          data-testid="sheet-header-back"
        >
          <ArrowLeft />
        </Button>
      ) : null}
      {header.leading}
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-left">
        <Title className="truncate">{header.title}</Title>
        {header.subtitle ? <Description asChild>{header.subtitle}</Description> : null}
      </div>
      {header.actions ? <div className="flex items-center gap-2">{header.actions}</div> : null}
    </div>
  );
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
  testID?: string;
  /** Override the max width of the desktop dialog. */
  desktopMaxWidth?: number;
  /** Bound an author-owned list without changing content-sized dialogs. */
  desktopHeight?: number | string;
  /** Whether the dialog supplies the scroll container. */
  scrollable?: boolean;
  /** Full body viewport below the header, including space beyond the content. */
  bodyClassName?: string;
  /** Layout for the body. */
  contentClassName?: string;
  contentStyle?: CSSProperties;
}

export function AdaptiveModalSheet({
  header,
  visible,
  onClose,
  onDismiss,
  children,
  footer,
  footerClassName,
  testID,
  desktopMaxWidth,
  desktopHeight,
  scrollable = true,
  contentClassName,
  contentStyle,
  bodyClassName,
}: AdaptiveModalSheetProps) {
  const isMobile = useIsCompactFormFactor();
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const wasVisibleRef = useRef(visible);

  // The dialog has no "closed and gone" event; report it once the exit animation is over.
  useEffect(() => {
    const wasVisible = wasVisibleRef.current;
    wasVisibleRef.current = visible;
    if (visible || !wasVisible || isMobile) return;
    const timeout = window.setTimeout(() => onDismissRef.current?.(), EXIT_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [isMobile, visible]);

  // Radix returns focus to a DialogTrigger, and these dialogs open from state without one; on close
  // focus goes back to what had it when the dialog opened. Captured before the dialog moves focus.
  const openerRef = useRef<Element | null>(null);
  useLayoutEffect(() => {
    if (visible) openerRef.current = document.activeElement;
  }, [visible]);
  const handleCloseAutoFocus = useCallback((event: Event) => {
    const opener = openerRef.current;
    if (!(opener instanceof HTMLElement) || !opener.isConnected || opener === document.body) return;
    event.preventDefault();
    opener.focus();
  }, []);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );
  const handleDrawerAnimationEnd = useCallback((open: boolean) => {
    if (!open) onDismissRef.current?.();
  }, []);
  const desktopStyle = useMemo(
    () => ({ maxWidth: desktopMaxWidth ?? 520, height: desktopHeight }),
    [desktopHeight, desktopMaxWidth],
  );
  // An autoFocus header search takes focus on open; otherwise shadcn's default.
  const autoFocusSearch = Boolean(header.search?.autoFocus);
  const handleOpenAutoFocus = useCallback(
    (event: Event) => {
      if (!autoFocusSearch || !(event.currentTarget instanceof HTMLElement)) return;
      const field = event.currentTarget.querySelector<HTMLElement>("[data-sheet-search] input");
      if (!field) return;
      event.preventDefault();
      field.focus();
    },
    [autoFocusSearch],
  );

  const body = (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-4",
        scrollable ? "overflow-y-auto" : "overflow-hidden",
        bodyClassName,
        contentClassName,
      )}
      style={contentStyle}
    >
      {children}
    </div>
  );

  if (isMobile) {
    return (
      <Drawer
        open={visible}
        onOpenChange={handleOpenChange}
        onAnimationEnd={handleDrawerAnimationEnd}
      >
        <DrawerContent
          data-testid={testID}
          aria-describedby={undefined}
          onCloseAutoFocus={handleCloseAutoFocus}
        >
          <DrawerHeader>
            <SheetHeaderRow header={header} Title={DrawerTitle} Description={DrawerDescription} />
            {header.search ? <SheetSearchField search={header.search} /> : null}
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">{body}</div>
          {footer ? <DrawerFooter className={footerClassName}>{footer}</DrawerFooter> : null}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={visible} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid={testID}
        aria-describedby={undefined}
        onOpenAutoFocus={handleOpenAutoFocus}
        onCloseAutoFocus={handleCloseAutoFocus}
        className="flex max-h-[85vh] flex-col"
        style={desktopStyle}
      >
        <DialogHeader className="pr-8">
          <SheetHeaderRow header={header} Title={DialogTitle} Description={DialogDescription} />
          {header.search ? <SheetSearchField search={header.search} /> : null}
        </DialogHeader>
        {body}
        {footer ? <DialogFooter className={footerClassName}>{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  );
}
