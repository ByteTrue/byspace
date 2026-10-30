import { useMemo } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { LucideIcon } from "lucide-react-native";
import {
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  useMacTrafficLightInset,
  WAILS_DRAG_DATA_SET,
} from "@/constants/layout";
import { ICON_SIZE } from "@/styles/theme";
import type { Theme } from "@/styles/theme";
import { sidebarLabelStyles } from "@/styles/sidebar";

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

function buttonStyle({ hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.button, Boolean(hovered) && styles.buttonHovered];
}

interface SidebarHeaderRowProps {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  testID?: string;
}

/**
 * A sidebar-height row with its own bottom separator, for the lone entry that sits at the top of a
 * sidebar rather than in a list — the settings sidebar's "Back to workspace".
 *
 * It is not the app menu any more: that is a floating menu on the menu engine, so the compact
 * variant, the selected indicator and the trailing shortcut this row used to carry for it are gone
 * with it. A row that has to hold a disclosure belongs to `sidebar-nav-menu.tsx`.
 */
export function SidebarHeaderRow({ icon: Icon, label, onPress, testID }: SidebarHeaderRowProps) {
  const ThemedIcon = useMemo(() => withUnistyles(Icon), [Icon]);
  const trafficLightInset = useMacTrafficLightInset();
  const containerStyle = useMemo(
    () =>
      trafficLightInset > 0
        ? [styles.container, { paddingLeft: 8 + trafficLightInset }]
        : styles.container,
    [trafficLightInset],
  );

  return (
    <View style={containerStyle} dataSet={WAILS_DRAG_DATA_SET}>
      <Pressable
        onPress={onPress}
        testID={testID}
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        style={buttonStyle}
      >
        {({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => (
          <>
            <ThemedIcon
              size={ICON_SIZE.sm}
              uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
            />
            <Text
              style={[
                sidebarLabelStyles.row,
                Boolean(hovered) && sidebarLabelStyles.rowHighlighted,
              ]}
            >
              {label}
            </Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    height: {
      xs: HEADER_INNER_HEIGHT_MOBILE,
      md: HEADER_INNER_HEIGHT,
    },
    paddingHorizontal: theme.spacing[2],
    justifyContent: "center",
    userSelect: "none",
  },
  button: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 34,
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.base,
    overflow: "hidden",
  },
  buttonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
}));
