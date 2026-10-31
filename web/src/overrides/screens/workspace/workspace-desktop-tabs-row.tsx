// Override of packages/app/src/screens/workspace/workspace-desktop-tabs-row.tsx. Same behaviour:
// label widths are measured and fed to the shared tab layout (widths, labels, close buttons,
// scroll fallback), tabs reorder by dragging (inside the split container's drag context when
// there is one), each tab has a tooltip, a right-click menu, a close button and middle-click
// close. The view is DOM and shadcn.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Columns2,
  Copy,
  CopyX,
  Ellipsis,
  Maximize,
  Minimize,
  Pencil,
  Plus,
  RotateCw,
  Rows2,
  X,
} from "lucide-react";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  HorizontalScrollBoundaryShades,
  useHorizontalScrollBoundary,
} from "@/components/ui/horizontal-scroll-boundary";
import { smallIconButtonChromeFrameSize } from "@/components/ui/icon-button-chrome";
import { ToolbarButton, ToolbarControls } from "@/components/ui/pane-content-toolbar";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useCompactTimeAgo } from "@/hooks/use-compact-time-ago";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { buildWorkspaceKeyboardHandlerId } from "@/keyboard/handler-id";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import { useWorkspaceTabLayout } from "@/screens/workspace/use-workspace-tab-layout";
import {
  buildWorkspaceDesktopTabActions,
  type WorkspaceDesktopTabActions,
  type WorkspaceTabMenuEntry,
  type WorkspaceTabMenuLabels,
} from "@/screens/workspace/workspace-tab-menu";
import { WorkspaceNewTabMenuContent } from "@/screens/workspace/workspace-new-tab-menu";
import {
  WorkspaceTabIcon,
  WorkspaceTabPresentationResolver,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { useSessionStore } from "@/stores/session-store";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { RenderProfile } from "@/utils/render-profiler";
import { buildDeterministicWorkspaceTabId } from "@/workspace-tabs/identity";
import { cn } from "cn";

const DROPDOWN_WIDTH = 220;
const DEFAULT_INLINE_ADD_BUTTON_RESERVED_WIDTH = 36;
const PANE_SPLIT_ACTIONS_HORIZONTAL_PADDING = 2;
const PANE_SPLIT_ACTIONS_OUTER_MARGIN = 6;
const PANE_SPLIT_ACTIONS_RESERVED_WIDTH =
  smallIconButtonChromeFrameSize(false) +
  PANE_SPLIT_ACTIONS_HORIZONTAL_PADDING * 2 +
  PANE_SPLIT_ACTIONS_OUTER_MARGIN;
const PANE_MAXIMIZE_ACTION_RESERVED_WIDTH = smallIconButtonChromeFrameSize(false) + 1;
const TAB_CHIP_HORIZONTAL_PADDING = 10;
const TAB_CHIP_GAP = 4;
const TAB_ROW_PADDING_HORIZONTAL = 6;
const TAB_ICON_WIDTH = 14;
const TAB_CONTENT_GAP = 6;
const TAB_MODIFIED_DOT_SIZE = 8;
const TAB_MIN_WIDTH = 96;
const TAB_MAX_WIDTH = 240;
// The close button sits in the tab's own right padding, so it never covers the label.
const TAB_CLOSE_BUTTON_RESERVED_WIDTH = 20;
const TAB_LABEL_LAYOUT_ALLOWANCE = 4;
const AGENT_TOOLTIP_TITLE_MAX_LENGTH = 80;

const SPLIT_RIGHT_ICON = <Columns2 />;
const SPLIT_DOWN_ICON = <Rows2 />;
const TAB_SCROLL_PADDING_STYLE = {
  paddingLeft: TAB_ROW_PADDING_HORIZONTAL,
  paddingRight: TAB_ROW_PADDING_HORIZONTAL,
};

function normalizeAgentTooltipTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}

