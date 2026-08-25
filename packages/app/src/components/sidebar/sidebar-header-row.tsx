import { useCallback, useMemo } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { LucideIcon } from "lucide-react-native";
import { HEADER_INNER_HEIGHT, HEADER_INNER_HEIGHT_MOBILE } from "@/constants/layout";
import { ICON_SIZE } from "@/styles/theme";
import type { Theme } from "@/styles/theme";
import { Shortcut } from "@/components/ui/shortcut";
import type { ShortcutKey } from "@/utils/format-shortcut";

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface SidebarHeaderRowProps {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  isActive?: boolean;
  testID?: string;
  nativeID?: string;
  accessibilityLabel?: string;
  shortcutKeys?: ShortcutKey[][] | null;
}

export function SidebarHeaderRow({
  icon: Icon,
  label,
  onPress,
  isActive = false,
  testID,
  nativeID,
  accessibilityLabel,
  shortcutKeys = null,
}: SidebarHeaderRowProps) {
  const ThemedIcon = useMemo(() => withUnistyles(Icon), [Icon]);

  const buttonStyle = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.button,
      (Boolean(hovered) || isActive) && styles.buttonHovered,
    ],
    [isActive],
  );

  const renderChildren = useCallback(
    (state: PressableStateCallbackType & { hovered?: boolean }) => {
      const isHighlighted = Boolean(state.hovered) || isActive;
      return (
        <>
          <ThemedIcon
            size={ICON_SIZE.sm}
            uniProps={isHighlighted ? foregroundColorMapping : foregroundMutedColorMapping}
          />
          <SidebarHeaderRowLabel label={label} isHighlighted={isHighlighted} />
          {shortcutKeys && Boolean(state.hovered) ? (
            <Shortcut chord={shortcutKeys} style={styles.shortcut} />
          ) : null}
        </>
      );
    },
    [ThemedIcon, isActive, label, shortcutKeys],
  );

  return (
    <View style={styles.container}>
      <Pressable
        onPress={onPress}
        testID={testID}
        nativeID={nativeID}
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        style={buttonStyle}
      >
        {renderChildren}
      </Pressable>
    </View>
  );
}

function SidebarHeaderRowLabel({
  label,
  isHighlighted,
}: {
  label: string;
  isHighlighted: boolean;
}) {
  const labelStyle = useMemo(
    () => [styles.label, isHighlighted && styles.labelHighlighted],
    [isHighlighted],
  );
  return <Text style={labelStyle}>{label}</Text>;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    height: {
      xs: HEADER_INNER_HEIGHT_MOBILE,
      md: HEADER_INNER_HEIGHT,
    },
    paddingHorizontal: theme.spacing[2],
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    userSelect: "none",
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    // Match the sidebar workspace-row shape (height, padding, radius) so the row
    // sits tight against the list below it.
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
  },
  buttonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  label: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  labelHighlighted: {
    color: theme.colors.foreground,
  },
  shortcut: {
    marginLeft: "auto",
  },
}));
