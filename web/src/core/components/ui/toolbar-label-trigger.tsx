// The small label buttons in a pane toolbar (branch, diff mode, pull request): shadcn's ghost xs
// Button with the label and a chevron.
import {
  forwardRef,
  useCallback,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "cn";

interface ToolbarLabelSelectTriggerProps extends Omit<ComponentProps<"button">, "children"> {
  label: string;
  open?: boolean;
  leadingIcon?: ReactNode;
  testID?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityRole?: string;
}

/** The shared current/base branch trigger. */
export const ToolbarLabelSelectTrigger = forwardRef<
  HTMLButtonElement,
  ToolbarLabelSelectTriggerProps
>(function ToolbarLabelSelectTrigger(
  {
    label,
    open = false,
    leadingIcon,
    testID,
    onPress,
    onClick,
    accessibilityLabel,
    accessibilityRole: _accessibilityRole,
    className,
    ...props
  },
  ref,
) {
  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (!event.defaultPrevented) onPress?.();
    },
    [onClick, onPress],
  );
  return (
    <Button
      variant="ghost"
      size="xs"
      type="button"
      {...props}
      ref={ref}
      data-testid={testID}
      aria-label={accessibilityLabel}
      aria-expanded={open}
      onClick={handleClick}
      className={cn("min-w-0 shrink", className)}
    >
      {leadingIcon}
      <span className="truncate">{label}</span>
      <ChevronDown data-icon="inline-end" />
    </Button>
  );
});
