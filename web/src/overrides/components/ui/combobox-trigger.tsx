// Override of packages/app/src/components/ui/combobox-trigger.tsx: the button that opens a
// combobox — content, then a chevron unless `chevron` is null.
import {
  forwardRef,
  useCallback,
  type ComponentProps,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";
import { ICON_SIZE } from "@/styles/theme";
import { cn } from "cn";

export interface ComboboxTriggerProps extends Omit<ComponentProps<"button">, "ref"> {
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
      <button
        ref={ref}
        type="button"
        aria-label={accessibilityLabel}
        data-testid={testID}
        className={className}
        {...props}
        onClick={handleClick}
      >
        <span
          className={cn("flex max-w-full min-w-0 shrink items-center gap-1", block && "grow gap-2")}
        >
          {children}
          {chevron !== null &&
            (chevron ?? (
              <span className="flex shrink-0 translate-y-px text-muted-foreground">
                <ChevronDown size={ICON_SIZE.sm} />
              </span>
            ))}
        </span>
      </button>
    );
  },
);
