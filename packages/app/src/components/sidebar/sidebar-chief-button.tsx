import { useCallback, useMemo, type ReactElement } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { Bot } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useChiefWorkspaceStatusBucket } from "@/chief/home-workspace";
import { StatusRing } from "@/components/status-ring";
import { HEADER_CONTROL_HEIGHT } from "@/components/ui/control-geometry";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  SIDEBAR_NAV_TEST_IDS,
  useSidebarChiefNavEntry,
} from "@/sidebar-nav/use-sidebar-nav-entries";
import { sidebarLabelStyles } from "@/styles/sidebar";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { getStatusDotColor } from "@/utils/status-dot-color";
import { STATUS_INDICATOR_FILLED_DOT_SIZE } from "@/utils/status-indicator-geometry";

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

const ThemedBot = withUnistyles(Bot);

interface SidebarChiefButtonProps {
  /** Runs before Chief navigation, for shells whose panel has to get out of the way. */
  onBeforeNavigate?: () => void;
}

/**
 * Permanent Chief quick-jump button on the right side of the sidebar's top row.
 *
 * Sits on the same row as the BySpace menu trigger in both the pinned desktop sidebar and the
 * compact sidebar drawer, so Chief is always reachable without opening the dropdown menu and takes
 * zero extra vertical height from the Workspaces list. Also surfaces the Home workspace's live
 * agent status indicator so running / attention states remain visible from any screen.
 */
export function SidebarChiefButton({
  onBeforeNavigate,
}: SidebarChiefButtonProps): ReactElement | null {
  const entry = useSidebarChiefNavEntry();
  const statusBucket = useChiefWorkspaceStatusBucket();

  const handlePress = useCallback(() => {
    if (!entry) return;
    onBeforeNavigate?.();
    entry.onSelect();
  }, [entry, onBeforeNavigate]);

  const accessibilityState = useMemo(
    () => (entry ? { selected: entry.isActive } : undefined),
    [entry],
  );

  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.button,
      entry?.isActive || pressed ? styles.buttonActive : hovered && styles.buttonHovered,
    ],
    [entry?.isActive],
  );

  if (!entry) return null;

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          onPress={handlePress}
          testID={SIDEBAR_NAV_TEST_IDS.chief}
          accessible
          accessibilityRole="button"
          accessibilityLabel={entry.label}
          accessibilityState={accessibilityState}
          style={buttonStyle}
        >
          {({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => {
            const isHighlighted = Boolean(hovered || pressed || entry.isActive);
            return (
              <>
                <ThemedBot
                  size={ICON_SIZE.sm}
                  uniProps={isHighlighted ? foregroundColorMapping : foregroundMutedColorMapping}
                />
                <Text
                  numberOfLines={1}
                  style={[
                    sidebarLabelStyles.row,
                    isHighlighted && sidebarLabelStyles.rowHighlighted,
                  ]}
                >
                  {entry.label}
                </Text>
                <ChiefStatusIndicator bucket={statusBucket} />
              </>
            );
          }}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <View style={styles.tooltipRow}>
          <Text style={styles.tooltipText}>{entry.label}</Text>
          {entry.shortcutKeys ? <Shortcut chord={entry.shortcutKeys} /> : null}
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

function ChiefStatusIndicator({ bucket }: { bucket: SidebarStateBucket }): ReactElement | null {
  if (bucket === "done") return null;
  if (bucket === "running") {
    return (
      <View style={styles.statusSlot} testID="sidebar-chief-status-running">
        <StatusRing />
      </View>
    );
  }
  return (
    <View
      style={[
        styles.statusDot,
        bucket === "needs_input" && styles.statusDotNeedsInput,
        bucket === "failed" && styles.statusDotFailed,
        bucket === "attention" && styles.statusDotAttention,
      ]}
      testID={`sidebar-chief-status-${bucket}`}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  button: {
    height: HEADER_CONTROL_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    userSelect: "none",
    flexShrink: 0,
  },
  buttonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  buttonActive: {
    backgroundColor: theme.colors.surfaceSidebarSelected,
  },
  statusSlot: {
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  statusDot: {
    width: STATUS_INDICATOR_FILLED_DOT_SIZE,
    height: STATUS_INDICATOR_FILLED_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
    flexShrink: 0,
  },
  statusDotNeedsInput: {
    backgroundColor: getStatusDotColor({ theme, bucket: "needs_input" }) ?? undefined,
  },
  statusDotFailed: {
    backgroundColor: getStatusDotColor({ theme, bucket: "failed" }) ?? undefined,
  },
  statusDotAttention: {
    backgroundColor: getStatusDotColor({ theme, bucket: "attention" }) ?? undefined,
  },
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
}));
