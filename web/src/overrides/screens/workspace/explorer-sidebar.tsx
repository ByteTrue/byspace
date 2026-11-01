// Override of packages/app/src/screens/workspace/explorer-sidebar.tsx: the docked right-hand pane,
// its tab rail over a hairline, and the active panel below.
import { useCallback, useMemo, type ReactNode } from "react";
import { RetainedPanel } from "@/components/retained-panel";
import type { TabDropPreview } from "@/components/split-container-tab-drop-preview";
import { ExplorerSidebarTabRail } from "@/screens/workspace/explorer-sidebar-tab-rail";
import type { WorkspaceDesktopTabRowItem } from "@/screens/workspace/workspace-desktop-tabs-row";
import type { WorkspacePaneContentModel } from "@/screens/workspace/workspace-pane-content";
import { deriveWorkspacePaneState } from "@/screens/workspace/workspace-pane-state";
import { WorkspacePanelHost } from "@/screens/workspace/workspace-panel-host";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import type { SplitPane } from "@/stores/workspace-layout-store";
import type { WorkspaceTab } from "@/workspace-tabs/model";

interface ExplorerSidebarDockProps {
  pane: SplitPane;
  uiTabs: WorkspaceTab[];
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  isWorkspaceFocused: boolean;
  closingTabIds: Set<string>;
  activeDragTabId: string | null;
  tabDropPreview: TabDropPreview | null;
  onSelectTab: (paneId: string, tabId: string) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  onCreateNewTab: () => void;
  onMoveTabToMain: (tabId: string) => void;
  onReorderTabsInPane: (paneId: string, tabIds: string[]) => void;
  buildPaneContentModel: (input: {
    paneId: string;
    tab: WorkspaceTabDescriptor;
  }) => WorkspacePaneContentModel;
  headerAction?: ReactNode;
}

export function ExplorerSidebarDock({
  pane,
  uiTabs,
  normalizedServerId,
  normalizedWorkspaceId,
  isWorkspaceFocused,
  closingTabIds,
  activeDragTabId,
  tabDropPreview,
  onSelectTab,
  onCloseTab,
  onCreateNewTab,
  onMoveTabToMain,
  onReorderTabsInPane,
  buildPaneContentModel,
  headerAction,
}: ExplorerSidebarDockProps) {
  const paneState = useMemo(() => deriveWorkspacePaneState({ pane, tabs: uiTabs }), [pane, uiTabs]);
  const tabs = useMemo(() => paneState.tabs.map((tab) => tab.descriptor), [paneState.tabs]);
  const activeTabId = paneState.activeTabId;
  const tabItems = useMemo<WorkspaceDesktopTabRowItem[]>(
    () =>
      tabs.map((tab) => ({
        tab,
        isActive: tab.tabId === activeTabId,
        isCloseHovered: false,
        isClosingTab: closingTabIds.has(tab.tabId),
      })),
    [activeTabId, closingTabIds, tabs],
  );
  const handleSelectTab = useCallback(
    (tabId: string) => onSelectTab(pane.id, tabId),
    [onSelectTab, pane.id],
  );
  const handleReorderTabs = useCallback(
    (nextTabs: WorkspaceTabDescriptor[]) =>
      onReorderTabsInPane(
        pane.id,
        nextTabs.map((tab) => tab.tabId),
      ),
    [onReorderTabsInPane, pane.id],
  );
  return (
    <RetainedPanel active>
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-sidebar"
        data-testid="workspace-explorer-sidebar"
      >
        <div className="relative h-9 shrink-0 bg-sidebar">
          <ExplorerSidebarTabRail
            paneId={pane.id}
            tabs={tabItems}
            normalizedServerId={normalizedServerId}
            normalizedWorkspaceId={normalizedWorkspaceId}
            activeDragTabId={activeDragTabId}
            tabDropPreviewIndex={
              tabDropPreview?.paneId === pane.id ? tabDropPreview.indicatorIndex : null
            }
            onNavigateTab={handleSelectTab}
            onCloseTab={onCloseTab}
            onCreateNewTab={onCreateNewTab}
            onMoveTabToMain={onMoveTabToMain}
            onReorderTabs={handleReorderTabs}
            trailingAccessory={headerAction}
          />
          {/* Above the tab rail (its sortable items are z-1 flex items), so the separator covers
              the lower pixel of the active tab's 2px underline, as in packages/app. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-px bg-border" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col bg-sidebar">
          <WorkspacePanelHost
            paneId={pane.id}
            tabs={tabs}
            activeTabId={activeTabId}
            normalizedServerId={normalizedServerId}
            normalizedWorkspaceId={normalizedWorkspaceId}
            isWorkspaceFocused={isWorkspaceFocused}
            isPaneFocused
            buildPaneContentModel={buildPaneContentModel}
          />
        </div>
      </div>
    </RetainedPanel>
  );
}
