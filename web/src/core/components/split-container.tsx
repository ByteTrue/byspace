// Port of archive/expo-app:packages/app/src/components/split-container.tsx. The drag-and-drop, split, resize,
// maximize and explorer-dock logic is the Expo file's; the view is DOM and Tailwind.
// Converted from the Expo file by archive/expo-app:web/scripts/port/split-container.py; edit it directly.
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useStableEvent } from "@/hooks/use-stable-event";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useTranslation } from "react-i18next";
import type { Layout, LayoutChangedMeta } from "react-resizable-panels";
import { useGroupRef, usePanelRef } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "~/components/ui/resizable";
import { RetainedPanel } from "@/components/retained-panel";
import {
  hasMultipleVisiblePanes,
  resolveSplitContainerRoot,
  splitNodeContainsPane,
} from "@/components/split-container-focus";
import { shouldFocusPaneFromEventTarget } from "@/components/split-container-pane-focus";
import {
  computeTabDropPreview,
  type TabDropPreview,
} from "@/components/split-container-tab-drop-preview";
import {
  SplitDropZone,
  resolveSplitDropPosition,
  type SplitDropZoneHover,
} from "@/components/split-drop-zone";
import {
  deriveWorkspacePaneState,
  getWorkspacePaneDescriptors,
} from "@/screens/workspace/workspace-pane-state";
import type { WorkspacePaneContentModel } from "@/screens/workspace/workspace-pane-content";
import { WorkspacePanelHost } from "@/screens/workspace/workspace-panel-host";
import {
  WorkspaceDesktopTabsRow,
  type WorkspaceDesktopTabRowItem,
} from "@/screens/workspace/workspace-desktop-tabs-row";
import { ExplorerSidebarDock } from "@/screens/workspace/explorer-sidebar";
import {
  WorkspaceTabPresentationResolver,
  WorkspaceTabIcon,
} from "@/screens/workspace/workspace-tab-presentation";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import {
  createDefaultLayout,
  findPaneById,
  useWorkspaceLayoutStore,
  type SplitNode,
  type SplitPane,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-store";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import { RenderProfile } from "@/utils/render-profiler";
import { panelTargetSupportsHost } from "@/plugins/workspace-panels/locations";

/** Width or height of an element, kept current with a ResizeObserver. */
interface SplitContainerProps {
  layout: WorkspaceLayout;
  renderMainHeader?: () => ReactNode;
  renderExplorerSidebarHeaderAction?: () => ReactNode;
  workspaceKey: string;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  isWorkspaceFocused: boolean;
  uiTabs: WorkspaceTab[];
  hoveredCloseTabKey: string | null;
  setHoveredCloseTabKey: Dispatch<SetStateAction<string | null>>;
  closingTabIds: Set<string>;
  onNavigateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  onCopyResumeCommand: (agentId: string) => Promise<void> | void;
  onCopyAgentId: (agentId: string) => Promise<void> | void;
  onCopyTerminalId: (terminalId: string) => Promise<void> | void;
  onCopyFilePath: (path: string) => Promise<void> | void;
  onReloadAgent: (agentId: string) => Promise<void> | void;
  onRenameTab: (tab: WorkspaceTabDescriptor) => void;
  onCloseTabsToLeft: (tabId: string, paneTabs: WorkspaceTabDescriptor[]) => Promise<void> | void;
  onCloseTabsToRight: (tabId: string, paneTabs: WorkspaceTabDescriptor[]) => Promise<void> | void;
  onCloseOtherTabs: (tabId: string, paneTabs: WorkspaceTabDescriptor[]) => Promise<void> | void;
  onCreateNewTab: (input: { paneId?: string }) => void;
  buildPaneContentModel: (input: {
    paneId: string;
    tab: WorkspaceTabDescriptor;
  }) => WorkspacePaneContentModel;
  onFocusPane: (paneId: string) => void;
  onSplitPane: (input: {
    tabId: string;
    targetPaneId: string;
    position: "left" | "right" | "top" | "bottom";
  }) => void;
  onSplitPaneEmpty: (input: {
    targetPaneId: string;
    position: "left" | "right" | "top" | "bottom";
  }) => void;
  onMoveTabToPane: (tabId: string, toPaneId: string) => void;
  onSelectTabInPane: (paneId: string, tabId: string) => void;
  onResizeSplit: (groupId: string, sizes: number[]) => void;
  onReorderTabsInPane: (paneId: string, tabIds: string[]) => void;
  focusModeEnabled?: boolean;
  onExitFocusMode: () => void;
}

interface WorkspaceTabDragData {
  kind: "workspace-tab";
  paneId: string;
  tabId: string;
}

interface SplitPaneDropData {
  kind: "split-pane-drop";
  paneId: string;
}

const EMPTY_SPLIT_NODES: SplitNode[] = [];
const EMPTY_SPLIT_SIZES: number[] = [];
// The explorer dock's width, and the space the workspace keeps beside it.
const DEFAULT_EXPLORER_SIDEBAR_WIDTH = 320;
const MIN_EXPLORER_SIDEBAR_WIDTH = 240;
const MIN_WORKSPACE_BODY_WIDTH = 400;
const RESIZE_TARGET_SIZE = { fine: 4, coarse: 20 };
// A panel's content manages its own scrolling; the panel itself never scrolls.
const PANEL_CONTENT_STYLE = { overflow: "hidden" } as const;

function isWorkspaceTabDragData(data: unknown): data is WorkspaceTabDragData {
  return typeof data === "object" && data !== null && Reflect.get(data, "kind") === "workspace-tab";
}

function isSplitPaneDropData(data: unknown): data is SplitPaneDropData {
  return (
    typeof data === "object" && data !== null && Reflect.get(data, "kind") === "split-pane-drop"
  );
}

function asWorkspaceTabDragData(data: unknown): WorkspaceTabDragData | undefined {
  return isWorkspaceTabDragData(data) ? data : undefined;
}

function asDragOverData(data: unknown): WorkspaceTabDragData | SplitPaneDropData | undefined {
  if (isWorkspaceTabDragData(data)) return data;
  if (isSplitPaneDropData(data)) return data;
  return undefined;
}

interface SplitNodeViewProps extends Omit<
  SplitContainerProps,
  "layout" | "onMoveTabToPane" | "onSelectTabInPane"
> {
  node: SplitNode;
  uiTabs: WorkspaceTab[];
  focusedPaneId: string | null;
  activeDragTabId: string | null;
  showDropZones: boolean;
  dropPreview: SplitDropZoneHover | null;
  tabDropPreview: TabDropPreview | null;
  maximizedPaneId: string | null;
  workspaceHasMultiplePanes: boolean;
  onTogglePaneMaximized: (paneId: string) => void;
}

interface SplitPaneViewProps extends Omit<
  SplitNodeViewProps,
  | "node"
  | "workspaceKey"
  | "focusedPaneId"
  | "activeDragTabId"
  | "showDropZones"
  | "dropPreview"
  | "onResizeSplit"
> {
  pane: SplitPane;
  uiTabs: WorkspaceTab[];
  isFocused: boolean;
  activeDragTabId: string | null;
  showDropZones: boolean;
  dropPreview: SplitDropZoneHover | null;
  tabDropPreview: TabDropPreview | null;
}

interface DragMoveRects {
  translatedRect: { left: number; top: number; width: number; height: number };
  overRect: { left: number; top: number; width: number; height: number };
}

function resolveDragMoveRects(
  event: Pick<DragMoveEvent, "active" | "over"> | Pick<DragOverEvent, "active" | "over">,
): DragMoveRects | null {
  const translatedRect = event.active.rect.current.translated;
  const overRect = event.over?.rect;
  if (!translatedRect || !overRect || overRect.width <= 0 || overRect.height <= 0) {
    return null;
  }
  return { translatedRect, overRect };
}

function computeTabOverDropPreview(input: {
  activeData: WorkspaceTabDragData;
  overData: WorkspaceTabDragData;
  rects: DragMoveRects;
  panesById: Map<string, SplitPane>;
  uiTabs: WorkspaceTab[];
}): TabDropPreview | null {
  const { activeData, overData, rects, panesById, uiTabs } = input;
  const targetPane = panesById.get(overData.paneId) ?? null;
  if (!targetPane) {
    return null;
  }
  const targetTabs = getWorkspacePaneDescriptors({ pane: targetPane, tabs: uiTabs });
  return computeTabDropPreview({
    activePaneId: activeData.paneId,
    activeTabId: activeData.tabId,
    overPaneId: overData.paneId,
    overTabId: overData.tabId,
    targetTabs,
    activeRect: {
      left: rects.translatedRect.left,
      width: rects.translatedRect.width,
    },
    overRect: {
      left: rects.overRect.left,
      width: rects.overRect.width,
    },
  });
}

function computePaneOverDropPreview(input: {
  overData: SplitPaneDropData;
  rects: DragMoveRects;
}): SplitDropZoneHover | null {
  const { overData, rects } = input;
  const centerX = rects.translatedRect.left + rects.translatedRect.width / 2;
  const centerY = rects.translatedRect.top + rects.translatedRect.height / 2;
  const relativeX = centerX - rects.overRect.left;
  const relativeY = centerY - rects.overRect.top;
  if (
    Number.isNaN(relativeX) ||
    Number.isNaN(relativeY) ||
    relativeX < 0 ||
    relativeX > rects.overRect.width ||
    relativeY < 0 ||
    relativeY > rects.overRect.height
  ) {
    return null;
  }
  return {
    paneId: overData.paneId,
    position: resolveSplitDropPosition({
      width: rects.overRect.width,
      height: rects.overRect.height,
      x: relativeX,
      y: relativeY,
    }),
  };
}

const dropCollisionDetection: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args);
  const tabHits = pointerHits.filter(
    (entry) => entry.data?.droppableContainer.data.current?.kind === "workspace-tab",
  );
  if (tabHits.length > 0) {
    return tabHits;
  }

  const paneHits = pointerHits.filter(
    (entry) => entry.data?.droppableContainer.data.current?.kind === "split-pane-drop",
  );
  if (paneHits.length > 0) {
    return paneHits;
  }

  return closestCenter(args);
};

