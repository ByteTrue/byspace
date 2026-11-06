import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ComponentProps,
  type FocusEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { useIsCompactFormFactor } from "@/constants/layout";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "~/components/ui/hover-card";
import { cn } from "cn";

const InfoHoverCardCloseContext = createContext<() => void>(() => {});

function preventFocusOpen(event: FocusEvent) {
  event.preventDefault();
}

/**
 * Information worth a popover card, rather than an icon button's short name.
 * Compose with InfoHoverCardTrigger and InfoHoverCardContent. The shared policy is
 * immediate open, 100ms grace across the portal gap, no focus-open, and no hover on compact.
 */
export function InfoHoverCard({
  disabled = false,
  open: controlledOpen,
  onOpenChange,
  children,
}: {
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const isCompact = useIsCompactFormFactor();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const handleOpenChange = useCallback(
    (next: boolean) => {
      const visible = next && !disabled && !isCompact;
      setUncontrolledOpen(visible);
      onOpenChange?.(visible);
    },
    [disabled, isCompact, onOpenChange],
  );
  const close = useCallback(() => handleOpenChange(false), [handleOpenChange]);
  const open = controlledOpen ?? uncontrolledOpen;
  const isOpen = useMemo(() => open && !disabled && !isCompact, [disabled, isCompact, open]);
  return (
    <InfoHoverCardCloseContext.Provider value={close}>
      <HoverCard open={isOpen} onOpenChange={handleOpenChange} openDelay={0} closeDelay={100}>
        {children}
      </HoverCard>
    </InfoHoverCardCloseContext.Provider>
  );
}

export function InfoHoverCardTrigger({ children }: { children: ReactElement }) {
  const close = useContext(InfoHoverCardCloseContext);
  const triggerRef = useCallback(
    (node: HTMLAnchorElement | null) => {
      if (!node) close();
    },
    [close],
  );
  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse") close();
    },
    [close],
  );
  return (
    <HoverCardTrigger
      asChild
      ref={triggerRef}
      onFocus={preventFocusOpen}
      onPointerDown={onPointerDown}
    >
      {children}
    </HoverCardTrigger>
  );
}

export function InfoHoverCardContent({
  className,
  collisionPadding = 8,
  readOnly = false,
  ...props
}: ComponentProps<typeof HoverCardContent> & { readOnly?: boolean }) {
  return (
    <HoverCardContent
      collisionPadding={collisionPadding}
      data-info-hover-card-read-only={readOnly ? "" : undefined}
      className={cn("w-[260px] p-2.5 text-sm leading-[1.4]", className)}
      data-testid="info-hover-card"
      {...props}
    />
  );
}
