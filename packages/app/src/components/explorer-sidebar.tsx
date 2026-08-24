import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  useWindowDimensions,
  StyleSheet as RNStyleSheet,
} from "react-native";
import type { LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
  runOnJS,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { Gesture } from "react-native-gesture-handler";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  formatPrTabLabel,
  PullRequestPane,
  PullRequestPaneError,
  PullRequestPaneSkeleton,
  PullRequestTabIcon,
  usePrPaneData,
} from "@/git/pull-request-panel";
import { useCheckoutGitActionsStore } from "@/git/actions-store";
import type { UsePrPaneDataResult } from "@/git/pull-request-panel/use-data";
import { usePanelStore, selectIsFileExplorerOpen, type ExplorerTab } from "@/stores/panel-store";
import { useToast } from "@/contexts/toast-context";
import { useCloseFileExplorerGesture } from "@/mobile-panels/gestures";
import { MobilePanelOverlay } from "@/mobile-panels/presentation";
import { HEADER_INNER_HEIGHT } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { GitDiffPane } from "@/git/diff-pane";
import { BranchSwitcher } from "@/components/branch-switcher";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import { FileExplorerPane } from "./file-explorer-pane";

import { RetainedPanelActivity } from "@/components/retained-panel";
import { SidebarResizeHandle } from "@/components/sidebar-resize-handle";
import { buildWorkspaceAttachmentScopeKey } from "@/attachments/workspace-attachments-store";
import { resolveDesktopExplorerWidth } from "@/components/desktop-sidebar-layout";
import { resolveSidebarResizePanGestureConfig } from "@/components/sidebar-resize-handle-layout";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store/state";
import { resolveFocusedChatTarget } from "@/composer/focused-chat-target";
import { createWorkspaceFileAttachment } from "@/attachments/workspace-file";
import { useDraftStore } from "@/stores/draft-store";

interface ExplorerSidebarProps {
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
  isGit: boolean;
  onOpenFile?: (filePath: string) => void;
}

interface ExplorerSidebarSharedState {
  explorerTab: ExplorerTab;
  handleTabPress: (tab: ExplorerTab) => void;
}

function useExplorerSidebarSharedState({
  serverId,
  workspaceRoot,
  isGit,
}: Pick<ExplorerSidebarProps, "serverId" | "workspaceRoot" | "isGit">): ExplorerSidebarSharedState {
  const explorerTab = usePanelStore((state) => state.explorerTab);
  const setExplorerTabForCheckout = usePanelStore((state) => state.setExplorerTabForCheckout);
  const handleTabPress = useCallback(
    (tab: ExplorerTab) => {
      setExplorerTabForCheckout({ serverId, cwd: workspaceRoot, isGit, tab });
    },
    [isGit, serverId, setExplorerTabForCheckout, workspaceRoot],
  );

  return { explorerTab, handleTabPress };
}

export function CompactExplorerSidebar({
  serverId,
  workspaceId,
  workspaceRoot,
  isGit,
  onOpenFile,
}: ExplorerSidebarProps) {
  const { theme } = useUnistyles();
  const insets = useSafeAreaInsets();
  const isOpen = usePanelStore((state) => selectIsFileExplorerOpen(state, { isCompact: true }));
  const { explorerTab, handleTabPress } = useExplorerSidebarSharedState({
    serverId,
    workspaceRoot,
    isGit,
  });
  const { gesture: closeGesture } = useCloseFileExplorerGesture();
  const mobileSidebarStyle = useMemo(
    () => ({
      paddingTop: insets.top,
      backgroundColor: theme.colors.surfaceSidebar,
    }),
    [insets.top, theme.colors.surfaceSidebar],
  );

  return (
    <RetainedPanelActivity active={isOpen}>
      <MobilePanelOverlay
        panel="file-explorer"
        closeGesture={closeGesture}
        panelStyle={mobileSidebarStyle}
      >
        <ExplorerSidebarContent
          activeTab={explorerTab}
          onTabPress={handleTabPress}
          serverId={serverId}
          workspaceId={workspaceId}
          workspaceRoot={workspaceRoot}
          isGit={isGit}
          isOpen={isOpen}
          onOpenFile={onOpenFile}
        />
      </MobilePanelOverlay>
    </RetainedPanelActivity>
  );
}

