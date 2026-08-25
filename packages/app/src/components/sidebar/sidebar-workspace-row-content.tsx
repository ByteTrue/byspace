import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { memo, useCallback, useId, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from "react-native-svg";
import { CircleAlert, Folder, FolderGit2, Monitor } from "lucide-react-native";
import { WorkspaceHoverCard } from "@/components/workspace-hover-card";
import { StatusRing } from "@/components/status-ring";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useAppSettings, type SidebarWorkspaceTrailing } from "@/hooks/use-settings";
import { hasSidebarWorkspaceTrailing } from "@/components/sidebar/workspace-trailing";
import type { Theme } from "@/styles/theme";
import type { SidebarSurfaceBackdrop } from "@/styles/surface-backdrop";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { isEmphasizedStatusDotBucket } from "@/utils/status-dot-color";
import { shouldRenderSyncedStatusLoader } from "@/utils/status-loader";
import { resolveSidebarWorkspacePrimaryLabel } from "@/components/sidebar/sidebar-workspace-title";
import type { HostBadgeModel } from "@/hosts/appearance";
import { WorkspaceMetaRow, type WorkspaceServiceSummary } from "./workspace-meta-row";

const DEFAULT_STATUS_DOT_SIZE = 6;
const EMPHASIZED_STATUS_DOT_SIZE = 9;
const DEFAULT_STATUS_DOT_OFFSET = 0;
const EMPHASIZED_STATUS_DOT_OFFSET = -1;

const SCRIM_WIDTH = 48;
const SCRIM_SOLID_OFFSET = "55%";

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const amberColorMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });

/**
 * react-native-svg's extractGradient reads stopColor off the child elements structurally,
 * without rendering them, so wrapping Stop itself in withUnistyles hides the color from it and
 * the native gradient silently falls back to black. Theme the whole SVG instead and keep real
 * Stop elements as direct children of the gradient.
 */
