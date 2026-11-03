// Port of archive/expo-app:packages/app/src/screens/workspace/explorer-sidebar-tab-rail.tsx: the explorer pane's
// line tabs (Files, Changes, ...), draggable in the split container's drag context, with a
// right-click menu per tab and one on the rail for adding or removing tabs.
import { useCallback, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { ArrowLeftToLine, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  DraggableListDragHandleProps,
  DraggableRenderItemInfo,
} from "@/components/draggable-list.types";
import { SortableInlineList } from "@/components/sortable-inline-list";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  HorizontalScrollBoundaryShades,
  useHorizontalScrollBoundary,
} from "@/components/ui/horizontal-scroll-boundary";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import type { PanelIconProps } from "@/panels/panel-registry";
import { panelTargetSupportsHost } from "@/plugins/workspace-panels/locations";
import type { WorkspaceDesktopTabRowItem } from "@/screens/workspace/workspace-desktop-tabs-row";
import {
  WorkspaceTabIcon,
  WorkspaceTabPresentationResolver,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { workspaceTabTargetsEqual } from "@/workspace-tabs/identity";
import {
  useWorkspaceTabLaunchCatalog,
  type WorkspaceTabLaunchItem,
} from "@/workspace-tabs/launcher";
import { cn } from "cn";

interface ExplorerSidebarTabRailProps {
  paneId: string;
  tabs: WorkspaceDesktopTabRowItem[];
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  activeDragTabId: string | null;
  tabDropPreviewIndex: number | null;
  onNavigateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  onCreateNewTab: () => void;
  onMoveTabToMain: (tabId: string) => void;
  onReorderTabs: (tabs: WorkspaceTabDescriptor[]) => void;
  trailingAccessory?: ReactNode;
}

const MOVE_TO_MAIN_ICON = <ArrowLeftToLine />;
const CLOSE_ICON = <X />;
const NEW_TAB_ICON = <Plus />;

function tabKey(item: WorkspaceDesktopTabRowItem): string {
  return `${item.tab.key}:${item.tab.kind}`;
}

function ExplorerSidebarTab({
  item,
  isDragging,
  dragHandleProps,
  onNavigateTab,
  onCloseTab,
  onMoveTabToMain,
  normalizedServerId,
  normalizedWorkspaceId,
}: {
  item: WorkspaceDesktopTabRowItem;
  isDragging: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
  onNavigateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  onMoveTabToMain: (tabId: string) => void;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const tabId = item.tab.tabId;
  const handlePress = useCallback(() => onNavigateTab(tabId), [onNavigateTab, tabId]);
  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);
  const handleClose = useCallback(() => void onCloseTab(tabId), [onCloseTab, tabId]);
  const handleMoveToMain = useCallback(() => onMoveTabToMain(tabId), [onMoveTabToMain, tabId]);
  const canMoveToMain = panelTargetSupportsHost(normalizedServerId, item.tab.target, "main");
  const renderPresentation = useCallback(
    (presentation: WorkspaceTabPresentation) => (
      <ContextMenu>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <ContextMenuTrigger
              {...(dragHandleProps?.attributes as object | undefined)}
              {...(dragHandleProps?.listeners as object | undefined)}
              triggerRef={dragHandleProps?.setActivatorNodeRef as never}
              testID={`explorer-sidebar-tab-${tabId}`}
              accessibilityRole="button"
              accessibilityLabel={presentation.tooltip}
              aria-selected={item.isActive}
              onPress={handlePress}
              onPointerEnter={handleHoverIn}
              onPointerLeave={handleHoverOut}
              className={cn(
                "flex h-9 max-w-[180px] items-center gap-1.5 border-b-2 border-transparent px-2 pt-0.5 select-none",
                item.isActive && "border-foreground",
                isDragging && "opacity-30",
              )}
            >
              <WorkspaceTabIcon
                presentation={presentation}
                active={item.isActive}
                size={14}
                strokeWidth={1.5}
                backdrop="surfaceSidebar"
              />
              <span
                className={cn(
                  "min-w-0 shrink truncate text-sm font-medium",
                  item.isActive || hovered ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {presentation.label}
              </span>
            </ContextMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{presentation.tooltip}</TooltipContent>
        </Tooltip>
        <ContextMenuContent align="start" minWidth={180}>
          {canMoveToMain ? (
            <ContextMenuItem leading={MOVE_TO_MAIN_ICON} onSelect={handleMoveToMain}>
              {t("workspace.tabs.menu.moveToMain")}
            </ContextMenuItem>
          ) : null}
          {canMoveToMain ? <ContextMenuSeparator /> : null}
          <ContextMenuItem leading={CLOSE_ICON} onSelect={handleClose}>
            {t("workspace.tabs.menu.close")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    ),
    [
      canMoveToMain,
      dragHandleProps,
      handleClose,
      handleHoverIn,
      handleHoverOut,
      handleMoveToMain,
      handlePress,
      hovered,
      isDragging,
      item.isActive,
      t,
      tabId,
    ],
  );
  return (
    <WorkspaceTabPresentationResolver
      tab={item.tab}
      serverId={normalizedServerId}
      workspaceId={normalizedWorkspaceId}
    >
      {renderPresentation}
    </WorkspaceTabPresentationResolver>
  );
}

function ExplorerSidebarConfigurationItem({
  item,
  paneId,
  tab,
  onCloseTab,
}: {
  item: WorkspaceTabLaunchItem;
  paneId: string;
  tab: WorkspaceTabDescriptor | null;
  onCloseTab: (tabId: string) => Promise<void> | void;
}) {
  const Icon = item.Icon as ComponentType<PanelIconProps> | undefined;
  const leading = useMemo(() => (Icon ? <Icon size={14} color="currentColor" /> : null), [Icon]);
  const handleSelect = useCallback(() => {
    if (tab) {
      void onCloseTab(tab.tabId);
      return;
    }
    item.launch({ kind: "open", paneId });
  }, [item, onCloseTab, paneId, tab]);
  return (
    <ContextMenuItem
      leading={leading}
      selected={Boolean(tab)}
      showSelectedCheck
      disabled={!tab && item.disabled}
      onSelect={handleSelect}
    >
      {item.label}
    </ContextMenuItem>
  );
}

function catalogItemMatchesTab(item: WorkspaceTabLaunchItem, tab: WorkspaceTabDescriptor): boolean {
  return item.toggleTarget !== null && workspaceTabTargetsEqual(item.toggleTarget, tab.target);
}

export function ExplorerSidebarTabRail({
  paneId,
  tabs,
  normalizedServerId,
  normalizedWorkspaceId,
  activeDragTabId,
  tabDropPreviewIndex,
  onNavigateTab,
  onCloseTab,
  onCreateNewTab,
  onMoveTabToMain,
  onReorderTabs,
  trailingAccessory,
}: ExplorerSidebarTabRailProps) {
  const { t } = useTranslation();
  const scrollBoundary = useHorizontalScrollBoundary();
  const groups = useWorkspaceTabLaunchCatalog({
    serverId: normalizedServerId,
    purpose: "supporting",
    host: "explorer",
  });
  const singletonConfigurationItems = groups
    .flatMap((group) => group.items)
    .filter((item) => item.toggleTarget !== null);
  const handleDragEnd = useCallback(
    (nextTabs: WorkspaceDesktopTabRowItem[]) => onReorderTabs(nextTabs.map((item) => item.tab)),
    [onReorderTabs],
  );
  const getTabDragData = useCallback(
    (item: WorkspaceDesktopTabRowItem) => ({
      kind: "workspace-tab" as const,
      paneId,
      tabId: item.tab.tabId,
    }),
    [paneId],
  );
  const renderTab = useCallback(
    ({
      item,
      index,
      dragHandleProps,
      isActive,
    }: DraggableRenderItemInfo<WorkspaceDesktopTabRowItem>) => {
      const showBefore = activeDragTabId !== null && tabDropPreviewIndex === index;
      const showAfter =
        activeDragTabId !== null &&
        tabDropPreviewIndex === tabs.length &&
        index === tabs.length - 1;
      const indicator =
        "pointer-events-none absolute top-0.5 bottom-0.5 z-10 w-1 rounded-full bg-primary";
      return (
        <div className="relative mx-0.5">
          {showBefore ? <div className={cn(indicator, "-left-1")} /> : null}
          <ExplorerSidebarTab
            item={item}
            isDragging={isActive}
            dragHandleProps={dragHandleProps}
            onNavigateTab={onNavigateTab}
            onCloseTab={onCloseTab}
            onMoveTabToMain={onMoveTabToMain}
            normalizedServerId={normalizedServerId}
            normalizedWorkspaceId={normalizedWorkspaceId}
          />
          {showAfter ? <div className={cn(indicator, "-right-1")} /> : null}
        </div>
      );
    },
    [
      activeDragTabId,
      normalizedServerId,
      normalizedWorkspaceId,
      onCloseTab,
      onMoveTabToMain,
      onNavigateTab,
      tabDropPreviewIndex,
      tabs.length,
    ],
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger
        contextOnly
        className="flex h-9 min-w-0 items-center bg-sidebar"
        testID="explorer-sidebar-tab-rail"
      >
        <div className="relative flex min-w-0 flex-1 self-stretch">
          <div
            ref={scrollBoundary.ref}
            onScroll={scrollBoundary.onScroll}
            className="flex min-w-0 flex-1 items-center overflow-x-auto pr-2 pl-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <SortableInlineList
              data={tabs}
              keyExtractor={tabKey}
              renderItem={renderTab}
              onDragEnd={handleDragEnd}
              useDragHandle
              externalDndContext
              activeId={activeDragTabId}
              getItemData={getTabDragData}
            />
          </div>
          <HorizontalScrollBoundaryShades
            visible
            backdrop="sidebar"
            testIDPrefix="explorer-sidebar-tabs-scroll-shade"
            showLeft={scrollBoundary.showLeft}
            showRight={scrollBoundary.showRight}
          />
        </div>
        {trailingAccessory ? <div className="mr-3">{trailingAccessory}</div> : null}
      </ContextMenuTrigger>
      <ContextMenuContent align="start" minWidth={200} testID="explorer-sidebar-tab-configuration">
        <ContextMenuItem leading={NEW_TAB_ICON} onSelect={onCreateNewTab}>
          {t("workspace.tabs.actions.newTab")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        {singletonConfigurationItems.map((item) => (
          <ExplorerSidebarConfigurationItem
            key={item.id}
            item={item}
            paneId={paneId}
            tab={tabs.find(({ tab }) => catalogItemMatchesTab(item, tab))?.tab ?? null}
            onCloseTab={onCloseTab}
          />
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