function formatAgentTooltipTitle(singleLineTitle: string): string {
  if (singleLineTitle.length <= AGENT_TOOLTIP_TITLE_MAX_LENGTH) return singleLineTitle;
  return `${singleLineTitle.slice(0, AGENT_TOOLTIP_TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}

function formatAgentTooltipActivity(compactActivity: string): string {
  if (compactActivity === "now") return "just now";
  if (/^\d/.test(compactActivity)) return `${compactActivity} ago`;
  return compactActivity;
}

function AgentTabTooltipBody({
  serverId,
  agentId,
  title,
}: {
  serverId: string;
  agentId: string;
  title: string;
}) {
  const lastActivityAt = useSessionStore((state) => {
    const session = state.sessions[serverId];
    const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId) ?? null;
    return state.agentLastActivity.get(agentId) ?? agent?.lastActivityAt ?? null;
  });
  const activity = formatAgentTooltipActivity(useCompactTimeAgo(lastActivityAt));
  return (
    <span className="flex max-w-[420px] flex-col gap-0.5">
      <span className="truncate">{title}</span>
      <span className="flex items-center gap-1 opacity-70">
        <span>{agentId.slice(0, 7)}</span>
        {activity ? (
          <>
            <span>·</span>
            <span>{activity}</span>
          </>
        ) : null}
      </span>
    </span>
  );
}

function WorkspaceNewTabButton({
  serverId,
  paneId,
  shortcutKeys,
  placement,
}: {
  serverId: string;
  paneId?: string;
  shortcutKeys: ShortcutKey[][] | null;
  placement: "inline" | "toolbar";
}) {
  const { t } = useTranslation();
  const menu = (
    <DropdownMenu>
      <ToolbarButton
        kind="menu"
        label={t("workspace.tabs.actions.newTab")}
        shortcut={shortcutKeys}
        testID="workspace-new-tab-button"
        className={placement === "inline" ? "size-6" : undefined}
      >
        <Plus size={14} />
      </ToolbarButton>
      <WorkspaceNewTabMenuContent
        serverId={serverId}
        purpose="primary"
        host="main"
        paneId={paneId}
      />
    </DropdownMenu>
  );
  return placement === "inline" ? <div className="flex items-center px-1">{menu}</div> : menu;
}

function WorkspacePaneToolbarActions({
  showNewTabButton,
  showSplitActions,
  showMaximizeAction,
  paneMaximized,
  serverId,
  paneId,
  newTabShortcutKeys,
  onSplitRight,
  onSplitDown,
  onTogglePaneMaximized,
}: {
  showNewTabButton: boolean;
  showSplitActions: boolean;
  showMaximizeAction: boolean;
  paneMaximized: boolean;
  serverId: string;
  paneId?: string;
  newTabShortcutKeys: ShortcutKey[][] | null;
  onSplitRight?: () => void;
  onSplitDown?: () => void;
  onTogglePaneMaximized?: () => void;
}) {
  const { t } = useTranslation();
  const splitRightKeys = useShortcutKeys("workspace-pane-split-right");
  const splitDownKeys = useShortcutKeys("workspace-pane-split-down");
  const splitRightTrailing = useMemo(
    () => (splitRightKeys ? <Shortcut chord={splitRightKeys} /> : null),
    [splitRightKeys],
  );
  const splitDownTrailing = useMemo(
    () => (splitDownKeys ? <Shortcut chord={splitDownKeys} /> : null),
    [splitDownKeys],
  );
  const splitActionsVisible = showSplitActions && Boolean(onSplitRight && onSplitDown);
  const maximizeActionVisible = showMaximizeAction && Boolean(onTogglePaneMaximized);
  if (!showNewTabButton && !splitActionsVisible && !maximizeActionVisible) return null;
  return (
    <ToolbarControls className="mr-1.5 px-0.5">
      {showNewTabButton ? (
        <WorkspaceNewTabButton
          placement="toolbar"
          serverId={serverId}
          paneId={paneId}
          shortcutKeys={newTabShortcutKeys}
        />
      ) : null}
      {maximizeActionVisible && onTogglePaneMaximized ? (
        <ToolbarButton
          label={t(
            paneMaximized
              ? "workspace.tabs.actions.restorePane"
              : "workspace.tabs.actions.maximizePane",
          )}
          selected={paneMaximized}
          testID={paneMaximized ? "workspace-restore-pane" : "workspace-maximize-pane"}
          onPress={onTogglePaneMaximized}
        >
          {paneMaximized ? <Minimize size={14} /> : <Maximize size={14} />}
        </ToolbarButton>
      ) : null}
      {splitActionsVisible && onSplitRight && onSplitDown ? (
        <DropdownMenu>
          <ToolbarButton
            kind="menu"
            label={t("workspace.git.actions.moreActions")}
            testID="workspace-split-pane-menu"
          >
            <Ellipsis size={14} />
          </ToolbarButton>
          <DropdownMenuContent
            side="bottom"
            align="end"
            offset={4}
            width={220}
            testID="workspace-split-pane-menu-content"
          >
            <DropdownMenuItem
              leading={SPLIT_RIGHT_ICON}
              trailing={splitRightTrailing}
              testID="workspace-split-pane-right"
              onSelect={onSplitRight}
            >
              {t("workspace.tabs.actions.splitRight")}
            </DropdownMenuItem>
            <DropdownMenuItem
              leading={SPLIT_DOWN_ICON}
              trailing={splitDownTrailing}
              testID="workspace-split-pane-down"
              onSelect={onSplitDown}
            >
              {t("workspace.tabs.actions.splitDown")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </ToolbarControls>
  );
}

function WorkspaceExitFocusModeButton({
  visible,
  onPress,
  slotRef,
}: {
  visible: boolean;
  onPress: () => void;
  slotRef: (node: HTMLDivElement | null) => void;
}) {
  const { t } = useTranslation();
  const focusModeKeys = useShortcutKeys("toggle-focus");
  if (!visible) return null;
  return (
    <div ref={slotRef} className="flex items-center self-stretch border-r px-0.5">
      <ToolbarButton
        label={t("workspace.tabs.actions.exitFocusMode")}
        shortcut={focusModeKeys}
        testID="workspace-exit-focus-mode"
        onPress={onPress}
      >
        <X size={14} />
      </ToolbarButton>
    </div>
  );
}

const MENU_ICONS = {
  copy: Copy,
  "rotate-cw": RotateCw,
  "arrow-left-to-line": ArrowLeftToLine,
  "arrow-right-to-line": ArrowRightToLine,
  "copy-x": CopyX,
  pencil: Pencil,
  x: X,
} as const;

function TabContextMenuItem({
  entry,
}: {
  entry: Extract<WorkspaceTabMenuEntry, { kind: "item" }>;
}) {
  const Icon = entry.icon ? MENU_ICONS[entry.icon as keyof typeof MENU_ICONS] : undefined;
  const leading = useMemo(() => (Icon ? <Icon /> : undefined), [Icon]);
  const trailing = useMemo(
    () => (entry.hint ? <span>{entry.hint}</span> : undefined),
    [entry.hint],
  );
  return (
    <ContextMenuItem
      testID={entry.testID}
      disabled={entry.disabled}
      destructive={entry.destructive}
      onSelect={entry.onSelect}
      tooltip={entry.tooltip}
      leading={leading}
      trailing={trailing}
    >
      {entry.label}
    </ContextMenuItem>
  );
}

function tabKeyExtractor(tab: WorkspaceDesktopTabRowItem) {
  return `${tab.tab.key}:${tab.tab.kind}`;
}

export interface WorkspaceDesktopTabRowItem {
  tab: WorkspaceTabDescriptor;
  isActive: boolean;
  isCloseHovered: boolean;
  isClosingTab: boolean;
}

interface ResolvedWorkspaceDesktopTabRowItem extends WorkspaceDesktopTabRowItem {
  presentation: WorkspaceTabPresentation;
}

interface WorkspaceTabLabel {
  key: string;
  label: string;
  modified: boolean;
}

interface WorkspaceTabTrackSnapshot {
  signature: string;
  tabs: ResolvedWorkspaceDesktopTabRowItem[];
  labels: WorkspaceTabLabel[];
  labelWidths: number[];
}

function completeWorkspaceTabLabelWidths(
  labels: WorkspaceTabLabel[],
  measurements: Map<string, { label: string; width: number }>,
): number[] | null {
  const widths: number[] = [];
  for (const { key, label, modified } of labels) {
    const measurement = measurements.get(key);
    if (!measurement || measurement.label !== label || measurement.width <= 0) return null;
    // The modified dot sits in the content row, so a modified tab needs that much more width.
    const modifiedAllowance = modified ? TAB_CONTENT_GAP + TAB_MODIFIED_DOT_SIZE : 0;
    widths.push(measurement.width + TAB_LABEL_LAYOUT_ALLOWANCE + modifiedAllowance);
  }
  return widths;
}

function sameWidths(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((width, index) => width === right[index]);
}

interface WorkspaceDesktopTabsRowProps {
  paneId?: string;
  isFocused?: boolean;
  tabs: WorkspaceDesktopTabRowItem[];
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  setHoveredCloseTabKey: Dispatch<SetStateAction<string | null>>;
  onNavigateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  onCopyResumeCommand: (agentId: string) => Promise<void> | void;
  onCopyAgentId: (agentId: string) => Promise<void> | void;
  onCopyTerminalId: (terminalId: string) => Promise<void> | void;
  onCopyFilePath: (path: string) => Promise<void> | void;
  onReloadAgent: (agentId: string) => Promise<void> | void;
  onRenameTab: (tab: WorkspaceTabDescriptor) => void;
  onCloseTabsToLeft: (tabId: string) => Promise<void> | void;
  onCloseTabsToRight: (tabId: string) => Promise<void> | void;
  onCloseOtherTabs: (tabId: string) => Promise<void> | void;
  onCreateNewTab: (input: { paneId?: string }) => void;
  onReorderTabs: (nextTabs: WorkspaceTabDescriptor[]) => void;
  externalDndContext?: boolean;
  activeDragTabId?: string | null;
  tabDropPreviewIndex?: number | null;
  showPaneSplitActions?: boolean;
  showPaneMaximizeAction?: boolean;
  paneMaximized?: boolean;
  onTogglePaneMaximized?: () => void;
  onSplitRight?: () => void;
  onSplitDown?: () => void;
  focusModeEnabled: boolean;
  onExitFocusMode: () => void;
}

function WorkspaceDesktopTabPresentationSlot({
  tab,
  serverId,
  workspaceId,
  onResolve,
}: {
  tab: WorkspaceTabDescriptor;
  serverId: string;
  workspaceId: string;
  onResolve: (tabKey: string, presentation: WorkspaceTabPresentation) => void;
}) {
  return (
    <WorkspaceTabPresentationResolver tab={tab} serverId={serverId} workspaceId={workspaceId}>
      {(presentation) => (
        <WorkspaceDesktopTabPresentationCommit
          tabKey={tab.key}
          presentation={presentation}
          onResolve={onResolve}
        />
      )}
    </WorkspaceTabPresentationResolver>
  );
}

function WorkspaceDesktopTabPresentationCommit({
  tabKey,
  presentation,
  onResolve,
}: {
  tabKey: string;
  presentation: WorkspaceTabPresentation;
  onResolve: (tabKey: string, presentation: WorkspaceTabPresentation) => void;
}) {
  useLayoutEffect(() => {
    onResolve(tabKey, presentation);
  }, [onResolve, presentation, tabKey]);
  return null;
}

function getFallbackTabLabel(
  tab: WorkspaceTabDescriptor,
  labels: Record<
    "newTab" | "newAgent" | "setup" | "terminal" | "agent" | "changes" | "files" | "pullRequest",
    string
  >,
): string {
  switch (tab.target.kind) {
    case "new_tab":
      return labels.newTab;
    case "draft":
      return labels.newAgent;
    case "setup":
      return labels.setup;
    case "terminal":
      return labels.terminal;
    case "file":
      return tab.target.path.split("/").findLast(Boolean) ?? tab.target.path;
    case "working_diff":
    case "changes_tree":
      return labels.changes;
    case "files":
      return labels.files;
    case "pull_request":
      return labels.pullRequest;
    default:
      return labels.agent;
  }
}

function TabChipLabel({
  presentation,
  showLabel,
  isHighlighted,
  testIdentity,
}: {
  presentation: WorkspaceTabPresentation;
  showLabel: boolean;
  isHighlighted: boolean;
  testIdentity: string;
}) {
  const { t } = useTranslation();
  const loading = presentation.titleState === "loading";
  return (
    <span
      className="flex min-w-0 flex-1 items-center gap-1.5"
      data-status-bucket={presentation.statusBucket ?? "none"}
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center">
        <WorkspaceTabIcon presentation={presentation} active={isHighlighted} backdrop="surface0" />
      </span>
      {showLabel && loading ? (
        <span className="h-2.5 w-24 max-w-full min-w-0 shrink rounded-full bg-muted" />
      ) : null}
      {showLabel && !loading ? (
        <span
          className={cn(
            "min-w-0 shrink truncate text-sm font-medium",
            isHighlighted ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {presentation.label}
        </span>
      ) : null}
      {/* A laid-out sibling of the label, so a truncated label ends before it. */}
      {presentation.modified ? (
        <span
          className="size-2 shrink-0 rounded-full bg-muted-foreground"
          aria-label={t("workspace.tabs.modified")}
          data-testid={`workspace-tab-modified-${testIdentity}`}
        />
      ) : null}
    </span>
  );
}

const CLOSE_SLOT_STYLE = { right: TAB_CHIP_HORIZONTAL_PADDING - 2 };

function stopEvent(event: ReactPointerEvent | ReactMouseEvent) {
  event.stopPropagation();
}

/** The close button in the tab's reserved right padding; it never moves or covers the label. */
function TabCloseButton({
  tabKey,
  visible,
  isClosingTab,
  testId,
  onClose,
  setHoveredCloseTabKey,
}: {
  tabKey: string;
  visible: boolean;
  isClosingTab: boolean;
  testId: string;
  onClose: () => void;
  setHoveredCloseTabKey: Dispatch<SetStateAction<string | null>>;
}) {
  const { t } = useTranslation();
  const handleEnter = useCallback(
    () => setHoveredCloseTabKey(tabKey),
    [setHoveredCloseTabKey, tabKey],
  );
  const handleLeave = useCallback(
    () => setHoveredCloseTabKey((current) => (current === tabKey ? null : current)),
    [setHoveredCloseTabKey, tabKey],
  );
  const handleClick = useCallback(
    (event: ReactMouseEvent) => {
      event.stopPropagation();
      onClose();
    },
    [onClose],
  );
  return (
    <div
      className={cn(
        "absolute top-0 bottom-0.5 z-[2] flex w-[18px] items-center justify-center",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      style={CLOSE_SLOT_STYLE}
    >
      <button
        type="button"
        data-testid={testId}
        disabled={isClosingTab}
        aria-label={t("workspace.tabs.menu.close")}
        onPointerDown={stopEvent}
        onMouseDown={stopEvent}
        onPointerEnter={handleEnter}
        onPointerLeave={handleLeave}
        onClick={handleClick}
        className="flex size-[18px] items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {isClosingTab ? (
          <span className="size-3 animate-spin rounded-full border border-current border-t-transparent" />
        ) : (
          <X size={12} />
        )}
      </button>
    </div>
  );
}

function TabChip({
  serverId,
  tab,
  isActive,
  isDragging,
  isFocused,
  resolvedTabWidth,
  showLabel,
  showCloseButton,
  isCloseHovered,
  isClosingTab,
  presentation,
  tooltipLabel,
  accessibilityLabel,
  resolvedTab,
  setHoveredCloseTabKey,
  onNavigateTab,
  onCloseTab,
  dragHandleProps,
}: {
  serverId: string;
  tab: WorkspaceTabDescriptor;
  isActive: boolean;
  isDragging: boolean;
  isFocused: boolean;
  resolvedTabWidth: number;
  showLabel: boolean;
  showCloseButton: boolean;
  isCloseHovered: boolean;
  isClosingTab: boolean;
  presentation: WorkspaceTabPresentation;
  tooltipLabel: string;
  accessibilityLabel: string;
  resolvedTab: WorkspaceDesktopTabActions;
  setHoveredCloseTabKey: Dispatch<SetStateAction<string | null>>;
  onNavigateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  dragHandleProps: DraggableListDragHandleProps | undefined;
}) {
  const { closeButtonTestId, contextMenuTestId, menuEntries } = resolvedTab;
  const isCompact = useIsCompactFormFactor();
  const [hovered, setHovered] = useState(false);
  // An active tab in a pane without focus stays legible but quiet: a soft underline and the muted
  // label, so only one tab in the window reads as the live one.
  const isActiveFocused = isActive && isFocused;
  const isHovered = hovered || isCloseHovered;
  const isHighlighted = isActiveFocused || isHovered;
  const showCloseControl = isHovered || isActiveFocused || isCompact || isClosingTab;
  const testIdentity =
    tab.target.kind === "new_tab" ? tab.tabId : buildDeterministicWorkspaceTabId(tab.target);
  const navigate = useCallback(() => onNavigateTab(tab.tabId), [onNavigateTab, tab.tabId]);
  const close = useCallback(() => void onCloseTab(tab.tabId), [onCloseTab, tab.tabId]);
  const handleAuxClick = useCallback(
    (event: ReactMouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      close();
    },
    [close],
  );
  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);
  const chipStyle = useMemo(
    () => ({
      width: resolvedTabWidth,
      minWidth: resolvedTabWidth,
      maxWidth: resolvedTabWidth,
      paddingLeft: TAB_CHIP_HORIZONTAL_PADDING,
      paddingRight: TAB_CHIP_HORIZONTAL_PADDING + TAB_CLOSE_BUTTON_RESERVED_WIDTH,
    }),
    [resolvedTabWidth],
  );
  const listeners = dragHandleProps?.listeners as Record<string, unknown> | undefined;
  const attributes = dragHandleProps?.attributes as Record<string, unknown> | undefined;

  return (
    <div
      className="relative"
      onPointerEnter={handleHoverIn}
      onPointerLeave={handleHoverOut}
      onAuxClick={handleAuxClick}
    >
      <ContextMenu key={tab.key}>
        <Tooltip delayDuration={400} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild>
            <ContextMenuTrigger
              {...attributes}
              {...listeners}
              triggerRef={dragHandleProps?.setActivatorNodeRef as never}
              testID={`workspace-tab-${testIdentity}`}
              onPressIn={navigate}
              onPress={navigate}
              accessibilityRole="button"
              accessibilityLabel={accessibilityLabel}
              aria-selected={isActive}
              className={cn(
                "flex h-[35px] items-center gap-1.5 border-b-2 border-transparent pt-0.5 select-none",
                isActiveFocused && "border-foreground",
                isActive && !isFocused && "border-border",
                isDragging && "cursor-grabbing",
              )}
              style={chipStyle}
            >
              <TabChipLabel
                presentation={presentation}
                showLabel={showLabel}
                isHighlighted={isHighlighted}
                testIdentity={testIdentity}
              />
            </ContextMenuTrigger>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            offset={8}
            maxWidth={720}
            testID={`workspace-tab-tooltip-${testIdentity}`}
          >
            {tab.target.kind === "agent" ? (
              <AgentTabTooltipBody
                serverId={serverId}
                agentId={tab.target.agentId}
                title={tooltipLabel}
              />
            ) : (
              tooltipLabel
            )}
          </TooltipContent>
        </Tooltip>
        {showCloseButton ? (
          <TabCloseButton
            tabKey={tab.key}
            visible={showCloseControl}
            isClosingTab={isClosingTab}
            testId={closeButtonTestId}
            onClose={close}
            setHoveredCloseTabKey={setHoveredCloseTabKey}
          />
        ) : null}
        <ContextMenuContent align="start" width={DROPDOWN_WIDTH} testID={contextMenuTestId}>
          {menuEntries.map((entry) =>
            entry.kind === "separator" ? (
              <ContextMenuSeparator key={entry.key} />
            ) : (
              <TabContextMenuItem key={entry.key} entry={entry} />
            ),
          )}
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

function ResolvedDesktopTabChip({
  serverId,
  item,
  isFocused,
  isDragging,
  index,
  tabCount,
  handlers,
  labels,
  resolvedTabWidth,
  showLabel,
  showCloseButton,
  setHoveredCloseTabKey,
  dragHandleProps,
  showDropIndicatorBefore,
  showDropIndicatorAfter,
}: {
  serverId: string;
  item: ResolvedWorkspaceDesktopTabRowItem;
  isFocused: boolean;
  isDragging: boolean;
  index: number;
  tabCount: number;
  handlers: TabHandlers;
  labels: WorkspaceTabMenuLabels;
  resolvedTabWidth: number;
  showLabel: boolean;
  showCloseButton: boolean;
  setHoveredCloseTabKey: Dispatch<SetStateAction<string | null>>;
  dragHandleProps: DraggableListDragHandleProps | undefined;
  showDropIndicatorBefore: boolean;
  showDropIndicatorAfter: boolean;
}) {
  const { t } = useTranslation();
  const presentation = item.presentation;
  const resolvedTab = useMemo(
    () => buildWorkspaceDesktopTabActions({ tab: item.tab, index, tabCount, ...handlers, labels }),
    [handlers, index, item.tab, labels, tabCount],
  );
  const rawTooltipLabel =
    presentation.titleState === "loading" ? t("common.states.loading") : presentation.tooltip;
  const accessibilityLabel =
    item.tab.target.kind === "agent"
      ? normalizeAgentTooltipTitle(rawTooltipLabel)
      : rawTooltipLabel;
  const tooltipLabel =
    item.tab.target.kind === "agent"
      ? formatAgentTooltipTitle(accessibilityLabel)
      : rawTooltipLabel;
  const indicator =
    "pointer-events-none absolute top-0.5 bottom-0.5 z-10 w-1 rounded-full bg-primary";
  return (
    <div className="relative mx-0.5">
      {showDropIndicatorBefore ? <div className={cn(indicator, "-left-1")} /> : null}
      <TabChip
        serverId={serverId}
        tab={item.tab}
        isActive={item.isActive}
        isDragging={isDragging}
        isFocused={isFocused}
        resolvedTabWidth={resolvedTabWidth}
        showLabel={showLabel}
        showCloseButton={showCloseButton}
        isCloseHovered={item.isCloseHovered}
        isClosingTab={item.isClosingTab}
        presentation={presentation}
        tooltipLabel={tooltipLabel}
        accessibilityLabel={accessibilityLabel}
        resolvedTab={resolvedTab}
        setHoveredCloseTabKey={setHoveredCloseTabKey}
        onNavigateTab={handlers.onNavigateTab}
        onCloseTab={handlers.onCloseTab}
        dragHandleProps={dragHandleProps}
      />
      {showDropIndicatorAfter ? <div className={cn(indicator, "-right-1")} /> : null}
    </div>
  );
}

type TabHandlers = Pick<
  WorkspaceDesktopTabsRowProps,
  | "onNavigateTab"
  | "onCloseTab"
  | "onCopyResumeCommand"
  | "onCopyAgentId"
  | "onCopyTerminalId"
  | "onCopyFilePath"
  | "onReloadAgent"
  | "onRenameTab"
  | "onCloseTabsToLeft"
  | "onCloseTabsToRight"
  | "onCloseOtherTabs"
>;

/** Measures each label's natural width with hidden copies set in the tab label's type. */
function useLabelMeasurements(labels: WorkspaceTabLabel[]) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [measurements, setMeasurements] = useState(
    () => new Map<string, { label: string; width: number }>(),
  );
  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const next = new Map<string, { label: string; width: number }>();
    for (const node of container.children) {
      const element = node as HTMLElement;
      const key = element.dataset.key;
      const label = element.dataset.label;
      if (key === undefined || label === undefined) continue;
      next.set(key, { label, width: Math.ceil(element.getBoundingClientRect().width) });
    }
    setMeasurements((current) => {
      if (
        current.size === next.size &&
        [...next].every(([key, value]) => {
          const old = current.get(key);
          return old?.label === value.label && old.width === value.width;
        })
      ) {
        return current;
      }
      return next;
    });
  }, []);
  useLayoutEffect(measure, [labels, measure]);
  useEffect(() => {
    // Web fonts can land after the first measure and change every width.
    void document.fonts?.ready.then(measure);
  }, [measure]);
  const element = (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 flex items-start opacity-0"
    >
      {labels.map(({ key, label }) => (
        <span
          key={`${key}:${label}`}
          data-key={key}
          data-label={label}
          className="shrink-0 text-sm font-medium whitespace-nowrap"
        >
          {label}
        </span>
      ))}
    </div>
  );
  return { measurements, element };
}

function useElementWidth() {
  const [width, setWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    const update = () => setWidth(Math.round(node.getBoundingClientRect().width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    observerRef.current = observer;
  }, []);
  return [width, ref] as const;
}

export function WorkspaceDesktopTabsRow(props: WorkspaceDesktopTabsRowProps) {
  const [presentations, setPresentations] = useState(
    () => new Map<string, WorkspaceTabPresentation>(),
  );
  const handlePresentation = useCallback(
    (tabKey: string, presentation: WorkspaceTabPresentation) => {
      setPresentations((current) => {
        if (current.get(tabKey) === presentation) return current;
        const next = new Map(current);
        next.set(tabKey, presentation);
        return next;
      });
    },
    [],
  );
  const currentTabKeys = useMemo(
    () => new Set(props.tabs.map((item) => item.tab.key)),
    [props.tabs],
  );
  useEffect(() => {
    setPresentations((current) => {
      const removed = [...current.keys()].filter((key) => !currentTabKeys.has(key));
      if (removed.length === 0) return current;
      const next = new Map(current);
      for (const key of removed) next.delete(key);
      return next;
    });
  }, [currentTabKeys]);
  const resolvedTabs = useMemo(
    () =>
      props.tabs.flatMap((item) => {
        const presentation = presentations.get(item.tab.key);
        return presentation ? [{ ...item, presentation }] : [];
      }),
    [presentations, props.tabs],
  );
  return (
    <>
      <ResolvedWorkspaceDesktopTabsRow {...props} tabs={resolvedTabs} />
      {props.tabs.map(({ tab }) => (
        <WorkspaceDesktopTabPresentationSlot
          key={`${tab.key}:${tab.kind}`}
          tab={tab}
          serverId={props.normalizedServerId}
          workspaceId={props.normalizedWorkspaceId}
          onResolve={handlePresentation}
        />
      ))}
    </>
  );
}

function ResolvedWorkspaceDesktopTabsRow({
  paneId,
  isFocused = false,
  tabs,
  normalizedServerId,
  normalizedWorkspaceId,
  setHoveredCloseTabKey,
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
  onReorderTabs,
  externalDndContext = false,
  activeDragTabId = null,
  tabDropPreviewIndex = null,
  showPaneSplitActions = false,
  showPaneMaximizeAction = false,
  paneMaximized = false,
  onTogglePaneMaximized,
  onSplitRight,
  onSplitDown,
  focusModeEnabled,
  onExitFocusMode,
}: Omit<WorkspaceDesktopTabsRowProps, "tabs"> & { tabs: ResolvedWorkspaceDesktopTabRowItem[] }) {
  const { t } = useTranslation();
  const newTabKeys = useShortcutKeys("workspace-tab-new");
  const [tabsContainerWidth, tabsContainerRef] = useElementWidth();
  const [exitFocusModeWidth, exitFocusModeRef] = useElementWidth();
  const scrollBoundary = useHorizontalScrollBoundary();
  const [trackSnapshot, setTrackSnapshot] = useState<WorkspaceTabTrackSnapshot | null>(null);

  const layoutMetrics = useMemo(
    () => ({
      rowHorizontalInset: 0,
      actionsReservedWidth: Math.max(
        0,
        DEFAULT_INLINE_ADD_BUTTON_RESERVED_WIDTH +
          (focusModeEnabled ? exitFocusModeWidth : 0) +
          (showPaneSplitActions ? PANE_SPLIT_ACTIONS_RESERVED_WIDTH : 0) +
          (showPaneMaximizeAction ? PANE_MAXIMIZE_ACTION_RESERVED_WIDTH : 0),
      ),
      rowPaddingHorizontal: TAB_ROW_PADDING_HORIZONTAL,
      tabGap: TAB_CHIP_GAP,
      minTabWidth: TAB_MIN_WIDTH,
      maxTabWidth: TAB_MAX_WIDTH,
      tabIconWidth: TAB_ICON_WIDTH,
      tabContentGap: TAB_CONTENT_GAP,
      tabHorizontalPadding: TAB_CHIP_HORIZONTAL_PADDING,
      closeButtonWidth: TAB_CLOSE_BUTTON_RESERVED_WIDTH,
    }),
    [exitFocusModeWidth, focusModeEnabled, showPaneMaximizeAction, showPaneSplitActions],
  );
  const fallbackTabLabels = useMemo(
    () => ({
      newTab: t("workspace.tabs.actions.newTab"),
      newAgent: t("workspace.tabs.fallback.newAgent"),
      setup: t("workspace.tabs.fallback.setup"),
      terminal: t("workspace.tabs.fallback.terminal"),
      agent: t("workspace.tabs.fallback.agent"),
      changes: t("panels.diff.changesLabel"),
      files: t("panels.files.label"),
      pullRequest: t("panels.pullRequest.label"),
    }),
    [t],
  );
  const tabMenuLabels = useMemo<WorkspaceTabMenuLabels>(
    () => ({
      copyResumeCommand: t("workspace.tabs.menu.copyResumeCommand"),
      copyAgentId: t("workspace.tabs.menu.copyAgentId"),
      copyTerminalId: t("workspace.tabs.menu.copyTerminalId"),
      copyFilePath: t("workspace.tabs.menu.copyFilePath"),
      rename: t("workspace.tabs.menu.rename"),
      closeAbove: t("workspace.tabs.menu.closeAbove"),
      closeBelow: t("workspace.tabs.menu.closeBelow"),
      closeLeft: t("workspace.tabs.menu.closeLeft"),
      closeRight: t("workspace.tabs.menu.closeRight"),
      closeOthers: t("workspace.tabs.menu.closeOthers"),
      reloadAgent: t("workspace.tabs.menu.reloadAgent"),
      reloadAgentTooltip: t("workspace.tabs.menu.reloadAgentTooltip"),
      close: t("workspace.tabs.menu.close"),
    }),
    [t],
  );
  const tabLabels = useMemo(
    () =>
      tabs.map((tab) => ({
        key: tab.tab.key,
        label:
          tab.presentation.titleState === "loading"
            ? getFallbackTabLabel(tab.tab, fallbackTabLabels)
            : tab.presentation.label,
        modified: tab.presentation.modified,
      })),
    [fallbackTabLabels, tabs],
  );
  const tabLabelSignature = useMemo(() => JSON.stringify(tabLabels), [tabLabels]);
  const { measurements, element: measurementElement } = useLabelMeasurements(tabLabels);

  useLayoutEffect(() => {
    if (tabsContainerWidth <= 0) return;
    const labelWidths = completeWorkspaceTabLabelWidths(tabLabels, measurements);
    if (!labelWidths) return;
    setTrackSnapshot((current) => {
      if (
        current?.signature === tabLabelSignature &&
        sameWidths(current.labelWidths, labelWidths)
      ) {
        return current;
      }
      return { signature: tabLabelSignature, tabs, labels: tabLabels, labelWidths };
    });
  }, [measurements, tabLabelSignature, tabLabels, tabs, tabsContainerWidth]);

  // A track waits for its widths, but every tab in it shows the newest state the label allows.
  const displayedTabs = useMemo(() => {
    if (!trackSnapshot) return [];
    const currentTabs = new Map(
      tabs.map((tab, index) => [tab.tab.key, { tab, label: tabLabels[index]?.label }]),
    );
    return trackSnapshot.tabs.map((snapshotTab, index) => {
      const current = currentTabs.get(snapshotTab.tab.key);
      return current?.label === trackSnapshot.labels[index]?.label ? current.tab : snapshotTab;
    });
  }, [tabLabels, tabs, trackSnapshot]);

  const { layout } = useWorkspaceTabLayout({
    tabLabelWidths: trackSnapshot?.labelWidths ?? [],
    viewportWidthOverride: tabsContainerWidth > 0 ? tabsContainerWidth : null,
    metrics: layoutMetrics,
  });

  const handleDragEnd = useCallback(
    (nextTabs: ResolvedWorkspaceDesktopTabRowItem[]) =>
      onReorderTabs(nextTabs.map((tab) => tab.tab)),
    [onReorderTabs],
  );
  const getTabDragData = useMemo(() => {
    if (!paneId) return undefined;
    return (tab: ResolvedWorkspaceDesktopTabRowItem) => ({
      kind: "workspace-tab" as const,
      paneId,
      tabId: tab.tab.tabId,
    });
  }, [paneId]);
  const createNewTab = useCallback(() => onCreateNewTab({ paneId }), [onCreateNewTab, paneId]);
  useKeyboardActionHandler({
    handlerId: buildWorkspaceKeyboardHandlerId({
      name: "workspace-new-tab",
      serverId: normalizedServerId,
      workspaceId: normalizedWorkspaceId,
      paneId,
    }),
    actions: ["workspace.tab.menu.open"],
    enabled: isFocused,
    priority: 200,
    handle: (action: KeyboardActionDefinition) => {
      if (!isFocused || action.id !== "workspace.tab.menu.open") return false;
      createNewTab();
      return true;
    },
  });

  const handlers = useMemo<TabHandlers>(
    () => ({
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
    }),
    [
      onCloseOtherTabs,
      onCloseTab,
      onCloseTabsToLeft,
      onCloseTabsToRight,
      onCopyAgentId,
      onCopyFilePath,
      onCopyResumeCommand,
      onCopyTerminalId,
      onNavigateTab,
      onReloadAgent,
      onRenameTab,
    ],
  );

  const renderTab = useCallback(
    ({
      item,
      index,
      dragHandleProps,
      isActive,
    }: DraggableRenderItemInfo<ResolvedWorkspaceDesktopTabRowItem>) => {
      const layoutItem = layout.items[index] ?? null;
      return (
        <ResolvedDesktopTabChip
          key={`${item.tab.key}:${item.tab.kind}`}
          serverId={normalizedServerId}
          item={item}
          isFocused={isFocused}
          isDragging={isActive}
          index={index}
          tabCount={displayedTabs.length}
          handlers={handlers}
          labels={tabMenuLabels}
          resolvedTabWidth={layoutItem?.width ?? 150}
          showLabel={layoutItem?.showLabel ?? true}
          showCloseButton={layout.closeButtonPolicy === "all"}
          setHoveredCloseTabKey={setHoveredCloseTabKey}
          dragHandleProps={dragHandleProps}
          showDropIndicatorBefore={activeDragTabId !== null && tabDropPreviewIndex === index}
          showDropIndicatorAfter={
            activeDragTabId !== null &&
            tabDropPreviewIndex === displayedTabs.length &&
            index === displayedTabs.length - 1
          }
        />
      );
    },
    [
      activeDragTabId,
      displayedTabs.length,
      handlers,
      isFocused,
      layout.closeButtonPolicy,
      layout.items,
      normalizedServerId,
      setHoveredCloseTabKey,
      tabDropPreviewIndex,
      tabMenuLabels,
    ],
  );

  return (
    <RenderProfile id="WorkspaceDesktopTabsRow">
      <div
        ref={tabsContainerRef}
        className="relative flex h-9 min-w-0 shrink-0 items-center border-b bg-background"
        data-testid="workspace-tabs-row"
      >
        {measurementElement}
        <WorkspaceExitFocusModeButton
          visible={focusModeEnabled}
          onPress={onExitFocusMode}
          slotRef={exitFocusModeRef}
        />
        <div className="relative flex min-w-0 flex-1 self-stretch">
          <div
            ref={scrollBoundary.ref}
            onScroll={scrollBoundary.onScroll}
            data-testid="workspace-tabs-scroll"
            className={cn(
              "flex min-w-0 flex-1 items-center [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              layout.requiresHorizontalScrollFallback ? "overflow-x-auto" : "overflow-x-hidden",
            )}
            style={TAB_SCROLL_PADDING_STYLE}
          >
            <SortableInlineList
              data={displayedTabs}
              keyExtractor={tabKeyExtractor}
              useDragHandle
              disabled={!externalDndContext && displayedTabs.length < 2}
              onDragEnd={handleDragEnd}
              externalDndContext={externalDndContext}
              activeId={activeDragTabId}
              getItemData={getTabDragData}
              renderItem={renderTab}
            />
            {!layout.requiresHorizontalScrollFallback ? (
              <WorkspaceNewTabButton
                placement="inline"
                serverId={normalizedServerId}
                paneId={paneId}
                shortcutKeys={newTabKeys}
              />
            ) : null}
          </div>
          <HorizontalScrollBoundaryShades
            visible={layout.requiresHorizontalScrollFallback}
            backdrop="surface"
            testIDPrefix="workspace-tabs-scroll-shade"
            showLeft={scrollBoundary.showLeft}
            showRight={scrollBoundary.showRight}
          />
        </div>
        <WorkspacePaneToolbarActions
          showNewTabButton={layout.requiresHorizontalScrollFallback}
          showSplitActions={showPaneSplitActions}
          showMaximizeAction={showPaneMaximizeAction}
          paneMaximized={paneMaximized}
          serverId={normalizedServerId}
          paneId={paneId}
          newTabShortcutKeys={newTabKeys}
          onSplitRight={onSplitRight}
          onSplitDown={onSplitDown}
          onTogglePaneMaximized={onTogglePaneMaximized}
        />
      </div>
    </RenderProfile>
  );
}
