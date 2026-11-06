import {
  useCallback,
  useMemo,
  useState,
  type ComponentProps,
  type FocusEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { useIsCompactFormFactor } from "@/constants/layout";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "~/components/ui/hover-card";
import { cn } from "cn";

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
      const visible = next && !disabled;
      setUncontrolledOpen(visible);
      onOpenChange?.(visible);
    },
    [disabled, onOpenChange],
  );
  const open = controlledOpen ?? uncontrolledOpen;
  const isOpen = useMemo(() => open && !disabled && !isCompact, [disabled, isCompact, open]);
  return (
    <HoverCard open={isOpen} onOpenChange={handleOpenChange} openDelay={0} closeDelay={100}>
      {children}
    </HoverCard>
  );
}

export function InfoHoverCardTrigger({ children }: { children: ReactElement }) {
  return (
    <HoverCardTrigger asChild onFocus={preventFocusOpen}>
      {children}
    </HoverCardTrigger>
  );
}

export function InfoHoverCardContent({
  className,
  collisionPadding = 8,
  ...props
}: ComponentProps<typeof HoverCardContent>) {
  return (
    <HoverCardContent
      collisionPadding={collisionPadding}
      className={cn("w-[260px] p-2.5 text-sm leading-[1.4]", className)}
      data-testid="info-hover-card"
      {...props}
    />
  );
}
