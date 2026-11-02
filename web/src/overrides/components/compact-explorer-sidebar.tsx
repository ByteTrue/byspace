// Override of packages/app/src/components/compact-explorer-sidebar.tsx: the explorer on a phone — a
// full-screen sheet from the right with the Changes, Files and pull request tabs and a close button.
// The tab state, PR availability and the panes are the Expo file's; the mobile panel runtime slides
// it in and the swipes drag it (overrides/mobile-panels). Not ported: the native tablet's docked
// explorer, which the web never uses.
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { shouldUseCompactExplorerKeyboardPadding } from "@/hooks/keyboard-shift-policy";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUnistyles } from "react-native-unistyles";
import { FileExplorerPane } from "@/components/file-explorer-pane";
import { RetainedPanel, RetainedPanelActivity } from "@/components/retained-panel";
import { PullRequestTabIcon } from "@/git/pull-request-panel/tab-icon";
import { formatPrTabLabel } from "@/git/pull-request-panel/tab-label";
import { useIsMobilePanelActive } from "@/mobile-panels/provider";
import { ChangesSurface } from "@/git/diff-pane";
import { changesStateSchema, defaultChangesState, type ChangesState } from "@/panels/changes/state";
import { PullRequestContent } from "@/panels/pull-request";
import { usePullRequestPanelAvailability } from "@/panels/pull-request-availability";
import { useAddFileToChat } from "@/panels/use-add-file-to-chat";
import { useMountedTabSet } from "@/screens/workspace/use-mounted-tab-set";
import { usePanelStore, type ExplorerTab } from "@/stores/panel-store";
import { MobilePanelOverlay } from "@/mobile-panels/presentation";
import { cn } from "cn";

interface ExplorerSidebarProps {
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
  isGit: boolean;
  onOpenFile?: (filePath: string) => void;
}

function useExplorerSidebarSharedState({
  serverId,
  workspaceRoot,
  isGit,
}: Pick<ExplorerSidebarProps, "serverId" | "workspaceRoot" | "isGit">) {
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
  const isActive = useIsMobilePanelActive("file-explorer");
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);
  const { explorerTab, handleTabPress } = useExplorerSidebarSharedState({
    serverId,
    workspaceRoot,
    isGit,
  });
  return (
    <RetainedPanelActivity active={isActive}>
      <MobilePanelOverlay
        panel="file-explorer"
        className={cn(
          "flex flex-col bg-sidebar pt-[calc(env(safe-area-inset-top)+8px)] text-sm text-sidebar-foreground",
          // As packages/app: the bottom inset here, except on a repository's Changes tab, whose
          // commits section pads itself (shouldUseCompactExplorerKeyboardPadding).
          shouldUseCompactExplorerKeyboardPadding({ isGit, explorerTab }) &&
            "pb-[env(safe-area-inset-bottom)]",
        )}
        testID="compact-explorer-sidebar"
      >
        <ExplorerSidebarContent
          activeTab={explorerTab}
          onTabPress={handleTabPress}
          onClose={showMobileAgent}
          serverId={serverId}
          workspaceId={workspaceId}
          workspaceRoot={workspaceRoot}
          isGit={isGit}
          isOpen={isActive}
          onOpenFile={onOpenFile}
        />
      </MobilePanelOverlay>
    </RetainedPanelActivity>
  );
}

function ExplorerTabButton({
  tab,
  active,
  label,
  onTabPress,
  testID,
  children,
}: {
  tab: ExplorerTab;
  active: boolean;
  label?: string;
  onTabPress: (tab: ExplorerTab) => void;
  testID: string;
  children?: ReactNode;
}) {
  const handlePress = useCallback(() => onTabPress(tab), [onTabPress, tab]);
  return (
    <button
      type="button"
      data-testid={testID}
      aria-pressed={active}
      onClick={handlePress}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground",
        active && "bg-sidebar-accent text-foreground",
      )}
    >
      {children}
      {label !== undefined ? <span>{label}</span> : null}
    </button>
  );
}

interface SidebarContentProps {
  activeTab: ExplorerTab;
  onTabPress: (tab: ExplorerTab) => void;
  onClose: () => void;
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
  isGit: boolean;
  isOpen: boolean;
  onOpenFile?: (filePath: string) => void;
}

