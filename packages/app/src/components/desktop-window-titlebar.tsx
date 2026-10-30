import { useCallback, useState } from "react";
import { Pressable, View, type PressableStateCallbackType } from "react-native";
import { Copy, Minus, Square, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";

const ThemedMinusIcon = withUnistyles(Minus, (theme) => ({
  color: theme.colors.foreground,
}));
const ThemedSquareIcon = withUnistyles(Square, (theme) => ({
  color: theme.colors.foreground,
}));
const ThemedCopyIcon = withUnistyles(Copy, (theme) => ({
  color: theme.colors.foreground,
}));
const ThemedCloseIcon = withUnistyles(X, (theme) => ({
  color: theme.colors.foreground,
}));
import { SidebarMenuToggle } from "@/components/headers/menu-header";
import { SidebarNavMenu } from "@/components/sidebar/sidebar-nav-menu";
import { HEADER_INNER_HEIGHT, WAILS_DRAG_DATA_SET } from "@/constants/layout";
import { isWeb } from "@/constants/platform";

/**
 * Reports whether the app is running inside the Windows Wails desktop container,
 * which uses the AGCopilot / Feishu-style "半包" (L-shaped) frameless window shell
 * with a top titlebar strip above the rounded content card.
 */
export function isWindowsWailsDesktop(): boolean {
  if (!isWeb || typeof window === "undefined") {
    return false;
  }
  const isWailsOrigin =
    window.location?.protocol === "wails:" ||
    window.location?.hostname === "wails.localhost" ||
    "wails" in window;
  if (!isWailsOrigin) {
    return false;
  }
  const ua = window.navigator?.userAgent ?? "";
  return /windows/i.test(ua);
}

function sendWindowAction(action: "minimize" | "maximize" | "close") {
  void fetch("/_byspace/desktop/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ windowAction: action }),
  }).catch(() => undefined);
}

const controlButtonStyle = ({
  hovered = false,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) => [
  styles.controlButton,
  hovered && styles.controlButtonHovered,
  pressed && styles.controlButtonPressed,
];

const closeButtonStyle = ({
  hovered = false,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) => [
  styles.controlButton,
  hovered && styles.closeButtonHovered,
  pressed && styles.closeButtonPressed,
];

export function DesktopWindowTitleBar({ sidebarCollapsed }: { sidebarCollapsed: boolean }) {
  const [isMaximized, setIsMaximized] = useState(false);

  const handleMinimize = useCallback(() => {
    sendWindowAction("minimize");
  }, []);

  const handleMaximize = useCallback(() => {
    setIsMaximized((prev) => !prev);
    sendWindowAction("maximize");
  }, []);

  const handleClose = useCallback(() => {
    sendWindowAction("close");
  }, []);

  return (
    <View style={styles.titleBar} dataSet={WAILS_DRAG_DATA_SET} testID="desktop-window-titlebar">
      <View style={styles.leadingArea} dataSet={WAILS_DRAG_DATA_SET}>
        {sidebarCollapsed ? (
          <View style={styles.collapsedNavCluster}>
            <SidebarMenuToggle host="titlebar" tooltipSide="bottom" />
            <SidebarNavMenu panelActive={false} />
          </View>
        ) : null}
      </View>
      <View style={styles.controlsArea}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Minimize"
          onPress={handleMinimize}
          style={controlButtonStyle}
          testID="window-control-minimize"
        >
          <ThemedMinusIcon size={14} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isMaximized ? "Restore" : "Maximize"}
          onPress={handleMaximize}
          style={controlButtonStyle}
          testID="window-control-maximize"
        >
          {isMaximized ? <ThemedCopyIcon size={12} /> : <ThemedSquareIcon size={12} />}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={handleClose}
          style={closeButtonStyle}
          testID="window-control-close"
        >
          {({ hovered, pressed }) =>
            hovered || pressed ? <X size={15} color="#ffffff" /> : <ThemedCloseIcon size={15} />
          }
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  titleBar: {
    height: HEADER_INNER_HEIGHT,
    minHeight: HEADER_INNER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: theme.spacing[3],
    backgroundColor: "transparent",
    userSelect: "none",
  },
  leadingArea: {
    flex: 1,
    minWidth: 0,
    height: "100%",
    flexDirection: "row",
    alignItems: "center",
  },
  collapsedNavCluster: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  controlsArea: {
    flexDirection: "row",
    alignItems: "stretch",
    height: "100%",
  },
  controlButton: {
    width: 46,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  controlButtonHovered: {
    backgroundColor: "rgba(128, 128, 128, 0.22)",
  },
  controlButtonPressed: {
    backgroundColor: "rgba(128, 128, 128, 0.34)",
  },
  closeButtonHovered: {
    backgroundColor: "#e81123",
  },
  closeButtonPressed: {
    backgroundColor: "#c50e1f",
  },
}));
