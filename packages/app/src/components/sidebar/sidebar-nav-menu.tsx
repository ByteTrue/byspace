import { useMemo, type ReactElement } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { ICON_SIZE } from "@/styles/theme";
import { HEADER_CONTROL_HEIGHT } from "@/components/ui/control-geometry";
import { useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";
import { sidebarLabelStyles } from "@/styles/sidebar";
import type { Theme } from "@/styles/theme";

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

const TRIGGER_TEST_ID = "sidebar-nav-menu-trigger";
const LABEL_TEST_ID = "sidebar-nav-menu-label";

/** Hoisted: it closes over nothing, so it must not be recreated per render. */
function triggerButtonStyle({ hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.button, Boolean(hovered) && styles.buttonHovered];
}

interface SidebarNavMenuTriggerProps {
  expanded: boolean;
  onToggle: () => void;
}

/**
 * The BySpace button: the pinned sidebar's app menu, filling the rest of the collapse toggle's
 * row.
 *
 * It is not a nav row, and deliberately does not pretend to be one. Sharing the row with the
 * corner toggle pushes its leading edge past the icon rail the rows below sit on, so a leading
 * chevron could never line up with them. This is a title-bar shape instead: the label centred on
 * the sidebar, the disclosure chevron pinned to the row's right edge.
 *
 * The label is a layer of its own rather than a child of the button: centring it inside the button
 * would centre it on the space the corner control leaves over, which is not the sidebar's centre.
 *
 * Renders nothing when every entry is hidden, matching the rows' "no items, no group".
 */
export function SidebarNavMenuTrigger({
  expanded,
  onToggle,
}: SidebarNavMenuTriggerProps): ReactElement | null {
  const { t } = useTranslation();
  // Only the count matters here, so read the preference rather than resolving every entry —
  // that would subscribe to four shortcuts and look up the active workspace on every render.
  const items = useSidebarNavItems().items;
  const ThemedChevron = useMemo(
    () => withUnistyles(expanded ? ChevronDown : ChevronRight),
    [expanded],
  );
  const label = t("sidebar.appMenu.label");
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);

  // React Native Web does not map `accessibilityState.expanded` to the ARIA attribute, so a
  // disclosure would announce as a plain button. Set it explicitly, as `HeaderToggleButton` does.
  const ariaExpandedProps = isWeb
    ? ({ "aria-expanded": expanded } as Record<string, boolean>)
    : null;

  if (!items.some((item) => item.visible)) return null;

  return (
    <>
      <Pressable
        onPress={onToggle}
        testID={TRIGGER_TEST_ID}
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={accessibilityState}
        {...ariaExpandedProps}
        style={triggerButtonStyle}
      >
        {({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => (
          <View pointerEvents="none" style={styles.chevronSlot}>
            <ThemedChevron
              size={ICON_SIZE.md}
              uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
            />
          </View>
        )}
      </Pressable>
      <View pointerEvents="none" aria-hidden style={styles.labelLayer}>
        <Text
          testID={LABEL_TEST_ID}
          numberOfLines={1}
          style={[sidebarLabelStyles.title, styles.label]}
        >
          {label}
        </Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  button: {
    position: "relative",
    flex: 1,
    minWidth: 0,
    height: HEADER_CONTROL_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    userSelect: "none",
  },
  buttonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  /**
   * Spans the corner row, so the label centres on the sidebar rather than on the button. Absolute,
   * so it takes no room in the row and the button keeps its own box for the hover pill.
   */
  labelLayer: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: "center",
    paddingHorizontal: theme.spacing[6],
  },
  label: {
    textAlign: "center",
  },
  chevronSlot: {
    position: "absolute",
    right: theme.spacing[2],
    top: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
}));
