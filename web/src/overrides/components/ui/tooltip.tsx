// Override of packages/app/src/components/ui/tooltip.tsx on shadcn's Tooltip. Same props; a
// tooltip that is off for the current form factor never opens, and a hint never covers the menu or
// picker its trigger has open.
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type ComponentProps,
  type CSSProperties,
  type PointerEvent,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  Tooltip as ShadTooltip,
  TooltipContent as ShadTooltipContent,
  TooltipTrigger as ShadTooltipTrigger,
} from "~/components/ui/tooltip";

/** True inside tooltip content, so nested text can pick tooltip colours. */
export const TooltipSurfaceContext = createContext(false);
const TooltipEnabledContext = createContext(true);
const TooltipTriggerNodeContext = createContext<RefObject<HTMLElement | null> | null>(null);
/**
 * A press on the trigger closes the hint and keeps it closed until the pointer leaves, as the Expo
 * tooltip does. The press closes it directly: Radix compares a close against the `open` prop, which
 * has not caught up yet when the pointer opened the hint a moment before the press.
 */
interface TooltipPress {
  pressedRef: RefObject<boolean>;
  press: () => void;
}
const TooltipPressContext = createContext<TooltipPress | null>(null);

/** The trigger, or something inside it (a wrapped picker button), has its popup open. */
function hasExpandedPopup(node: HTMLElement | null): boolean {
  if (!node) return false;
  return (
    node.getAttribute("aria-expanded") === "true" ||
    node.querySelector('[aria-expanded="true"]') !== null
  );
}

/**
 * A hint opens for a pointer over the trigger or for keyboard focus on it, not for focus a closing
 * menu or dialog hands back to it.
 */
function canOpen(node: HTMLElement | null): boolean {
  if (!node) return true;
  if (hasExpandedPopup(node)) return false;
  if (node.matches(":hover")) return true;
  if (!node.contains(document.activeElement)) return true;
  return node.matches(":focus-visible") || node.querySelector(":focus-visible") !== null;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T) {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as { current: T }).current = value;
}

export function Tooltip({
  open,
  defaultOpen,
  onOpenChange,
  delayDuration = 0,
  enabledOnDesktop = true,
  enabledOnMobile = false,
  children,
}: PropsWithChildren<{
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  delayDuration?: number;
  enabledOnDesktop?: boolean;
  enabledOnMobile?: boolean;
}>): ReactElement {
  const isCompact = useIsCompactFormFactor();
  const enabled = isCompact ? enabledOnMobile : enabledOnDesktop;
  const triggerNodeRef = useRef<HTMLElement | null>(null);
  const pressedRef = useRef(false);
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
  const isOpen = open ?? internalOpen;
  const press = useMemo<TooltipPress>(
    () => ({
      pressedRef,
      press: () => {
        pressedRef.current = true;
        setInternalOpen(false);
        onOpenChange?.(false);
      },
    }),
    [onOpenChange],
  );
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next && pressedRef.current) return;
      if (next && !canOpen(triggerNodeRef.current)) return;
      setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  return (
    <TooltipEnabledContext value={enabled}>
      <TooltipTriggerNodeContext value={triggerNodeRef}>
        <TooltipPressContext value={press}>
          <ShadTooltip
            open={enabled && isOpen && !hasExpandedPopup(triggerNodeRef.current)}
            onOpenChange={handleOpenChange}
            delayDuration={delayDuration}
          >
            {children}
          </ShadTooltip>
        </TooltipPressContext>
      </TooltipTriggerNodeContext>
    </TooltipEnabledContext>
  );
}

type TooltipTriggerProps = Omit<ComponentProps<"button">, "children" | "style" | "ref"> & {
  ref?: Ref<HTMLButtonElement>;
  children?: ReactNode | ((state: { pressed: boolean; hovered: boolean }) => ReactNode);
  asChild?: boolean;
  triggerRefProp?: string;
  onHoverIn?: () => void;
  onHoverOut?: () => void;
  onPress?: () => void;
  style?: CSSProperties | ((state: { pressed: boolean; hovered: boolean }) => unknown);
  testID?: string;
  accessibilityLabel?: string;
  accessibilityRole?: string;
  accessibilityState?: unknown;
  accessibilityHint?: string;
};

export function TooltipTrigger({
  ref,
  children,
  asChild = false,
  triggerRefProp: _triggerRefProp,
  onHoverIn,
  onHoverOut,
  onPress,
  style,
  testID,
  accessibilityLabel,
  accessibilityRole: _accessibilityRole,
  accessibilityState: _accessibilityState,
  accessibilityHint: _accessibilityHint,
  onPointerDown,
  onPointerLeave,
  ...props
}: TooltipTriggerProps): ReactElement {
  const triggerNodeRef = useContext(TooltipTriggerNodeContext);
  const press = useContext(TooltipPressContext);
  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      onPointerDown?.(event);
      press?.press();
    },
    [onPointerDown, press],
  );
  const handlePointerLeave = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      onPointerLeave?.(event);
      if (press) press.pressedRef.current = false;
      onHoverOut?.();
    },
    [onHoverOut, onPointerLeave, press],
  );
  const setNode = useCallback(
    (node: HTMLButtonElement | null) => {
      if (triggerNodeRef) triggerNodeRef.current = node;
      assignRef(ref, node);
    },
    [ref, triggerNodeRef],
  );
  const content =
    typeof children === "function" ? children({ pressed: false, hovered: false }) : children;
  if (asChild) {
    return (
      <ShadTooltipTrigger
        asChild
        ref={setNode}
        {...props}
        onPointerDown={handlePointerDown}
        onPointerLeave={handlePointerLeave}
      >
        {content}
      </ShadTooltipTrigger>
    );
  }
  return (
    <ShadTooltipTrigger asChild>
      <button
        type="button"
        ref={setNode}
        data-testid={testID}
        aria-label={accessibilityLabel}
        style={typeof style === "object" ? style : undefined}
        onClick={onPress}
        onPointerEnter={onHoverIn}
        {...props}
        onPointerDown={handlePointerDown}
        onPointerLeave={handlePointerLeave}
      >
        {content}
      </button>
    </ShadTooltipTrigger>
  );
}

export function TooltipContent({
  children,
  side = "top",
  align = "center",
  offset = 6,
  style,
  testID,
  maxWidth = 280,
  className,
}: PropsWithChildren<{
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  offset?: number;
  style?: CSSProperties;
  testID?: string;
  maxWidth?: number;
  className?: string;
}>): ReactElement | null {
  const enabled = useContext(TooltipEnabledContext);
  const contentStyle = useMemo(() => ({ maxWidth, ...style }), [maxWidth, style]);
  if (!enabled) return null;
  return (
    <ShadTooltipContent
      side={side}
      align={align}
      sideOffset={offset}
      data-testid={testID}
      className={className}
      style={contentStyle}
    >
      <TooltipSurfaceContext value={true}>{children}</TooltipSurfaceContext>
    </ShadTooltipContent>
  );
}