function TrailingActionScrimSvg({ gradientId, color }: { gradientId: string; color: string }) {
  return (
    <Svg width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <SvgLinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          {/* Same color at both ends, varying only stopOpacity. Interpolating a hex toward
              `transparent` goes through black in some engines and leaves a grey fringe. */}
          <Stop offset="0%" stopColor={color} stopOpacity={0} />
          <Stop offset={SCRIM_SOLID_OFFSET} stopColor={color} stopOpacity={1} />
          <Stop offset="100%" stopColor={color} stopOpacity={1} />
        </SvgLinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

const ThemedTrailingActionScrimSvg = withUnistyles(TrailingActionScrimSvg);

const scrimColorMappings: Record<SidebarSurfaceBackdrop, (theme: Theme) => { color: string }> = {
  surfaceSidebar: (theme) => ({ color: theme.colors.surfaceSidebar }),
  surfaceSidebarHover: (theme) => ({ color: theme.colors.surfaceSidebarHover }),
  surfaceSidebarSelected: (theme) => ({ color: theme.colors.surfaceSidebarSelected }),
  surface2: (theme) => ({ color: theme.colors.surface2 }),
};
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedCircleAlert = withUnistyles(CircleAlert);
const ThemedMonitor = withUnistyles(Monitor);
const ThemedFolder = withUnistyles(Folder);
const ThemedFolderGit2 = withUnistyles(FolderGit2);

export function SidebarWorkspaceRowFrame({
  workspace,
  isDragging = false,
  children,
}: {
  workspace: SidebarWorkspaceEntry;
  isDragging?: boolean;
  children: (input: {
    isHovered: boolean;
    hoverHandlers: { onPointerEnter: () => void; onPointerLeave: () => void };
  }) => ReactNode;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const hoverHandlers = useMemo(
    () => ({ onPointerEnter: handlePointerEnter, onPointerLeave: handlePointerLeave }),
    [handlePointerEnter, handlePointerLeave],
  );

  return (
    <WorkspaceHoverCard workspace={workspace} prHint={workspace.prHint} isDragging={isDragging}>
      {children({ isHovered: isHovered && !isDragging, hoverHandlers })}
    </WorkspaceHoverCard>
  );
}

export const SidebarWorkspaceRowContent = memo(function SidebarWorkspaceRowContent({
  workspace,
  hostBadge,
  serviceSummary = null,
  projectName = null,
  backdrop,
  isHovered,
  isLoading,
  isCreating = false,
  shortcutNumber = null,
  showShortcutBadge = false,
  reserveIdleStatusIndicatorSpace = true,
  children,
}: {
  workspace: SidebarWorkspaceEntry;
  hostBadge?: HostBadgeModel | null;
  serviceSummary?: WorkspaceServiceSummary | null;
  /** Only rows hoisted out of their project group name it; grouped rows would repeat their parent. */
  projectName?: string | null;
  backdrop: SidebarSurfaceBackdrop;
  isHovered: boolean;
  isLoading: boolean;
  isCreating?: boolean;
  shortcutNumber?: number | null;
  showShortcutBadge?: boolean;
  /** Keep the empty leading slot when the workspace has no active status. */
  reserveIdleStatusIndicatorSpace?: boolean;
  children?: ReactNode;
}) {
  const {
    settings: { workspaceTitleSource },
  } = useAppSettings();
  const workspaceLabel = resolveSidebarWorkspacePrimaryLabel({ workspace, workspaceTitleSource });
  const workspaceBranchTextStyle = useMemo(
    () => [
      styles.workspaceBranchText,
      styles.workspaceBranchTextFlexible,
      isHovered && styles.workspaceBranchTextHovered,
      isCreating && styles.workspaceBranchTextCreating,
    ],
    [isHovered, isCreating],
  );

  return (
    <View style={styles.workspaceRowContent}>
      <View style={styles.workspaceRowMain}>
        <WorkspaceStatusIndicator
          bucket={workspace.statusBucket}
          workspaceKind={workspace.workspaceKind}
          backdrop={backdrop}
          loading={isLoading}
          reserveIdleSpace={reserveIdleStatusIndicatorSpace}
        />
        <View style={styles.workspaceContentColumn}>
          <View style={styles.workspaceTitleRow}>
            <View style={styles.workspaceTitleLeft}>
              <Text style={workspaceBranchTextStyle} numberOfLines={1}>
                {workspaceLabel}
              </Text>
            </View>
            <View style={sidebarWorkspaceRowStyles.rowRight}>
              <WorkspaceAgentSummary workspace={workspace} />
              {children}
            </View>
          </View>
          <WorkspaceMetaRow
            currentBranch={workspace.currentBranch}
            projectName={projectName}
            hostBadge={hostBadge ?? null}
            prHint={workspace.prHint}
            serviceSummary={serviceSummary}
          />
        </View>
      </View>
      {showShortcutBadge && shortcutNumber !== null ? (
        <View style={styles.shortcutBadgeOverlay} pointerEvents="none">
          <SidebarWorkspaceShortcutBadge number={shortcutNumber} />
        </View>
      ) : null}
    </View>
  );
});

function WorkspaceStatusIndicator({
  bucket,
  workspaceKind,
  backdrop,
  loading = false,
  reserveIdleSpace = true,
}: {
  bucket: SidebarWorkspaceEntry["statusBucket"];
  workspaceKind: SidebarWorkspaceEntry["workspaceKind"];
  backdrop: SidebarSurfaceBackdrop;
  loading?: boolean;
  reserveIdleSpace?: boolean;
}) {
  const shouldShowSyncedLoader = shouldRenderSyncedStatusLoader({ bucket });

  if (loading) {
    return (
      <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-loading">
        <ThemedLoadingSpinner size={8} uniProps={foregroundMutedColorMapping} />
      </View>
    );
  }

  if (shouldShowSyncedLoader) {
    return (
      <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-running">
        <StatusRing backdrop={backdrop} />
      </View>
    );
  }

  if (bucket === "needs_input") {
    return (
      <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-needs_input">
        <ThemedCircleAlert size={14} uniProps={amberColorMapping} />
      </View>
    );
  }

  if (bucket === "attention") {
    return (
      <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-attention">
        <View style={styles.standaloneStatusDot} />
      </View>
    );
  }

  if (bucket === "done") {
    return reserveIdleSpace ? (
      <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-done" />
    ) : null;
  }

  let KindIcon: typeof ThemedMonitor;
  if (workspaceKind === "local_checkout") KindIcon = ThemedMonitor;
  else if (workspaceKind === "worktree") KindIcon = ThemedFolderGit2;
  else KindIcon = ThemedFolder;

  const dotColorStyle = getStatusDotColorStyle(bucket);
  const statusDotSize = isEmphasizedStatusDotBucket(bucket)
    ? EMPHASIZED_STATUS_DOT_SIZE
    : DEFAULT_STATUS_DOT_SIZE;
  const statusDotOffset =
    statusDotSize === EMPHASIZED_STATUS_DOT_SIZE
      ? EMPHASIZED_STATUS_DOT_OFFSET
      : DEFAULT_STATUS_DOT_OFFSET;
  return (
    <View
      style={styles.workspaceStatusDot}
      accessible
      testID={`workspace-status-indicator-${bucket}`}
    >
      <KindIcon size={14} uniProps={foregroundMutedColorMapping} />
      {dotColorStyle ? (
        <StatusDotOverlay
          dotColorStyle={dotColorStyle}
          size={statusDotSize}
          offset={statusDotOffset}
        />
      ) : null}
    </View>
  );
}

function StatusDotOverlay({
  dotColorStyle,
  size,
  offset,
}: {
  dotColorStyle: ViewStyle;
  size: number;
  offset: number;
}) {
  const overlayStyle = useMemo(
    () => [
      styles.statusDotOverlay,
      dotColorStyle,
      {
        width: size,
        height: size,
        right: offset,
        bottom: offset,
      },
    ],
    [dotColorStyle, offset, size],
  );
  return <View style={overlayStyle} />;
}

function getStatusDotColorStyle(bucket: SidebarStateBucket) {
  switch (bucket) {
    case "needs_input":
      return styles.statusDotNeedsInput;
    case "failed":
      return styles.statusDotFailed;
    case "running":
      return styles.statusDotRunning;
    case "attention":
      return styles.statusDotAttention;
    case "done":
      return null;
  }
}

function WorkspaceAgentSummary({ workspace }: { workspace: SidebarWorkspaceEntry }) {
  const { t } = useTranslation();
  const summary = workspace.agentSummary;
  if (!summary) return null;
  if (summary.needsAttentionCount > 0) {
    return (
      <View
        style={sidebarWorkspaceRowStyles.agentSummary}
        testID="workspace-agent-summary-attention"
        accessible
        accessibilityLabel={t("sidebar.workspace.agentSummary.needsAttention", {
          count: summary.needsAttentionCount,
        })}
      >
        <ThemedCircleAlert size={12} uniProps={amberColorMapping} />
        <Text style={sidebarWorkspaceRowStyles.agentSummaryAttentionText}>
          {summary.needsAttentionCount}
        </Text>
      </View>
    );
  }
  if (summary.workingCount > 0) {
    return (
      <View
        style={sidebarWorkspaceRowStyles.agentSummary}
        testID="workspace-agent-summary-working"
        accessible
        accessibilityLabel={t("sidebar.workspace.agentSummary.working", {
          count: summary.workingCount,
        })}
      >
        <View style={sidebarWorkspaceRowStyles.agentSummaryWorkingDot} />
        <Text style={sidebarWorkspaceRowStyles.agentSummaryWorkingText}>
          {summary.workingCount}
        </Text>
      </View>
    );
  }
  return null;
}

export const sidebarWorkspaceRowStyles = StyleSheet.create((theme) => ({
  rowRight: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  agentSummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    minHeight: 18,
  },
  agentSummaryWorkingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.statusSuccess,
  },
  agentSummaryAttentionText: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  agentSummaryWorkingText: {
    color: theme.colors.statusSuccess,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  shortcutBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.surface2,
    backgroundColor: theme.colors.surface0,
    flexShrink: 0,
  },
  shortcutBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 14,
  },
  hidden: { opacity: 0 },
  trailingActionSlot: {
    position: "relative",
    minWidth: 18,
    minHeight: 20,
    flexShrink: 0,
    alignItems: "flex-end",
    justifyContent: "flex-start",
  },
  trailingActionOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
  },
  trailingActionScrim: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    width: SCRIM_WIDTH,
  },
}));