function ExplorerSidebarContent({
  activeTab,
  onTabPress,
  onClose,
  serverId,
  workspaceId,
  workspaceRoot,
  isGit,
  isOpen,
  onOpenFile,
}: SidebarContentProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const { prPane, showPullRequest: showPrTab } = usePullRequestPanelAvailability({
    serverId,
    cwd: workspaceRoot,
    isGit,
    requested: activeTab === "pr",
    enabled: isOpen,
    timelineEnabled: activeTab === "pr",
  });
  const requestedTab: ExplorerTab =
    !isGit && (activeTab === "changes" || activeTab === "pr") ? "files" : activeTab;
  const resolvedTab: ExplorerTab = requestedTab === "pr" && !showPrTab ? "changes" : requestedTab;
  const prTabLabel = formatPrTabLabel(prPane.prNumber);
  const availableTabs = useMemo<ExplorerTab[]>(() => {
    const tabs: ExplorerTab[] = isGit ? ["changes", "files"] : ["files"];
    if (isGit && showPrTab) tabs.push("pr");
    return tabs;
  }, [isGit, showPrTab]);
  const { mountedTabIds } = useMountedTabSet({
    activeTabId: resolvedTab,
    allTabIds: availableTabs,
    cap: availableTabs.length,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        className="relative flex h-14 shrink-0 items-center justify-between border-b px-2 md:h-9"
        data-testid="explorer-header"
      >
        <div className="flex gap-1">
          {isGit ? (
            <ExplorerTabButton
              tab="changes"
              active={resolvedTab === "changes"}
              label={t("workspace.tabs.explorerSidebar.changes")}
              onTabPress={onTabPress}
              testID="explorer-tab-changes"
            />
          ) : null}
          <ExplorerTabButton
            tab="files"
            active={resolvedTab === "files"}
            label={t("workspace.tabs.explorerSidebar.files")}
            onTabPress={onTabPress}
            testID="explorer-tab-files"
          />
          {isGit && showPrTab ? (
            <ExplorerTabButton
              tab="pr"
              active={resolvedTab === "pr"}
              label={prTabLabel}
              onTabPress={onTabPress}
              testID="explorer-tab-pr"
            >
              <PullRequestTabIcon
                forge={prPane.forge}
                size={13}
                color={
                  resolvedTab === "pr" ? theme.colors.foreground : theme.colors.foregroundMuted
                }
              />
            </ExplorerTabButton>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          data-testid="explorer-close"
          aria-label={t("workspace.tabs.explorerSidebar.close")}
          className="rounded-md p-2 text-muted-foreground hover:text-foreground active:text-foreground"
        >
          <X size={18} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col" data-testid="explorer-content-area">
        {mountedTabIds.has("changes") ? (
          <RetainedPanel active={resolvedTab === "changes"}>
            <ChangedFilesPane
              serverId={serverId}
              workspaceId={workspaceId}
              workspaceRoot={workspaceRoot}
              isOpen={isOpen}
              onOpenFile={onOpenFile}
            />
          </RetainedPanel>
        ) : null}
        {mountedTabIds.has("files") ? (
          <RetainedPanel active={resolvedTab === "files"}>
            <FilesPane
              serverId={serverId}
              workspaceId={workspaceId}
              workspaceRoot={workspaceRoot}
              onOpenFile={onOpenFile}
            />
          </RetainedPanel>
        ) : null}
        {mountedTabIds.has("pr") ? (
          <RetainedPanel active={resolvedTab === "pr"}>
            <PullRequestContent
              serverId={serverId}
              workspaceId={workspaceId}
              cwd={workspaceRoot}
              prPane={prPane}
            />
          </RetainedPanel>
        ) : null}
      </div>
    </div>
  );
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
  const [changesState, setChangesState] = useState<ChangesState>(() =>
    changesStateSchema.parse(defaultChangesState),
  );
  return (
    <ChangesSurface
      serverId={serverId}
      workspaceId={workspaceId}
      cwd={workspaceRoot}
      enabled={isOpen}
      onOpenFile={onOpenFile}
      onAddToChat={canAddToChat ? addFile : undefined}
      state={changesState}
      onStateChange={setChangesState}
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
