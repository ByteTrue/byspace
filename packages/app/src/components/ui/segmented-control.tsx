import {
  useCallback,
  useMemo,
  type ComponentProps,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  createControlGeometry,
  segmentedIconSize,
  type SegmentedControlSize,
} from "@/components/ui/control-geometry";
import type { Theme } from "@/styles/theme";

const WebPressable = Pressable as ComponentType<
  ComponentProps<typeof Pressable> & { onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void }
>;

type SegmentedControlIconRenderer = (props: { color: string; size: number }) => ReactNode;

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
  icon?: SegmentedControlIconRenderer;
  disabled?: boolean;
  testID?: string;
  controls?: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedControlOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  size?: SegmentedControlSize;
  hideLabels?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  role?: "tablist";
}

function getTabTargetIndex<T extends string>(
  options: SegmentedControlOption<T>[],
  currentIndex: number,
  key: string,
): number | null {
  let targetIndex: number;
  let step: number;
  switch (key) {
    case "Home":
      targetIndex = 0;
      step = 1;
      break;
    case "End":
      targetIndex = options.length - 1;
      step = -1;
      break;
    case "ArrowRight":
      targetIndex = (currentIndex + 1) % options.length;
      step = 1;
      break;
    case "ArrowLeft":
      targetIndex = (currentIndex - 1 + options.length) % options.length;
      step = -1;
      break;
    default:
      return null;
  }

  for (let count = 0; count < options.length; count++) {
    if (!options[targetIndex]?.disabled) return targetIndex;
    targetIndex = (targetIndex + step + options.length) % options.length;
  }
  return null;
}

interface SegmentIconProps {
  icon: SegmentedControlIconRenderer;
  iconSize: number;
  iconColor: string;
}

function SegmentIcon({ icon, iconSize, iconColor }: SegmentIconProps) {
  return <View style={styles.iconContainer}>{icon({ color: iconColor, size: iconSize })}</View>;
}

const ThemedSegmentIcon = withUnistyles(SegmentIcon);

const selectedIconMapping = (theme: Theme) => ({ iconColor: theme.colors.foreground });
const mutedIconMapping = (theme: Theme) => ({ iconColor: theme.colors.foregroundMuted });

export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  size = "md",
  hideLabels = false,
  style,
  testID,
  role,
}: SegmentedControlProps<T>) {
  const containerSizeStyle = size === "sm" ? styles.containerSm : styles.containerMd;
  const segmentSizeStyle = size === "sm" ? styles.segmentSm : styles.segmentMd;
  const labelSizeStyle = size === "sm" ? styles.labelSm : styles.labelMd;
  const iconSize = segmentedIconSize[size];

  const containerStyle = useMemo(
    () => [styles.container, containerSizeStyle, style],
    [containerSizeStyle, style],
  );

  const handleTabKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>, currentIndex: number) => {
      if (role !== "tablist") return;

      const targetIndex = getTabTargetIndex(options, currentIndex, event.key);
      if (targetIndex == null) return;
      const target = options[targetIndex];
      if (!target) return;
      event.preventDefault();
      onValueChange(target.value);
      const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[role=tab]");
      tabs?.[targetIndex]?.focus();
    },
    [onValueChange, options, role],
  );

  return (
    <View style={containerStyle} role={role} testID={testID}>
      {options.map((option, index) => {
        const isSelected = option.value === value;

        return (
          <SegmentItem
            key={option.value}
            option={option}
            isSelected={isSelected}
            iconSize={iconSize}
            hideLabels={hideLabels}
            segmentSizeStyle={segmentSizeStyle}
            labelSizeStyle={labelSizeStyle}
            currentValue={value}
            onValueChange={onValueChange}
            isTab={role === "tablist"}
            optionIndex={index}
            onTabKeyDown={handleTabKeyDown}
          />
        );
      })}
    </View>
  );
}