export function ExplorerSidebar({
  serverId,
  workspaceId,
  workspaceRoot,
  isGit,
  onOpenFile,
}: ExplorerSidebarProps) {
  const insets = useSafeAreaInsets();
  const explorerWidth = usePanelStore((state) => state.explorerWidth);
  const setExplorerWidth = usePanelStore((state) => state.setExplorerWidth);
  const isOpen = usePanelStore((state) => selectIsFileExplorerOpen(state, { isCompact: false }));
  const { explorerTab, handleTabPress } = useExplorerSidebarSharedState({
    serverId,
    workspaceRoot,
    isGit,
  });
  const { width: viewportWidth } = useWindowDimensions();
  const visibleExplorerWidth = resolveDesktopExplorerWidth({
    requestedWidth: explorerWidth,
    viewportWidth,
  });
  const startWidthRef = useRef(visibleExplorerWidth);
  const resizeWidth = useSharedValue(visibleExplorerWidth);
  const [resizePressed, setResizePressed] = useState(false);
  const showResizeGrip = useCallback(() => setResizePressed(true), []);
  const hideResizeGrip = useCallback(() => setResizePressed(false), []);

  useEffect(() => {
    resizeWidth.value = visibleExplorerWidth;
  }, [resizeWidth, visibleExplorerWidth]);

  const resizeGesture = useMemo(() => {
    const gesture = Gesture.Pan().enabled(true).hitSlop({ left: 8, right: 8, top: 0, bottom: 0 });
    const webConfig = resolveSidebarResizePanGestureConfig(isWeb);

    if (webConfig) {
      gesture
        .onBegin(() => {
          scheduleOnRN(showResizeGrip);
        })
        .activeOffsetX(webConfig.activeOffsetX)
        .failOffsetY(webConfig.failOffsetY);
    }

    gesture
      .onStart((event) => {
        startWidthRef.current = visibleExplorerWidth + (isWeb ? event.translationX : 0);
        resizeWidth.value = visibleExplorerWidth;
      })
      .onUpdate((event) => {
        const newWidth = startWidthRef.current - event.translationX;
        resizeWidth.value = resolveDesktopExplorerWidth({
          requestedWidth: newWidth,
          viewportWidth,
        });
      })
      .onEnd(() => {
        runOnJS(setExplorerWidth)(resizeWidth.value);
      });

    if (webConfig) {
      gesture.onFinalize(() => {
        scheduleOnRN(hideResizeGrip);
      });
    }

    return gesture;
  }, [
    hideResizeGrip,
    resizeWidth,
    setExplorerWidth,
    showResizeGrip,
    viewportWidth,
    visibleExplorerWidth,
  ]);

  const resizeAnimatedStyle = useAnimatedStyle(() => ({
    width: resizeWidth.value,
  }));
  const desktopSidebarStyle = useMemo(
    () => [explorerStaticStyles.desktopSidebar, resizeAnimatedStyle, { paddingTop: insets.top }],
    [resizeAnimatedStyle, insets.top],
  );

  if (!isOpen) {
    return null;
  }

  return (
    <Animated.View style={desktopSidebarStyle}>
      <View style={[styles.desktopSidebarBorder, { flex: 1 }]}>
        <SidebarResizeHandle
          edge="left"
          gesture={resizeGesture}
          pressed={resizePressed}
          testID="explorer-sidebar-resize-handle"
        />

        <ExplorerSidebarContent
          activeTab={explorerTab}
          onTabPress={handleTabPress}
          serverId={serverId}
          workspaceId={workspaceId}
          workspaceRoot={workspaceRoot}
          isGit={isGit}
          isOpen={isOpen}
          onOpenFile={onOpenFile}
        />
      </View>
    </Animated.View>
  );
}

interface ExplorerTabButtonProps {
  tab: ExplorerTab;
  active: boolean;
  label?: string;
  onTabPress: (tab: ExplorerTab) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  testID: string;
  children?: React.ReactNode;
}