export function SidebarWorkspaceShortcutBadge({ number }: { number: number }) {
  return (
    <View style={sidebarWorkspaceRowStyles.shortcutBadge}>
      <Text style={sidebarWorkspaceRowStyles.shortcutBadgeText}>{number}</Text>
    </View>
  );
}

/**
 * What the trailing slot shows for a row. Derived in one place so row renderers
 * share consistent visibility and fade under the scrim.
 */
export function resolveTrailingActionVisibility({
  workspace,
  trailing,
  hasArchiveAction,
  isHovered,
  isTouchPlatform,
  showShortcut,
}: {
  workspace: SidebarWorkspaceEntry;
  trailing: SidebarWorkspaceTrailing;
  hasArchiveAction: boolean;
  isHovered: boolean;
  isTouchPlatform: boolean;
  showShortcut: boolean;
}): {
  showTrailing: boolean;
  showKebab: boolean;
  showScrim: boolean;
  renderSlot: boolean;
} {
  const hasTrailing = hasSidebarWorkspaceTrailing({ workspace, trailing });
  const showKebab = Boolean(hasArchiveAction && (isHovered || isTouchPlatform)) && !showShortcut;
  const showTrailing = hasTrailing && !showShortcut && (isHovered || !showKebab);
  return {
    showTrailing,
    showKebab,
    showScrim: showKebab && isHovered,
    renderSlot: Boolean(hasArchiveAction || hasTrailing),
  };
}