function SegmentItem<T extends string>({
  option,
  isSelected,
  iconSize,
  hideLabels,
  segmentSizeStyle,
  labelSizeStyle,
  currentValue,
  onValueChange,
  isTab,
  optionIndex,
  onTabKeyDown,
}: {
  option: SegmentedControlOption<T>;
  isSelected: boolean;
  iconSize: number;
  hideLabels: boolean;
  segmentSizeStyle: StyleProp<ViewStyle>;
  labelSizeStyle: StyleProp<TextStyle>;
  currentValue: T;
  onValueChange: (value: T) => void;
  isTab: boolean;
  optionIndex: number;
  onTabKeyDown: (event: KeyboardEvent<HTMLElement>, index: number) => void;
}) {
  const labelStyle = useMemo(
    () => [styles.label, labelSizeStyle, isSelected && styles.labelSelected],
    [labelSizeStyle, isSelected],
  );
  const handlePress = useCallback(() => {
    if (!option.disabled && option.value !== currentValue) {
      onValueChange(option.value);
    }
  }, [option.disabled, option.value, currentValue, onValueChange]);
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => onTabKeyDown(event, optionIndex),
    [onTabKeyDown, optionIndex],
  );
  let tabIndex: -1 | 0 | undefined;
  if (isTab) tabIndex = isSelected ? 0 : -1;
  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.segment,
      segmentSizeStyle,
      isSelected && styles.segmentSelected,
      Boolean(hovered) && !isSelected && styles.segmentHover,
      pressed && !isSelected && styles.segmentPressed,
      option.disabled && styles.segmentDisabled,
    ],
    [isSelected, option.disabled, segmentSizeStyle],
  );
  const accessibilityState = useMemo(
    () => ({ selected: isSelected, disabled: option.disabled }),
    [isSelected, option.disabled],
  );
  return (
    <WebPressable
      accessibilityRole={isTab ? "tab" : "button"}
      accessibilityState={accessibilityState}
      aria-controls={isTab ? option.controls : undefined}
      aria-selected={isSelected}
      tabIndex={tabIndex}
      onKeyDown={isTab ? handleKeyDown : undefined}
      disabled={option.disabled}
      testID={option.testID}
      onPress={handlePress}
      style={pressableStyle}
    >
      {option.icon ? (
        <ThemedSegmentIcon
          icon={option.icon}
          iconSize={iconSize}
          uniProps={isSelected ? selectedIconMapping : mutedIconMapping}
        />
      ) : null}
      {hideLabels ? null : (
        <Text style={labelStyle} numberOfLines={1}>
          {option.label}
        </Text>
      )}
    </WebPressable>
  );
}

const styles = StyleSheet.create((theme) => {
  const geometry = createControlGeometry(theme);

  return {
    container: {
      flexDirection: "row",
      alignItems: "stretch",
      backgroundColor: theme.colors.surface2,
      gap: 2,
    },
    containerSm: {
      ...geometry.segmentedContainerSm,
    },
    containerMd: {
      ...geometry.segmentedContainerMd,
    },
    segment: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      gap: theme.spacing[1],
    },
    segmentSm: {
      ...geometry.segmentedSegmentSm,
    },
    segmentMd: {
      ...geometry.segmentedSegmentMd,
    },
    segmentSelected: {
      backgroundColor: theme.colors.surface0,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 2,
      elevation: 1,
    },
    segmentHover: {
      backgroundColor: theme.colors.surface1,
    },
    segmentPressed: {
      backgroundColor: theme.colors.surface1,
    },
    segmentDisabled: {
      opacity: theme.opacity[50],
    },
    iconContainer: {
      alignItems: "center",
      justifyContent: "center",
    },
    label: {
      color: theme.colors.foregroundMuted,
      fontWeight: theme.fontWeight.normal,
    },
    labelSm: {
      ...geometry.segmentedLabelSm,
    },
    labelMd: {
      ...geometry.segmentedLabelMd,
    },
    labelSelected: {
      color: theme.colors.foreground,
    },
  };
});