function ExplorerTabButton({
  tab,
  active,
  label,
  onTabPress,
  onLayout,
  testID,
  children,
}: ExplorerTabButtonProps) {
  const handlePress = useCallback(() => onTabPress(tab), [onTabPress, tab]);
  const accessibilityState = useMemo(() => ({ selected: active }), [active]);

  return (
    <Pressable
      testID={testID}
      style={styles.tab}
      onPress={handlePress}
      onLayout={onLayout}
      accessibilityRole="tab"
      accessibilityState={accessibilityState}
    >
      {({ hovered }) => (
        <View style={styles.tabContent}>
          {children}
          {label !== undefined ? (
            <Text
              style={[
                styles.tabText,
                active && styles.tabTextActive,
                Boolean(hovered) && !active && styles.tabTextHover,
              ]}
            >
              {label}
            </Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

interface SidebarContentProps {
  activeTab: ExplorerTab;
  onTabPress: (tab: ExplorerTab) => void;
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
  isGit: boolean;
  isOpen: boolean;
  onOpenFile?: (filePath: string) => void;
}

interface ExplorerSidebarHeaderProps {
  resolvedTab: ExplorerTab;
  onTabPress: (tab: ExplorerTab) => void;
  isGit: boolean;
  showPrTab: boolean;
  prTabLabel: string;
  prForge: Parameters<typeof PullRequestTabIcon>[0]["forge"];
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string | null;
  currentBranchName: string | null;
}

function ExplorerSidebarHeader({
  resolvedTab,
  onTabPress,
  isGit,
  showPrTab,
  prTabLabel,
  prForge,
  serverId,
  workspaceId,
  workspaceRoot,
  currentBranchName,
}: ExplorerSidebarHeaderProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const [tabLayouts, setTabLayouts] = useState<Record<string, { x: number; width: number }>>({});
  const indicatorX = useSharedValue(0);
  const indicatorWidth = useSharedValue(0);
  const isIndicatorReady = useSharedValue(false);

  const handleTabLayout = useCallback((tab: string, event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout;
    if (width <= 0) return;
    setTabLayouts((prev) => {
      if (prev[tab]?.x === x && prev[tab]?.width === width) return prev;
      return { ...prev, [tab]: { x, width } };
    });
  }, []);

  useEffect(() => {
    const currentLayout = tabLayouts[resolvedTab];
    if (currentLayout) {
      if (!isIndicatorReady.value) {
        indicatorX.value = currentLayout.x;
        indicatorWidth.value = currentLayout.width;
        isIndicatorReady.value = true;
      } else {
        indicatorX.value = withTiming(currentLayout.x, {
          duration: 200,
          easing: Easing.out(Easing.cubic),
        });
        indicatorWidth.value = withTiming(currentLayout.width, {
          duration: 200,
          easing: Easing.out(Easing.cubic),
        });
      }
    }
  }, [indicatorWidth, indicatorX, isIndicatorReady, resolvedTab, tabLayouts]);

  const animatedIndicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorX.value }],
    width: indicatorWidth.value,
    opacity: isIndicatorReady.value ? 1 : 0,
  }));
  const handleChangesTabLayout = useCallback(
    (e: LayoutChangeEvent) => handleTabLayout("changes", e),
    [handleTabLayout],
  );
  const handleFilesTabLayout = useCallback(
    (e: LayoutChangeEvent) => handleTabLayout("files", e),
    [handleTabLayout],
  );
  const handlePrTabLayout = useCallback(
    (e: LayoutChangeEvent) => handleTabLayout("pr", e),
    [handleTabLayout],
  );

  return (
    <View style={styles.header} testID="explorer-header">
      <View style={styles.tabsContainer}>
        {isGit && (
          <ExplorerTabButton
            tab="changes"
            active={resolvedTab === "changes"}
            label={t("workspace.tabs.explorer.changes")}
            onTabPress={onTabPress}
            onLayout={handleChangesTabLayout}
            testID="explorer-tab-changes"
          />
        )}
        <ExplorerTabButton
          tab="files"
          active={resolvedTab === "files"}
          label={t("workspace.tabs.explorer.files")}
          onTabPress={onTabPress}
          onLayout={handleFilesTabLayout}
          testID="explorer-tab-files"
        />
        {isGit && showPrTab && (
          <ExplorerTabButton
            tab="pr"
            active={resolvedTab === "pr"}
            label={prTabLabel}
            onTabPress={onTabPress}
            onLayout={handlePrTabLayout}
            testID="explorer-tab-pr"
          >
            <PullRequestTabIcon
              forge={prForge}
              size={13}
              color={resolvedTab === "pr" ? theme.colors.foreground : theme.colors.foregroundMuted}
            />
          </ExplorerTabButton>
        )}
        <Animated.View style={[styles.activeIndicator, animatedIndicatorStyle]} />
      </View>

      {isGit && currentBranchName ? (
        <View style={styles.headerBranchContainer}>
          <BranchSwitcher
            currentBranchName={currentBranchName}
            serverId={serverId}
            workspaceId={workspaceId ?? workspaceRoot ?? ""}
            workspaceDirectory={workspaceRoot}
            isGitCheckout={isGit}
            testID="changes-branch-switcher"
          />
        </View>
      ) : null}
    </View>
  );
}

function ExplorerSidebarContent({
  activeTab,
  onTabPress,
  serverId,
  workspaceId,
  workspaceRoot,
  isGit,
  isOpen,
  onOpenFile,
}: SidebarContentProps) {
  const { t } = useTranslation();
  const toast = useToast();

  const canQueryPullRequest = isGit && Boolean(workspaceRoot);
  const prPane = usePrPaneData({
    serverId,
    cwd: workspaceRoot,
    enabled: canQueryPullRequest && isOpen,
    timelineEnabled: activeTab === "pr" && canQueryPullRequest && isOpen,
  });
  const hasPullRequest = prPane.prNumber !== null;
  const showPrTab = hasPullRequest || (activeTab === "pr" && prPane.isLoading);
  const requestedTab: ExplorerTab =
    !isGit && (activeTab === "changes" || activeTab === "pr") ? "files" : activeTab;
  const resolvedTab: ExplorerTab = requestedTab === "pr" && !showPrTab ? "changes" : requestedTab;
  const prTabLabel = formatPrTabLabel(prPane.prNumber);
  const refreshGitActions = useCheckoutGitActionsStore((s) => s.refresh);
  const handlePrRetry = useCallback(() => {
    refreshGitActions({ serverId, cwd: workspaceRoot }).catch((error) => {
      toast.error(error instanceof Error ? error.message : t("workspace.git.diff.failedRefresh"));
    });
  }, [refreshGitActions, serverId, t, toast, workspaceRoot]);
  const workspaceAttachmentScopeKey = useMemo(
    () => buildWorkspaceAttachmentScopeKey({ serverId, workspaceId, cwd: workspaceRoot }),
    [serverId, workspaceId, workspaceRoot],
  );

  const { status: checkoutStatus } = useCheckoutStatusQuery({
    serverId,
    cwd: workspaceRoot ?? "",
  });
  const currentBranchName =
    checkoutStatus && "isGit" in checkoutStatus && checkoutStatus.isGit
      ? checkoutStatus.currentBranch
      : null;

  return (
    <View style={styles.sidebarContent} pointerEvents="auto">
      <ExplorerSidebarHeader
        resolvedTab={resolvedTab}
        onTabPress={onTabPress}
        isGit={isGit}
        showPrTab={showPrTab}
        prTabLabel={prTabLabel}
        prForge={prPane.forge}
        serverId={serverId}
        workspaceId={workspaceId}
        workspaceRoot={workspaceRoot}
        currentBranchName={currentBranchName}
      />

      {/* Content based on active tab */}
      <View style={styles.contentArea} testID="explorer-content-area">
        {resolvedTab === "changes" && (
          <ChangedFilesPane
            serverId={serverId}
            workspaceId={workspaceId}
            workspaceRoot={workspaceRoot}
            isOpen={isOpen}
            onOpenFile={onOpenFile}
          />
        )}
        {resolvedTab === "files" && (
          <FilesPane
            serverId={serverId}
            workspaceId={workspaceId}
            workspaceRoot={workspaceRoot}
            onOpenFile={onOpenFile}
          />
        )}
        {resolvedTab === "pr" && (
          <PrTabContent
            serverId={serverId}
            cwd={workspaceRoot}
            prPane={prPane}
            workspaceAttachmentScopeKey={workspaceAttachmentScopeKey}
            onRetry={handlePrRetry}
          />
        )}
      </View>
    </View>
  );
}

function useAddFileToChat({
  serverId,
  workspaceId,
}: Pick<SidebarContentProps, "serverId" | "workspaceId">) {
  const workspaceKey = workspaceId
    ? buildWorkspaceTabPersistenceKey({ serverId, workspaceId })
    : null;
  const layout = useWorkspaceLayoutStore((state) =>
    workspaceKey ? state.layoutByWorkspace[workspaceKey] : undefined,
  );
  const focusTab = useWorkspaceLayoutStore((state) => state.focusTab);
  const focusedChat = useMemo(
    () => resolveFocusedChatTarget({ serverId, layout }),
    [serverId, layout],
  );
  const addFile = useCallback(
    (filePath: string) => {
      if (!focusedChat || !workspaceKey) {
        return;
      }
      void useDraftStore.getState().attachWorkspaceFile({
        draftKey: focusedChat.draftKey,
        attachment: createWorkspaceFileAttachment({ path: filePath }),
      });
      focusTab(workspaceKey, focusedChat.tabId);
    },
    [focusTab, focusedChat, workspaceKey],
  );
  return { addFile, canAddToChat: focusedChat !== null };
}

function ChangedFilesPane({
  serverId,
  workspaceId,
  workspaceRoot,
  isOpen,
  onOpenFile,
}: Pick<
  SidebarContentProps,
  "serverId" | "workspaceId" | "workspaceRoot" | "isOpen" | "onOpenFile"
>) {
  const { addFile, canAddToChat } = useAddFileToChat({ serverId, workspaceId });
  return (
    <GitDiffPane
      serverId={serverId}
      workspaceId={workspaceId}
      cwd={workspaceRoot}
      enabled={isOpen}
      onOpenFile={onOpenFile}
      onAddToChat={canAddToChat ? addFile : undefined}
    />
  );
}

function FilesPane({
  serverId,
  workspaceId,
  workspaceRoot,
  onOpenFile,
}: Pick<SidebarContentProps, "serverId" | "workspaceId" | "workspaceRoot" | "onOpenFile">) {
  const { addFile, canAddToChat } = useAddFileToChat({ serverId, workspaceId });
  return (
    <FileExplorerPane
      serverId={serverId}
      workspaceId={workspaceId}
      workspaceRoot={workspaceRoot}
      onOpenFile={onOpenFile}
      onAddToChat={canAddToChat ? addFile : undefined}
    />
  );
}

interface PrTabContentProps {
  serverId: string;
  cwd: string;
  prPane: UsePrPaneDataResult;
  workspaceAttachmentScopeKey: string;
  onRetry: () => void;
}

function PrTabContent({
  serverId,
  cwd,
  prPane,
  workspaceAttachmentScopeKey,
  onRetry,
}: PrTabContentProps) {
  if (prPane.data) {
    return (
      <PullRequestPane
        serverId={serverId}
        cwd={cwd}
        data={prPane.data}
        activityLoading={prPane.activityLoading}
        workspaceAttachmentScopeKey={workspaceAttachmentScopeKey}
      />
    );
  }
  if (prPane.error) {
    return <PullRequestPaneError onRetry={onRetry} />;
  }
  return <PullRequestPaneSkeleton />;
}

// Static styles for Animated.Views — must NOT use Unistyles dynamic theme to
// avoid the "Unable to find node on an unmounted component" crash when Unistyles
// tries to patch the native node that Reanimated also manages.
const explorerStaticStyles = RNStyleSheet.create({
  desktopSidebar: {
    position: "relative" as const,
  },
});

const styles = StyleSheet.create((theme) => ({
  desktopSidebarBorder: {
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  sidebarContent: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  },
  header: {
    position: "relative",
    height: HEADER_INNER_HEIGHT,
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerBranchContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    flexShrink: 1,
    minWidth: 0,
    maxWidth: 160,
  },
  tabsContainer: {
    flexDirection: "row",
    alignItems: "stretch",
    position: "relative",
    gap: theme.spacing[2],
  },
  tab: {
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: theme.spacing[2],
  },
  tabContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  activeIndicator: {
    position: "absolute",
    bottom: -1,
    left: 0,
    height: 2,
    borderRadius: 2,
    backgroundColor: theme.colors.foreground,
    zIndex: 2,
    pointerEvents: "none",
  },
  tabText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  tabTextActive: {
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  tabTextHover: {
    color: theme.colors.foreground,
  },
  contentArea: {
    flex: 1,
    minHeight: 0,
  },
}));
