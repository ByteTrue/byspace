// The button that opens a combobox: shadcn's Button (ghost by default), its content, then a
// chevron unless `chevron` is null.
import {
  forwardRef,
  useCallback,
  type ComponentProps,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "cn";

export interface ComboboxTriggerProps extends Omit<
  ComponentProps<typeof Button>,
  "ref" | "children"
> {
  children?: ReactNode;
  chevron?: ReactNode | null;
  /** A full-width row: the label grows and the chevron pins to the trailing edge. */
  block?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
}

export const ComboboxTrigger = forwardRef<HTMLButtonElement, ComboboxTriggerProps>(
  function ComboboxTrigger(
    {
      children,
      chevron,
      block = false,
      onPress,
      onClick,
      accessibilityLabel,
      testID,
      className,
      variant = "ghost",
      size = "sm",
      ...props
    },
    ref,
  ): ReactElement {
    // A wrapping Slot (a tooltip trigger) passes its own onClick; both run.
    const handleClick = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        onPress?.();
      },
      [onClick, onPress],
    );
    return (
      <Button
        ref={ref}
        type="button"
        variant={variant}
        size={size}
        aria-label={accessibilityLabel}
        data-testid={testID}
        className={cn("min-w-0", block && "w-full justify-between", className)}
        {...props}
        onClick={handleClick}
      >
        {children}
        {chevron !== null && (chevron ?? <ChevronDown data-icon="inline-end" />)}
      </Button>
    );
  },
);
