import { PanelRight } from "lucide-react-native";
import { type StyleProp, type ViewStyle } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import {
  extraMutedIconColorMapping,
  iconButtonChromeGlyphSize,
  mutedIconColorMapping,
} from "@/components/ui/icon-button-chrome";
import type { ShortcutKey } from "@/utils/format-shortcut";

const ThemedPanelRight = withUnistyles(PanelRight);

interface WorkspaceExplorerToggleProps {
  onPress: () => void;
  label: string;
  tooltipLabel: string;
  tooltipKeys: ShortcutKey[];
  accessibilityState: { expanded: boolean };
  mobile: boolean;
  style?: StyleProp<ViewStyle>;
}

export type WorkspaceExplorerToggleOwner = "mobile" | "content" | "dock";

/**
 * The Explorer toggle holds one position at the window's top-right corner, so whichever
 * surface reaches that corner hosts it: the content header while the dock is closed, the
 * dock's own tab rail while it is open.
 *
 * Pure, because "exactly one host" is the whole invariant: the inputs are read once here so
 * neither host has to know about the other, and a resolver test can assert the full table.
 */
export function resolveWorkspaceExplorerToggleOwner({
  isMobile,
  isDockRendered,
}: {
  isMobile: boolean;
  isDockRendered: boolean;
}): WorkspaceExplorerToggleOwner {
  if (isMobile) return "mobile";
  return isDockRendered ? "dock" : "content";
}

/** Whether the Explorer dock — the surface that reaches the window's top-right corner. */
export function resolveIsExplorerDockRendered({
  canRenderDesktopPaneSplits,
  isFocusModeEnabled,
  isExplorerSidebarShowing,
}: {
  canRenderDesktopPaneSplits: boolean;
  isFocusModeEnabled: boolean;
  isExplorerSidebarShowing: boolean;
}): boolean {
  return !isFocusModeEnabled && canRenderDesktopPaneSplits && isExplorerSidebarShowing;
}

export function WorkspaceExplorerToggle({
  onPress,
  label,
  tooltipLabel,
  tooltipKeys,
  accessibilityState,
  mobile,
  style,
}: WorkspaceExplorerToggleProps) {
  return (
    <HeaderToggleButton
      testID="workspace-explorer-toggle"
      onPress={onPress}
      tooltipLabel={tooltipLabel}
      tooltipKeys={tooltipKeys}
      tooltipSide="left"
      style={style}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={accessibilityState}
    >
      <ThemedPanelRight
        size={iconButtonChromeGlyphSize("large")}
        strokeWidth={1.5}
        uniProps={mobile ? mutedIconColorMapping : extraMutedIconColorMapping}
      />
    </HeaderToggleButton>
  );
}

interface DesktopWorkspaceExplorerToggleProps extends Omit<WorkspaceExplorerToggleProps, "mobile"> {
  owner: WorkspaceExplorerToggleOwner;
}

/** Host: the workspace's content header. */
export function WorkspaceHeaderExplorerToggle({
  owner,
  accessibilityState,
  style,
  ...toggleProps
}: DesktopWorkspaceExplorerToggleProps) {
  if (owner !== "content") return null;
  return (
    <WorkspaceExplorerToggle
      {...toggleProps}
      accessibilityState={accessibilityState}
      mobile={false}
      style={style}
    />
  );
}

/** Host: the Explorer dock's tab rail. */
export function WorkspaceExplorerSidebarToggle({
  owner,
  accessibilityState,
  style,
  ...toggleProps
}: DesktopWorkspaceExplorerToggleProps) {
  if (owner !== "dock") return null;
  return (
    <WorkspaceExplorerToggle
      {...toggleProps}
      accessibilityState={accessibilityState}
      mobile={false}
      style={style}
    />
  );
}
