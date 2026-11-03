// Port of archive/expo-app:packages/app/src/components/ui/segmented-control.tsx: shadcn's default tabs look (a
// muted track holding a raised selected segment) as a row of buttons, same props.
import { useCallback, type CSSProperties, type ReactNode } from "react";
import { segmentedIconSize, type SegmentedControlSize } from "@/components/ui/control-geometry";
import { cn } from "cn";
import { useThemeObject } from "~/app/theme-object";

type SegmentedControlIconRenderer = (props: { color: string; size: number }) => ReactNode;

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
  icon?: SegmentedControlIconRenderer;
  disabled?: boolean;
  testID?: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedControlOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  size?: SegmentedControlSize;
  hideLabels?: boolean;
  style?: CSSProperties;
  className?: string;
  testID?: string;
}

// Touch-sized below md, shadcn nova heights from md up (control-geometry.ts).
const CONTAINER: Record<SegmentedControlSize, string> = {
  xs: "h-7 rounded-md p-0.5 md:h-6",
  sm: "h-8 rounded-lg p-[3px] md:h-7",
  md: "h-11 rounded-lg p-[3px] md:h-8",
};
const SEGMENT: Record<SegmentedControlSize, string> = {
  xs: "rounded-sm px-1.5 text-xs",
  sm: "rounded-md px-2 text-sm",
  md: "rounded-md px-2 text-sm",
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  size = "md",
  hideLabels = false,
  style,
  className,
  testID,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      data-testid={testID}
      style={style}
      className={cn("inline-flex shrink-0 items-stretch bg-muted", CONTAINER[size], className)}
    >
      {options.map((option) => (
        <SegmentItem
          key={option.value}
          option={option}
          isSelected={option.value === value}
          size={size}
          hideLabels={hideLabels}
          currentValue={value}
          onValueChange={onValueChange}
        />
      ))}
    </div>
  );
}

function SegmentItem<T extends string>({
  option,
  isSelected,
  size,
  hideLabels,
  currentValue,
  onValueChange,
}: {
  option: SegmentedControlOption<T>;
  isSelected: boolean;
  size: SegmentedControlSize;
  hideLabels: boolean;
  currentValue: T;
  onValueChange: (value: T) => void;
}) {
  const theme = useThemeObject();
  const handlePress = useCallback(() => {
    if (!option.disabled && option.value !== currentValue) onValueChange(option.value);
  }, [option.disabled, option.value, currentValue, onValueChange]);
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      aria-selected={isSelected}
      aria-label={hideLabels ? option.label : undefined}
      disabled={option.disabled}
      data-testid={option.testID}
      data-active={isSelected ? "" : undefined}
      onClick={handlePress}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 border border-transparent font-medium whitespace-nowrap text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
        "data-active:bg-background data-active:text-foreground data-active:shadow-sm dark:data-active:border-input dark:data-active:bg-input/30",
        SEGMENT[size],
      )}
    >
      {option.icon ? (
        <span className="flex items-center justify-center">
          {option.icon({
            color: isSelected ? theme.colors.foreground : theme.colors.foregroundMuted,
            size: segmentedIconSize[size],
          })}
        </span>
      ) : null}
      {hideLabels ? null : <span className="truncate">{option.label}</span>}
    </button>
  );
}
