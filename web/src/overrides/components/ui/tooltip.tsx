// Override of packages/app/src/components/ui/tooltip.tsx on shadcn's Tooltip. Same props; a
// tooltip that is off for the current form factor never opens.
import {
  createContext,
  useContext,
  useMemo,
  type ComponentProps,
  type CSSProperties,
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
  return (
    <TooltipEnabledContext value={enabled}>
      <ShadTooltip
        open={enabled ? open : false}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
        delayDuration={delayDuration}
      >
        {children}
      </ShadTooltip>
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
  ...props
}: TooltipTriggerProps): ReactElement {
  const content =
    typeof children === "function" ? children({ pressed: false, hovered: false }) : children;
  if (asChild) {
    return (
      <ShadTooltipTrigger asChild ref={ref} {...props}>
        {content}
      </ShadTooltipTrigger>
    );
  }
  return (
    <ShadTooltipTrigger asChild>
      <button
        type="button"
        ref={ref}
        data-testid={testID}
        aria-label={accessibilityLabel}
        style={typeof style === "object" ? style : undefined}
        onClick={onPress}
        onPointerEnter={onHoverIn}
        onPointerLeave={onHoverOut}
        {...props}
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
