// Override of packages/app/src/components/ui/switch.tsx on shadcn's switch geometry: the track
// fills with the primary colour when on, the thumb slides across.
import { useCallback, type MouseEvent } from "react";
import { cn } from "cn";

export function Switch({
  value,
  onValueChange,
  disabled = false,
  accessibilityLabel,
  testID,
  className,
}: {
  value: boolean;
  onValueChange?: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  className?: string;
}) {
  const handleClick = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      if (disabled) return;
      onValueChange?.(!value);
    },
    [disabled, onValueChange, value],
  );
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={accessibilityLabel}
      data-testid={testID}
      disabled={disabled}
      onClick={handleClick}
      className={cn(
        "flex min-h-8 shrink-0 items-center justify-center outline-none md:min-h-7 disabled:opacity-50",
        className,
      )}
    >
      {/* packages/app's geometry (control-geometry.ts): a 32x18 track with 1px padding round a
          16px thumb that travels 14px; the thumb is the page colour on light themes, the accent's
          foreground on dark ones, and has no shadow. */}
      <span
        className={cn(
          "flex h-[18px] w-8 items-center rounded-full p-px transition-colors duration-200",
          value ? "bg-primary" : "bg-input dark:bg-input/80",
        )}
      >
        <span
          className={cn(
            "size-4 rounded-full transition-transform duration-200",
            value
              ? "translate-x-3.5 bg-background dark:bg-primary-foreground"
              : "translate-x-0 bg-background dark:bg-foreground",
          )}
        />
      </span>
    </button>
  );
}