export function SplitContainer({
  layout,
  renderMainHeader,
  renderExplorerSidebarHeaderAction,
  workspaceKey,
  normalizedServerId,
  normalizedWorkspaceId,
  isWorkspaceFocused,
  uiTabs,
  hoveredCloseTabKey,
  setHoveredCloseTabKey,
  closingTabIds,
  onNavigateTab,
  onCloseTab,
  onCopyResumeCommand,
  onCopyAgentId,
  onCopyTerminalId,
  onCopyFilePath,
  onReloadAgent,
  onRenameTab,
  onCloseTabsToLeft,
  onCloseTabsToRight,
  onCloseOtherTabs,
  onCreateNewTab,
  buildPaneContentModel,
  onFocusPane,
  onSplitPane,
  onSplitPaneEmpty,
  onMoveTabToPane,
  onSelectTabInPane,
  onResizeSplit,
  onReorderTabsInPane,
  focusModeEnabled,
  onExitFocusMode,
}: SplitContainerProps) {
  const [activeDragTabId, setActiveDragTabId] = useState<string | null>(null);
  const [dropPreview, setDropPreview] = useState<SplitDropZoneHover | null>(null);
  const [tabDropPreview, setTabDropPreview] = useState<TabDropPreview | null>(null);
  const [maximizedPane, setMaximizedPane] = useState<{
    workspaceKey: string;
    paneId: string;
  } | null>(null);
  const maximizedPaneId =
    maximizedPane?.workspaceKey === workspaceKey ? maximizedPane.paneId : null;
  const explorerSidebarPaneId = useWorkspaceLayoutStore(
    (state) => state.explorerSidebarPaneIdByWorkspace[workspaceKey] ?? null,
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const panesById = useMemo(() => collectPanesById(layout.root), [layout.root]);
  const explorerSidebarPane = useMemo(
    () => findPaneById(layout.root, explorerSidebarPaneId),
    [layout.root, explorerSidebarPaneId],
  );
  const mainRoot = useMemo(
    () => removePaneFromSplitTree(layout.root, explorerSidebarPaneId),
    [layout.root, explorerSidebarPaneId],
  );
  const workspaceHasMultiplePanes = Boolean(mainRoot && hasMultipleVisiblePanes(mainRoot));
  useEffect(() => {
    if (
      maximizedPaneId &&
      (focusModeEnabled ||
        !workspaceHasMultiplePanes ||
        !mainRoot ||
        !splitNodeContainsPane(mainRoot, maximizedPaneId))
    ) {
      setMaximizedPane(null);
    }
  }, [focusModeEnabled, mainRoot, maximizedPaneId, workspaceHasMultiplePanes]);
  const handleTogglePaneMaximized = useCallback(
    (paneId: string) => {
      setMaximizedPane((current) =>
        current?.workspaceKey === workspaceKey && current.paneId === paneId
          ? null
          : { workspaceKey, paneId },
      );
    },
    [workspaceKey],
  );
  const handleCreateExplorerTab = useCallback(
    () => onCreateNewTab({ paneId: explorerSidebarPaneId ?? undefined }),
    [explorerSidebarPaneId, onCreateNewTab],
  );
  const handleMoveExplorerTabToMain = useCallback(
    (tabId: string) => {
      if (layout.focusedPaneId) {
        onMoveTabToPane(tabId, layout.focusedPaneId);
      }
    },
    [layout.focusedPaneId, onMoveTabToPane],
  );
  const splitRoot = useMemo(
    () =>
      resolveSplitContainerRoot({
        root: mainRoot ?? createDefaultLayout().root,
        focusedPaneId: layout.focusedPaneId,
        focusModeEnabled,
      }),
    [focusModeEnabled, layout.focusedPaneId, mainRoot],
  );
  const storedExplorerSidebarWidth = useWorkspaceLayoutStore(
    (state) => state.explorerSidebarWidthByWorkspace[workspaceKey],
  );
  const resizeExplorerSidebar = useWorkspaceLayoutStore((state) => state.resizeExplorerSidebar);
  const renderExplorerSidebarDock = Boolean(
    !focusModeEnabled && explorerSidebarPane && explorerSidebarPane.hidden !== true,
  );
  const explorerPanelRef = usePanelRef();
  const handleShellLayoutChanged = useCallback(
    (_layout: Layout, meta: LayoutChangedMeta) => {
      if (!meta.isUserInteraction) return;
      const width = explorerPanelRef.current?.getSize().inPixels;
      if (width) resizeExplorerSidebar(workspaceKey, Math.round(width));
    },
    [explorerPanelRef, resizeExplorerSidebar, workspaceKey],
  );
  const renderRoot = useMemo(() => wrapRootPaneForStableMount(splitRoot.root), [splitRoot.root]);
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = asWorkspaceTabDragData(event.active.data.current);
    if (!data) {
      setActiveDragTabId(null);
      setDropPreview(null);
      setTabDropPreview(null);
      return;
    }
    setActiveDragTabId(data.tabId);
  }, []);

  const handleDragCancel = useCallback(() => {
    setActiveDragTabId(null);
    setDropPreview(null);
    setTabDropPreview(null);
  }, []);

  const updateDropPreview = useCallback(
    (event: Pick<DragMoveEvent, "active" | "over"> | Pick<DragOverEvent, "active" | "over">) => {
      const activeData = asWorkspaceTabDragData(event.active.data.current);
      const overData = asDragOverData(event.over?.data.current);

      if (activeData?.kind !== "workspace-tab") {
        setDropPreview(null);
        setTabDropPreview(null);
        return;
      }

      const rects = resolveDragMoveRects(event);
      if (!rects) {
        setDropPreview(null);
        setTabDropPreview(null);
        return;
      }

      const activeTab = uiTabs.find((tab) => tab.tabId === activeData.tabId) ?? null;
      const destinationPaneId =
        overData?.kind === "workspace-tab" || overData?.kind === "split-pane-drop"
          ? overData.paneId
          : null;
      const destinationHost = destinationPaneId === explorerSidebarPaneId ? "explorer" : "main";
      if (
        !activeTab ||
        !panelTargetSupportsHost(normalizedServerId, activeTab.target, destinationHost)
      ) {
        setDropPreview(null);
        setTabDropPreview(null);
        return;
      }

      if (overData?.kind === "workspace-tab") {
        const preview = computeTabOverDropPreview({
          activeData,
          overData,
          rects,
          panesById,
          uiTabs,
        });
        setDropPreview(null);
        setTabDropPreview(preview);
        return;
      }

      setTabDropPreview(null);
      if (overData?.kind !== "split-pane-drop") {
        setDropPreview(null);
        return;
      }

      setDropPreview(computePaneOverDropPreview({ overData, rects }));
    },
    [normalizedServerId, panesById, explorerSidebarPaneId, uiTabs],
  );

  const applyTabDropEnd = useCallback(
    (input: { activeData: WorkspaceTabDragData; overData: WorkspaceTabDragData }): void => {
      const { activeData, overData } = input;
      const sourcePane = panesById.get(activeData.paneId) ?? null;
      const targetPane = panesById.get(overData.paneId) ?? null;
      if (!sourcePane || !targetPane) {
        return;
      }

      const sourceTabs = getWorkspacePaneDescriptors({ pane: sourcePane, tabs: uiTabs });
      const targetTabs = getWorkspacePaneDescriptors({ pane: targetPane, tabs: uiTabs });
      const sourceIndex = sourceTabs.findIndex((tab) => tab.tabId === activeData.tabId);
      const resolvedTabDropPreview =
        tabDropPreview?.paneId === overData.paneId ? tabDropPreview : null;
      if (sourceIndex < 0 || !resolvedTabDropPreview) {
        return;
      }

      if (activeData.paneId === overData.paneId) {
        if (sourceIndex !== resolvedTabDropPreview.insertionIndex) {
          const nextTabs = arrayMove(
            sourceTabs,
            sourceIndex,
            resolvedTabDropPreview.insertionIndex,
          );
          onReorderTabsInPane(
            activeData.paneId,
            nextTabs.map((tab) => tab.tabId),
          );
        }
        return;
      }

      const nextTargetTabIds = targetTabs.map((tab) => tab.tabId);
      nextTargetTabIds.splice(resolvedTabDropPreview.insertionIndex, 0, activeData.tabId);
      onMoveTabToPane(activeData.tabId, overData.paneId);
      onReorderTabsInPane(overData.paneId, nextTargetTabIds);
    },
    [onMoveTabToPane, onReorderTabsInPane, panesById, tabDropPreview, uiTabs],
  );

  const applyPaneDropEnd = useCallback(
    (input: { activeData: WorkspaceTabDragData; overData: SplitPaneDropData }): void => {
      const { activeData, overData } = input;
      if (dropPreview?.paneId !== overData.paneId) {
        return;
      }
      if (dropPreview.position === "center") {
        if (activeData.paneId !== overData.paneId) {
          onMoveTabToPane(activeData.tabId, overData.paneId);
        }
        return;
      }
      onSplitPane({
        tabId: activeData.tabId,
        targetPaneId: overData.paneId,
        position: dropPreview.position,
      });
    },
    [dropPreview, onMoveTabToPane, onSplitPane],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const activeData = asWorkspaceTabDragData(event.active.data.current);
      const overData = asDragOverData(event.over?.data.current);

      setActiveDragTabId(null);

      if (activeData?.kind === "workspace-tab" && event.over) {
        if (overData?.kind === "workspace-tab") {
          applyTabDropEnd({ activeData, overData });
        } else if (overData?.kind === "split-pane-drop") {
          applyPaneDropEnd({ activeData, overData });
        }
      }

      setDropPreview(null);
      setTabDropPreview(null);
    },
    [applyTabDropEnd, applyPaneDropEnd],
  );

  return (
    <RenderProfile id="SplitContainer">
      <DndContext
        sensors={sensors}
        collisionDetection={dropCollisionDetection}
        onDragStart={handleDragStart}
        onDragMove={updateDropPreview}
        onDragOver={updateDropPreview}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
      >
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 min-w-0 flex-1"
          onLayoutChanged={handleShellLayoutChanged}
          // The pane's scrollbar runs along the separator; a narrow target keeps them apart.
          resizeTargetMinimumSize={RESIZE_TARGET_SIZE}
        >
          <ResizablePanel
            id="workspace-main"
            minSize={MIN_WORKSPACE_BODY_WIDTH}
            className="flex min-h-0 min-w-0 flex-col"
            style={PANEL_CONTENT_STYLE}
          >
            {renderMainHeader?.()}
            {renderRoot ? (
              <SplitNodeView
                node={renderRoot}
                workspaceKey={workspaceKey}
                uiTabs={uiTabs}
                focusedPaneId={layout.focusedPaneId}
                normalizedServerId={normalizedServerId}
                normalizedWorkspaceId={normalizedWorkspaceId}
                isWorkspaceFocused={isWorkspaceFocused}
                hoveredCloseTabKey={hoveredCloseTabKey}
                setHoveredCloseTabKey={setHoveredCloseTabKey}
                closingTabIds={closingTabIds}
                onNavigateTab={onNavigateTab}
                onCloseTab={onCloseTab}
                onCopyResumeCommand={onCopyResumeCommand}
                onCopyAgentId={onCopyAgentId}
                onCopyTerminalId={onCopyTerminalId}
                onCopyFilePath={onCopyFilePath}
                onReloadAgent={onReloadAgent}
                onRenameTab={onRenameTab}
                onCloseTabsToLeft={onCloseTabsToLeft}
                onCloseTabsToRight={onCloseTabsToRight}
                onCloseOtherTabs={onCloseOtherTabs}
                onCreateNewTab={onCreateNewTab}
                buildPaneContentModel={buildPaneContentModel}
                onFocusPane={onFocusPane}
                onSplitPane={onSplitPane}
                onSplitPaneEmpty={onSplitPaneEmpty}
                onResizeSplit={onResizeSplit}
                onReorderTabsInPane={onReorderTabsInPane}
                activeDragTabId={activeDragTabId}
                showDropZones={activeDragTabId !== null}
                dropPreview={dropPreview}
                tabDropPreview={tabDropPreview}
                maximizedPaneId={maximizedPaneId}
                workspaceHasMultiplePanes={workspaceHasMultiplePanes}
                onTogglePaneMaximized={handleTogglePaneMaximized}
                focusModeEnabled={focusModeEnabled}
                onExitFocusMode={onExitFocusMode}
              />
            ) : null}
          </ResizablePanel>
          {renderExplorerSidebarDock && explorerSidebarPane ? (
            <>
              <ResizableHandle data-testid="workspace-explorer-sidebar-resize-handle" />
              <ResizablePanel
                id="workspace-explorer"
                panelRef={explorerPanelRef}
                defaultSize={storedExplorerSidebarWidth ?? DEFAULT_EXPLORER_SIDEBAR_WIDTH}
                minSize={MIN_EXPLORER_SIDEBAR_WIDTH}
                groupResizeBehavior="preserve-pixel-size"
                className="flex min-h-0 flex-col bg-sidebar"
                style={PANEL_CONTENT_STYLE}
              >
                <ExplorerSidebarDock
                  pane={explorerSidebarPane}
                  uiTabs={uiTabs}
                  normalizedServerId={normalizedServerId}
                  normalizedWorkspaceId={normalizedWorkspaceId}
                  isWorkspaceFocused={isWorkspaceFocused}
                  closingTabIds={closingTabIds}
                  onSelectTab={onSelectTabInPane}
                  onCloseTab={onCloseTab}
                  onCreateNewTab={handleCreateExplorerTab}
                  onMoveTabToMain={handleMoveExplorerTabToMain}
                  buildPaneContentModel={buildPaneContentModel}
                  onReorderTabsInPane={onReorderTabsInPane}
                  activeDragTabId={activeDragTabId}
                  tabDropPreview={tabDropPreview}
                  headerAction={renderExplorerSidebarHeaderAction?.()}
                />
              </ResizablePanel>
            </>
          ) : null}
        </ResizablePanelGroup>
        <DragOverlay dropAnimation={null}>
          {activeDragTabId ? (
            <DragOverlayTabChip
              tabId={activeDragTabId}
              uiTabs={uiTabs}
              normalizedServerId={normalizedServerId}
              normalizedWorkspaceId={normalizedWorkspaceId}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </RenderProfile>
  );
}

function DragOverlayTabChip({
  tabId,
  uiTabs,
  normalizedServerId,
  normalizedWorkspaceId,
}: {
  tabId: string;
  uiTabs: WorkspaceTab[];
  normalizedServerId: string;
  normalizedWorkspaceId: string;
}) {
  const tab = uiTabs.find((t) => t.tabId === tabId);
  const descriptor = useMemo<WorkspaceTabDescriptor | null>(
    () =>
      tab
        ? {
            key: tab.tabId,
            tabId: tab.tabId,
            kind: tab.target.kind,
            target: tab.target,
          }
        : null,
    [tab],
  );
  if (!descriptor) {
    return null;
  }
  return (
    <DragOverlayTabChipInner
      tab={descriptor}
      normalizedServerId={normalizedServerId}
      normalizedWorkspaceId={normalizedWorkspaceId}
    />
  );
}

function DragOverlayTabChipInner({
  tab,
  normalizedServerId,
  normalizedWorkspaceId,
}: {
  tab: WorkspaceTabDescriptor;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
}) {
  const { t } = useTranslation();

  return (
    <WorkspaceTabPresentationResolver
      tab={tab}
      serverId={normalizedServerId}
      workspaceId={normalizedWorkspaceId}
    >
      {(presentation) => {
        const label =
          presentation.titleState === "loading" ? t("common.states.loading") : presentation.label;

        return (
          <div className="flex max-w-[200px] items-center gap-2 rounded-md border bg-card px-3 py-1">
            <WorkspaceTabIcon presentation={presentation} active size={14} backdrop="surface1" />
            <span className="min-w-0 shrink truncate text-sm text-foreground">{label}</span>
          </div>
        );
      }}
    </WorkspaceTabPresentationResolver>
  );
}

/**
 * Flex grow per child, renormalized so the visible ones always sum to 1.
 *
 * `sizes` are fractions, so a two-pane group is `[0.5, 0.5]`. Hiding one child drops the group's
 * total grow factor to 0.5, and CSS hands children that sum to less than 1 only that fraction of
 * the free space — the other half of the row is simply left empty. Renormalizing is what makes a
 * hidden pane give its space back instead of just going invisible. The stored `sizes` are never
 * touched, so unhiding restores the width the user dragged to.
 */
function resolveVisibleGroupFlex(
  children: SplitNode[],
  sizes: number[],
  maximizedPaneId: string | null,
): number[] {
  const visibleTotal = children.reduce(
    (total, child, index) =>
      isSplitNodeHiddenForPresentation(child, maximizedPaneId)
        ? total
        : total + (sizes[index] ?? 1),
    0,
  );
  if (visibleTotal <= 0) {
    return children.map(() => 0);
  }
  return children.map((child, index) =>
    isSplitNodeHiddenForPresentation(child, maximizedPaneId)
      ? 0
      : (sizes[index] ?? 1) / visibleTotal,
  );
}

function isSplitNodeHiddenForPresentation(
  node: SplitNode,
  maximizedPaneId: string | null,
): boolean {
  return (
    isSplitNodeHidden(node) ||
    Boolean(maximizedPaneId && !splitNodeContainsPane(node, maximizedPaneId))
  );
}

function isSplitNodeHidden(node: SplitNode): boolean {
  if (node.kind === "pane") {
    return node.pane.hidden === true;
  }
  return node.group.children.every(isSplitNodeHidden);
}

function SplitNodeView({
  node,
  workspaceKey,
  uiTabs,
  focusedPaneId,
  normalizedServerId,
  normalizedWorkspaceId,
  isWorkspaceFocused,
  hoveredCloseTabKey,
  setHoveredCloseTabKey,
  closingTabIds,
  onNavigateTab,
  onCloseTab,
  onCopyResumeCommand,
  onCopyAgentId,
  onCopyTerminalId,
  onCopyFilePath,
  onReloadAgent,
  onRenameTab,
  onCloseTabsToLeft,
  onCloseTabsToRight,
  onCloseOtherTabs,
  onCreateNewTab,
  buildPaneContentModel,
  onFocusPane,
  onSplitPane,
  onSplitPaneEmpty,
  onResizeSplit,
  onReorderTabsInPane,
  activeDragTabId,
  showDropZones,
  dropPreview,
  tabDropPreview,
  maximizedPaneId,
  workspaceHasMultiplePanes,
  onTogglePaneMaximized,
  focusModeEnabled,
  onExitFocusMode,
}: SplitNodeViewProps) {
  const groupId = node.kind === "group" ? node.group.id : null;
  const groupDirection = node.kind === "group" ? node.group.direction : null;
  const storedGroupSizes = useWorkspaceLayoutStore((state) =>
    groupId ? state.splitSizesByWorkspace[workspaceKey]?.[groupId] : undefined,
  );
  const groupChildren = node.kind === "group" ? node.group.children : EMPTY_SPLIT_NODES;
  const groupSizes =
    storedGroupSizes ?? (node.kind === "group" ? node.group.sizes : EMPTY_SPLIT_SIZES);
  const visibleFlex = useMemo(
    () => resolveVisibleGroupFlex(groupChildren, groupSizes, maximizedPaneId),
    [groupChildren, groupSizes, maximizedPaneId],
  );
  const groupHandleRef = useGroupRef();
  // The group owns its layout while it is dragged; a size that changes elsewhere (a pane is
  // maximized or hidden, the store is reset) is pushed into it.
  useLayoutEffect(() => {
    const group = groupHandleRef.current;
    if (!group || groupChildren.length === 0) return;
    const target: Layout = {};
    let total = 0;
    groupChildren.forEach((child, index) => {
      const size = (visibleFlex[index] ?? 0) * 100;
      target[getNodeKey(child)] = size;
      total += size;
    });
    if (total <= 0) return;
    const current = group.getLayout();
    // A panel that just mounted registers after this runs; it starts at its defaultSize.
    const currentIds = Object.keys(current);
    if (currentIds.length !== groupChildren.length || currentIds.some((id) => !(id in target))) {
      return;
    }
    const differs = Object.entries(target).some(
      ([id, size]) => Math.abs((current[id] ?? -1) - size) > 0.5,
    );
    if (differs) group.setLayout(target);
  }, [groupChildren, groupHandleRef, visibleFlex]);
  const handleGroupLayoutChanged = useCallback(
    (layout: Layout, meta: LayoutChangedMeta) => {
      if (!groupId || !meta.isUserInteraction) return;
      // Hidden children keep their stored size, so unhiding restores the width the user dragged.
      const visibleTotal = groupChildren.reduce(
        (total, child, index) =>
          isSplitNodeHiddenForPresentation(child, maximizedPaneId)
            ? total
            : total + (groupSizes[index] ?? 1),
        0,
      );
      const next = groupChildren.map((child, index) => {
        const size = layout[getNodeKey(child)];
        if (isSplitNodeHiddenForPresentation(child, maximizedPaneId) || size === undefined) {
          return groupSizes[index] ?? 0;
        }
        return (size / 100) * visibleTotal;
      });
      onResizeSplit(groupId, next);
    },
    [groupChildren, groupId, groupSizes, maximizedPaneId, onResizeSplit],
  );

  if (node.kind === "pane") {
    return (
      <RetainedPanel
        active={node.pane.hidden !== true && (!maximizedPaneId || node.pane.id === maximizedPaneId)}
      >
        <SplitPaneView
          pane={node.pane}
          uiTabs={uiTabs}
          isFocused={node.pane.id === focusedPaneId}
          normalizedServerId={normalizedServerId}
          normalizedWorkspaceId={normalizedWorkspaceId}
          isWorkspaceFocused={isWorkspaceFocused}
          hoveredCloseTabKey={hoveredCloseTabKey}
          setHoveredCloseTabKey={setHoveredCloseTabKey}
          closingTabIds={closingTabIds}
          onNavigateTab={onNavigateTab}
          onCloseTab={onCloseTab}
          onCopyResumeCommand={onCopyResumeCommand}
          onCopyAgentId={onCopyAgentId}
          onCopyTerminalId={onCopyTerminalId}
          onCopyFilePath={onCopyFilePath}
          onReloadAgent={onReloadAgent}
          onRenameTab={onRenameTab}
          onCloseTabsToLeft={onCloseTabsToLeft}
          onCloseTabsToRight={onCloseTabsToRight}
          onCloseOtherTabs={onCloseOtherTabs}
          onCreateNewTab={onCreateNewTab}
          buildPaneContentModel={buildPaneContentModel}
          onFocusPane={onFocusPane}
          onSplitPane={onSplitPane}
          onSplitPaneEmpty={onSplitPaneEmpty}
          onReorderTabsInPane={onReorderTabsInPane}
          activeDragTabId={activeDragTabId}
          showDropZones={showDropZones}
          dropPreview={dropPreview}
          tabDropPreview={tabDropPreview}
          maximizedPaneId={maximizedPaneId}
          workspaceHasMultiplePanes={workspaceHasMultiplePanes}
          onTogglePaneMaximized={onTogglePaneMaximized}
          focusModeEnabled={focusModeEnabled}
          onExitFocusMode={onExitFocusMode}
        />
      </RetainedPanel>
    );
  }

  return (
    <ResizablePanelGroup
      orientation={groupDirection === "horizontal" ? "horizontal" : "vertical"}
      className="min-h-0 min-w-0 flex-1"
      groupRef={groupHandleRef}
      onLayoutChanged={handleGroupLayoutChanged}
    >
      {node.group.children.map((child, index) => {
        const hidden = isSplitNodeHiddenForPresentation(child, maximizedPaneId);
        const previous = index > 0 ? node.group.children[index - 1] : undefined;
        const showHandle =
          previous !== undefined &&
          !hidden &&
          !isSplitNodeHiddenForPresentation(previous, maximizedPaneId);
        return (
          <Fragment key={getNodeKey(child)}>
            {showHandle ? <ResizableHandle data-testid="workspace-split-resize-handle" /> : null}
            <ResizablePanel
              id={getNodeKey(child)}
              defaultSize={`${(visibleFlex[index] ?? 0) * 100}%`}
              className="flex min-h-0 min-w-0 flex-col"
              style={PANEL_CONTENT_STYLE}
              data-testid={hidden ? "split-group-child-hidden" : "split-group-child"}
            >
              <SplitNodeView
                node={child}
                workspaceKey={workspaceKey}
                uiTabs={uiTabs}
                focusedPaneId={focusedPaneId}
                normalizedServerId={normalizedServerId}
                normalizedWorkspaceId={normalizedWorkspaceId}
                isWorkspaceFocused={isWorkspaceFocused}
                hoveredCloseTabKey={hoveredCloseTabKey}
                setHoveredCloseTabKey={setHoveredCloseTabKey}
                closingTabIds={closingTabIds}
                onNavigateTab={onNavigateTab}
                onCloseTab={onCloseTab}
                onCopyResumeCommand={onCopyResumeCommand}
                onCopyAgentId={onCopyAgentId}
                onCopyTerminalId={onCopyTerminalId}
                onCopyFilePath={onCopyFilePath}
                onReloadAgent={onReloadAgent}
                onRenameTab={onRenameTab}
                onCloseTabsToLeft={onCloseTabsToLeft}
                onCloseTabsToRight={onCloseTabsToRight}
                onCloseOtherTabs={onCloseOtherTabs}
                onCreateNewTab={onCreateNewTab}
                buildPaneContentModel={buildPaneContentModel}
                onFocusPane={onFocusPane}
                onSplitPane={onSplitPane}
                onSplitPaneEmpty={onSplitPaneEmpty}
                onResizeSplit={onResizeSplit}
                onReorderTabsInPane={onReorderTabsInPane}
                activeDragTabId={activeDragTabId}
                showDropZones={showDropZones}
                dropPreview={dropPreview}
                tabDropPreview={tabDropPreview}
                maximizedPaneId={maximizedPaneId}
                workspaceHasMultiplePanes={workspaceHasMultiplePanes}
                onTogglePaneMaximized={onTogglePaneMaximized}
                focusModeEnabled={focusModeEnabled}
                onExitFocusMode={onExitFocusMode}
              />
            </ResizablePanel>
          </Fragment>
        );
      })}
    </ResizablePanelGroup>
  );
}

function SplitPaneView({
  pane,
  uiTabs,
  isFocused,
  normalizedServerId,
  normalizedWorkspaceId,
  isWorkspaceFocused,
  hoveredCloseTabKey,
  setHoveredCloseTabKey,
  closingTabIds,
  onNavigateTab,
  onCloseTab,
  onCopyResumeCommand,
  onCopyAgentId,
  onCopyTerminalId,
  onCopyFilePath,
  onReloadAgent,
  onRenameTab,
  onCloseTabsToLeft,
  onCloseTabsToRight,
  onCloseOtherTabs,
  onCreateNewTab,
  buildPaneContentModel,
  onFocusPane,
  onSplitPane: _onSplitPane,
  onSplitPaneEmpty,
  onReorderTabsInPane,
  activeDragTabId,
  showDropZones,
  dropPreview,
  tabDropPreview,
  maximizedPaneId,
  workspaceHasMultiplePanes,
  onTogglePaneMaximized,
  focusModeEnabled,
  onExitFocusMode,
}: SplitPaneViewProps) {
  const paneRef = useRef<HTMLDivElement | null>(null);
  const stableOnFocusPane = useStableEvent(onFocusPane);
  const paneState = useMemo(
    () =>
      deriveWorkspacePaneState({
        pane,
        tabs: uiTabs,
      }),
    [pane, uiTabs],
  );
  const paneTabs = useMemo(() => paneState.tabs.map((tab) => tab.descriptor), [paneState.tabs]);
  const activeTabDescriptor = paneState.activeTab?.descriptor ?? null;
  const desktopTabRowItems = useMemo<WorkspaceDesktopTabRowItem[]>(
    () =>
      paneTabs.map((tab) => ({
        tab,
        isActive: tab.key === activeTabDescriptor?.key,
        isCloseHovered: hoveredCloseTabKey === tab.key,
        isClosingTab: closingTabIds.has(tab.tabId),
      })),
    [activeTabDescriptor?.key, closingTabIds, hoveredCloseTabKey, paneTabs],
  );

  useEffect(() => {
    const rawRef: unknown = paneRef.current;
    if (!(rawRef instanceof HTMLElement)) {
      return () => {};
    }
    const paneElement = rawRef;

    const handlePanePointerDown = (event: PointerEvent) => {
      if (!shouldFocusPaneFromEventTarget(event.target)) {
        return;
      }
      stableOnFocusPane(pane.id);
    };

    const handlePaneFocusIn = (event: FocusEvent) => {
      if (!shouldFocusPaneFromEventTarget(event.target)) {
        return;
      }
      stableOnFocusPane(pane.id);
    };

    paneElement.addEventListener("pointerdown", handlePanePointerDown, true);
    paneElement.addEventListener("focusin", handlePaneFocusIn, true);

    return () => {
      paneElement.removeEventListener("pointerdown", handlePanePointerDown, true);
      paneElement.removeEventListener("focusin", handlePaneFocusIn, true);
    };
  }, [stableOnFocusPane, pane.id]);

  const paneId = pane.id;
  const handleCloseTabsToLeft = useCallback(
    (tabId: string) => onCloseTabsToLeft(tabId, paneTabs),
    [onCloseTabsToLeft, paneTabs],
  );
  const handleCloseTabsToRight = useCallback(
    (tabId: string) => onCloseTabsToRight(tabId, paneTabs),
    [onCloseTabsToRight, paneTabs],
  );
  const handleCloseOtherTabs = useCallback(
    (tabId: string) => onCloseOtherTabs(tabId, paneTabs),
    [onCloseOtherTabs, paneTabs],
  );
  const handleReorderTabs = useCallback(
    (nextTabs: WorkspaceTabDescriptor[]) => {
      onReorderTabsInPane(
        paneId,
        nextTabs.map((tab) => tab.tabId),
      );
    },
    [onReorderTabsInPane, paneId],
  );
  const handleSplitRight = useCallback(
    () => onSplitPaneEmpty({ targetPaneId: paneId, position: "right" }),
    [onSplitPaneEmpty, paneId],
  );
  const handleSplitDown = useCallback(
    () => onSplitPaneEmpty({ targetPaneId: paneId, position: "bottom" }),
    [onSplitPaneEmpty, paneId],
  );
  const handleTogglePaneMaximized = useCallback(
    () => onTogglePaneMaximized(paneId),
    [onTogglePaneMaximized, paneId],
  );
  return (
    <RenderProfile id={`SplitPaneView:${pane.id}`}>
      <div
        ref={paneRef}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
        data-testid={`workspace-pane-${pane.id}`}
      >
        <div className="relative min-w-0">
          <WorkspaceDesktopTabsRow
            paneId={pane.id}
            isFocused={isFocused && isWorkspaceFocused}
            tabs={desktopTabRowItems}
            normalizedServerId={normalizedServerId}
            normalizedWorkspaceId={normalizedWorkspaceId}
            setHoveredCloseTabKey={setHoveredCloseTabKey}
            onNavigateTab={onNavigateTab}
            onCloseTab={onCloseTab}
            onCopyResumeCommand={onCopyResumeCommand}
            onCopyAgentId={onCopyAgentId}
            onCopyTerminalId={onCopyTerminalId}
            onCopyFilePath={onCopyFilePath}
            onReloadAgent={onReloadAgent}
            onRenameTab={onRenameTab}
            onCloseTabsToLeft={handleCloseTabsToLeft}
            onCloseTabsToRight={handleCloseTabsToRight}
            onCloseOtherTabs={handleCloseOtherTabs}
            onCreateNewTab={onCreateNewTab}
            onReorderTabs={handleReorderTabs}
            externalDndContext
            activeDragTabId={activeDragTabId}
            tabDropPreviewIndex={
              tabDropPreview?.paneId === pane.id ? tabDropPreview.indicatorIndex : null
            }
            showPaneSplitActions={!focusModeEnabled}
            showPaneMaximizeAction={workspaceHasMultiplePanes && !focusModeEnabled}
            paneMaximized={paneId === maximizedPaneId}
            onTogglePaneMaximized={handleTogglePaneMaximized}
            onSplitRight={handleSplitRight}
            onSplitDown={handleSplitDown}
            focusModeEnabled={Boolean(focusModeEnabled)}
            onExitFocusMode={onExitFocusMode}
          />
        </div>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <WorkspacePanelHost
            paneId={pane.id}
            tabs={paneTabs}
            activeTabId={activeTabDescriptor?.tabId ?? null}
            normalizedServerId={normalizedServerId}
            normalizedWorkspaceId={normalizedWorkspaceId}
            isWorkspaceFocused={isWorkspaceFocused}
            isPaneFocused={isFocused}
            onFocusPane={stableOnFocusPane}
            buildPaneContentModel={buildPaneContentModel}
          />
          <SplitDropZone paneId={pane.id} active={showDropZones} preview={dropPreview} />
        </div>
      </div>
    </RenderProfile>
  );
}

function collectPanesById(node: SplitNode): Map<string, SplitPane> {
  const next = new Map<string, SplitPane>();
  function visit(current: SplitNode) {
    if (current.kind === "pane") {
      next.set(current.pane.id, current.pane);
      return;
    }
    for (const child of current.group.children) {
      visit(child);
    }
  }
  visit(node);
  return next;
}

function getNodeKey(node: SplitNode): string {
  if (node.kind === "pane") {
    return node.pane.id;
  }
  return node.group.id;
}

function wrapRootPaneForStableMount(node: SplitNode): SplitNode {
  if (node.kind === "group") {
    return node;
  }

  return {
    kind: "group",
    group: {
      id: `root:${node.pane.id}`,
      direction: "horizontal",
      children: [node],
      sizes: [1],
    },
  };
}

function removePaneFromSplitTree(node: SplitNode, paneId: string | null): SplitNode | null {
  if (!paneId) {
    return node;
  }
  if (node.kind === "pane") {
    return node.pane.id === paneId ? null : node;
  }

  const children = node.group.children.flatMap((child) => {
    const nextChild = removePaneFromSplitTree(child, paneId);
    return nextChild ? [nextChild] : [];
  });
  if (children.length === 0) {
    return null;
  }
  if (children.length === 1) {
    return children[0] ?? null;
  }
  return {
    kind: "group",
    group: {
      ...node.group,
      children,
      sizes: children.map(() => 1 / children.length),
    },
  };
}
