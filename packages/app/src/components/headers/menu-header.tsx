import { useCallback, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { PanelLeft } from "lucide-react-native";
import { ScreenHeader } from "./screen-header";
import { ScreenTitle } from "./screen-title";
import { HeaderToggleButton } from "./header-toggle-button";
import { selectIsAgentListOpen, usePanelStore } from "@/stores/panel-store";
import { useDesktopSidebarVisible } from "@/contexts/desktop-sidebar-visibility-context";
import { resolveSidebarToggleHost } from "@/components/sidebar/sidebar-toggle-host";
import { useIsCompactFormFactor } from "@/constants/layout";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { iconButtonChromeGlyphSize } from "@/components/ui/icon-button-chrome";
import { HEADER_CONTROL_HEIGHT } from "@/components/ui/control-geometry";
import { ICON_SIZE, SPACING } from "@/styles/theme";

/**
 * What lines up with the sidebar's row icons is the toggle's *glyph*, not its frame.
 *
 * A row's icon sits `spacing[2]` inside its own inset, putting every row icon on the rail at
 * `spacing[4]`. The toggle centers a 16px glyph in a 26px frame, so its glyph sits
 * `TOGGLE_GLYPH_INSET` in from the frame. Pulling the frame back by the gap between those two
 * puts the visible icon on the rail — matching frames instead would leave the glyph 3px left of
 * every row below it. Both hosts apply this same value, which is what keeps the toggle on one
 * pixel as the sidebar opens and closes.
 */
const TOGGLE_GLYPH_INSET = (HEADER_CONTROL_HEIGHT - ICON_SIZE.md) / 2;
const SIDEBAR_ROW_ICON_RAIL = SPACING[4];

interface MenuHeaderProps {
  title?: string;
  rightContent?: ReactNode;
  borderless?: boolean;
}

interface SidebarMenuToggleProps {
  style?: StyleProp<ViewStyle>;
  tooltipSide?: "left" | "right" | "top" | "bottom";
  testID?: string;
  nativeID?: string;
  /**
   * Which host renders this instance. The sidebar's own top row and a content header both
   * put the toggle at the window's top-left corner; exactly one of them owns it at a time.
   */
  host?: "content" | "sidebar";
}

const MOBILE_MENU_LINE_WIDTH = 16;
const MOBILE_MENU_LINE_SHORT_WIDTH = 8;
const MOBILE_MENU_LINE_HEIGHT = 1.5;

function MobileMenuIcon({ color }: { color: string }) {
  const lineStyle = useMemo(() => [styles.mobileMenuLine, { backgroundColor: color }], [color]);
  const shortLineStyle = useMemo(
    () => [styles.mobileMenuLine, styles.mobileMenuLineShort, { backgroundColor: color }],
    [color],
  );
  return (
    <View style={styles.mobileMenuIcon} pointerEvents="none">
      <View style={lineStyle} />
      <View style={lineStyle} />
      <View style={shortLineStyle} />
    </View>
  );
}

function SidebarMenuToggleButton({
  isMobile,
  extraMutedIdleIcon = false,
  resolvedStyle,
  tooltipSide = "right",
  testID = "menu-button",
  nativeID = "menu-button",
}: Omit<SidebarMenuToggleProps, "style"> & {
  isMobile: boolean;
  extraMutedIdleIcon?: boolean;
  resolvedStyle: StyleProp<ViewStyle>;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const isOpen = usePanelStore((state) => selectIsAgentListOpen(state, { isCompact: isMobile }));
  const toggleAgentListForLayout = usePanelStore((state) => state.toggleAgentListForLayout);
  const toggleShortcutKeys = useMemo(
    () => (getShortcutOs() === "mac" ? ["mod", "B"] : ["mod", "."]),
    [],
  );

  const handlePress = useCallback(() => {
    toggleAgentListForLayout({ isCompact: isMobile });
  }, [toggleAgentListForLayout, isMobile]);

  const accessibilityState = useMemo(() => ({ expanded: isOpen }), [isOpen]);

  return (
    <HeaderToggleButton
      onPress={handlePress}
      tooltipLabel={t("shell.menu.toggleSidebar")}
      tooltipKeys={toggleShortcutKeys}
      tooltipSide={tooltipSide}
      testID={testID}
      nativeID={nativeID}
      style={resolvedStyle}
      accessible
      accessibilityRole="button"
      accessibilityLabel={isOpen ? t("shell.menu.close") : t("shell.menu.open")}
      accessibilityState={accessibilityState}
    >
      {isMobile ? (
        <MobileMenuIcon
          color={
            extraMutedIdleIcon ? theme.colors.foregroundExtraMuted : theme.colors.foregroundMuted
          }
        />
      ) : (
        <PanelLeft
          size={iconButtonChromeGlyphSize("large")}
          strokeWidth={1.5}
          color={
            extraMutedIdleIcon ? theme.colors.foregroundExtraMuted : theme.colors.foregroundMuted
          }
        />
      )}
    </HeaderToggleButton>
  );
}

export function SidebarMenuToggle({
  style,
  host = "content",
  ...props
}: SidebarMenuToggleProps = {}) {
  const isMobile = useIsCompactFormFactor();
  const desktopSidebarVisible = useDesktopSidebarVisible();
  const resolvedStyle = useMemo(() => [styles.leadingToggle, style], [style]);
  // One source for both hosts: the pinned sidebar shows it while it is visible, a content
  // header only while it is not, so `menu-button` exists exactly once in every state.
  const owner = resolveSidebarToggleHost({ isCompact: isMobile, desktopSidebarVisible });

  if (owner !== host) return null;

  return <SidebarMenuToggleButton {...props} isMobile={isMobile} resolvedStyle={resolvedStyle} />;
}

export function MenuHeader({ title, rightContent, borderless }: MenuHeaderProps) {
  return (
    <ScreenHeader
      left={
        <>
          <SidebarMenuToggle />
          {title && <ScreenTitle>{title}</ScreenTitle>}
        </>
      }
      right={rightContent}
      leftStyle={styles.left}
      borderless={borderless}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  leadingToggle: {
    marginLeft: {
      xs: 0,
      md: SIDEBAR_ROW_ICON_RAIL - TOGGLE_GLYPH_INSET - theme.spacing[3],
    },
  },
  left: {
    gap: theme.spacing[2],
  },
  mobileMenuIcon: {
    width: MOBILE_MENU_LINE_WIDTH,
    height: 12,
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  mobileMenuLine: {
    width: MOBILE_MENU_LINE_WIDTH,
    height: MOBILE_MENU_LINE_HEIGHT,
    borderRadius: theme.borderRadius.full,
  },
  mobileMenuLineShort: {
    width: MOBILE_MENU_LINE_SHORT_WIDTH,
  },
}));