export function SidebarWorkspaceTrailingActionSlot({ children }: { children: ReactNode }) {
  return <View style={sidebarWorkspaceRowStyles.trailingActionSlot}>{children}</View>;
}

export function SidebarWorkspaceTrailingActionBase({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  if (!children) return null;
  return <View style={visible ? undefined : sidebarWorkspaceRowStyles.hidden}>{children}</View>;
}

export function SidebarWorkspaceTrailingActionOverlay({
  visible,
  scrimBackdrop,
  children,
}: {
  visible: boolean;
  /** Fade the row into the kebab when something (the diff stat) is still rendered behind it. */
  scrimBackdrop?: SidebarSurfaceBackdrop;
  children: ReactNode;
}) {
  if (!visible || !children) return null;
  return (
    <>
      {scrimBackdrop ? <TrailingActionScrim backdrop={scrimBackdrop} /> : null}
      <View style={sidebarWorkspaceRowStyles.trailingActionOverlay}>{children}</View>
    </>
  );
}

/**
 * The row's own background, faded in from the right, sitting between the diff stat and the
 * kebab. The kebab lands on fully opaque background while the diff dissolves underneath it
 * rather than blinking out.
 *
 * Anchored to the trailing slot, which is position:relative. Wider than the slot on purpose:
 * the fade has to start before the diff stat does or the diff's left edge cuts off hard.
 */
function TrailingActionScrim({ backdrop }: { backdrop: SidebarSurfaceBackdrop }) {
  // useId's output contains characters that are not legal inside url(#...) — React 19 wraps
  // ids in guillemets, React 18 in colons — and an unresolvable fill paints nothing at all.
  // Keep the per-instance uniqueness, drop everything a fragment reference can't carry.
  const gradientId = `sidebar-scrim-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <View
      style={sidebarWorkspaceRowStyles.trailingActionScrim}
      pointerEvents="none"
      testID="sidebar-workspace-trailing-scrim"
    >
      <ThemedTrailingActionScrimSvg
        gradientId={gradientId}
        uniProps={scrimColorMappings[backdrop]}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  workspaceRowContent: {
    position: "relative",
  },
  workspaceRowMain: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    width: "100%",
  },
  workspaceContentColumn: {
    flex: 1,
    minWidth: 0,
  },
  workspaceTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  workspaceTitleLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flex: 1,
    minWidth: 0,
  },
  shortcutBadgeOverlay: {
    position: "absolute",
    top: 1,
    right: 0,
  },
  workspaceStatusDot: {
    position: "relative",
    width: theme.iconSize.md,
    height: 20,
    borderRadius: theme.borderRadius.full,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  statusDotOverlay: {
    position: "absolute",
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
  },
  standaloneStatusDot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.statusDotSuccess,
  },
  workspaceBranchText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "400",
    lineHeight: 20,
    opacity: 0.76,
    minWidth: 0,
  },
  workspaceBranchTextFlexible: {
    flex: 1,
  },
  workspaceBranchTextCreating: {
    opacity: 0.92,
  },
  workspaceBranchTextHovered: {
    opacity: 1,
  },
  statusDotNeedsInput: {
    backgroundColor: theme.colors.statusDotWarning,
    borderColor: theme.colors.surface0,
  },
  statusDotFailed: {
    backgroundColor: theme.colors.statusDotDanger,
    borderColor: theme.colors.surface0,
  },
  statusDotRunning: {
    backgroundColor: theme.colors.statusDotRunning,
    borderColor: theme.colors.surface0,
  },
  statusDotAttention: {
    backgroundColor: theme.colors.statusDotSuccess,
    borderColor: theme.colors.surface0,
  },
}));
