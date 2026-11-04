import { memo, useCallback, useMemo, useState, type ComponentProps, type MouseEvent } from "react";
import {
  Archive,
  Circle,
  CircleCheck,
  Copy,
  EllipsisVertical,
  Pencil,
  Pin,
  PinOff,
  Sparkles,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { isHomeWorkspace } from "@/chief/home-workspace";
import {
  resolveSidebarWorkspaceAccessibilityLabel,
  resolveSidebarWorkspacePrimaryLabel,
} from "@/components/sidebar/sidebar-workspace-title";
import {
  selectWorkspaceServiceSummary,
  workspaceServiceLabelKey,
} from "@/components/sidebar/workspace-meta-row/service-summary";
import { WorkspaceRenameModal } from "@/components/workspace-rename-modal";
import { useToast } from "@/contexts/toast-context";
import { getForgePresentation, normalizeForge } from "@/git/forge";
import { toWorktreeArchiveRisk } from "@/git/worktree-archive-warning";
import type { HostBadgeModel } from "@/hosts/appearance";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useAppSettings } from "@/hooks/use-settings";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import type { ToggleSidebarWorkspacePin } from "@/hooks/use-sidebar-workspace-pin";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useWorkspaceClipboardActions } from "@/hooks/use-workspace-clipboard-actions";
import { useWorkspaceReadState } from "@/hooks/use-workspace-read-state";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";
import { redirectIfArchivingActiveWorkspace } from "@/utils/sidebar-workspace-archive-redirect";
import { useWorkspaceLabelDefinitions } from "@/workspace-labels";
import { useWorkspaceArchive } from "@/workspace/use-workspace-archive";
import { cn } from "cn";
import { contextMenuKit, dropdownMenuKit, type MenuKit } from "~/components/menu-kit";
import type { SortableItemProps } from "~/components/sortable-list";
import { Shortcut } from "~/components/shortcut";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "~/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";
import { Kbd } from "~/components/ui/kbd";
import { Spinner } from "~/components/ui/spinner";
import {
  useWorkspaceMetaRowItems,
  WorkspaceMetaRow,
  WorkspaceTrailingContent,
} from "~/sidebar/meta-row";
import { ProjectStatusIndicator, WorkspaceStatusIndicator } from "~/sidebar/status-visuals";
import { WorkspaceLabelsSubmenu } from "~/sidebar/workspace-labels-menu";
import { WorkspaceHoverCard } from "~/sidebar/workspace-hover-card";

// shortcut: copied from archive/expo-app:packages/app/src/components/sidebar-workspace-list.tsx, whose module
// renders React Native; the copy there goes away at the cutover.
const AGENT_WORKSPACE_RENAME_PROMPT =
  "Based on our current conversation and the actual repository changes, rename this workspace to reflect what the work has become. First set a concise, distinctive workspace title. If the current branch is still a BySpace-generated, unpublished worktree branch and the proposed name does not conflict, also set a matching branch name. Otherwise leave the branch unchanged and explain why. Generate the title and branch independently rather than mechanically slugifying the title. Never rename a default, published, upstream-tracking, or PR/MR branch. Use the BySpace skill to apply the changes and report the final title and branch.";

const NO_LABELS: readonly string[] = [];

interface WorkspaceMenuActions {
  workspace: SidebarWorkspaceEntry;
  onCopyPath: () => void;
  onCopyBranchName?: () => void;
  onRename?: () => void;
  onRenameWithAgent?: () => void;
  onMarkAsRead?: () => void;
  onMarkAsUnread?: () => void;
  isPinned: boolean;
  onTogglePin?: () => void;
  showLabels: boolean;
  onArchive?: () => void;
  isArchiving: boolean;
  archiveShortcutKeys: ShortcutKey[][] | null;
}

/** The workspace actions, shared by the kebab menu and the right-click menu. */
function WorkspaceMenuItems({ kit, actions }: { kit: MenuKit; actions: WorkspaceMenuActions }) {
  const { t } = useTranslation();
  const key = actions.workspace.workspaceKey;
  return (
    <>
      <kit.Item
        onSelect={actions.onCopyPath}
        data-testid={`sidebar-workspace-menu-copy-path-${key}`}
      >
        <Copy />
        {t("sidebar.workspace.actions.copyPath")}
      </kit.Item>
      {actions.onCopyBranchName ? (
        <kit.Item
          onSelect={actions.onCopyBranchName}
          data-testid={`sidebar-workspace-menu-copy-branch-name-${key}`}
        >
          <Copy />
          {t("sidebar.workspace.actions.copyBranchName")}
        </kit.Item>
      ) : null}
      {actions.onRename ? (
        <kit.Item onSelect={actions.onRename} data-testid={`sidebar-workspace-menu-rename-${key}`}>
          <Pencil />
          {t("sidebar.workspace.actions.rename")}
        </kit.Item>
      ) : null}
      {actions.onRenameWithAgent ? (
        <kit.Item
          onSelect={actions.onRenameWithAgent}
          data-testid={`sidebar-workspace-menu-rename-with-agent-${key}`}
        >
          <Sparkles />
          {t("sidebar.workspace.actions.renameWithAgent")}
        </kit.Item>
      ) : null}
      {actions.onMarkAsRead ? (
        <kit.Item
          onSelect={actions.onMarkAsRead}
          data-testid={`sidebar-workspace-menu-mark-as-read-${key}`}
        >
          <CircleCheck />
          Mark as read
        </kit.Item>
      ) : null}
      {actions.onMarkAsUnread ? (
        <kit.Item
          onSelect={actions.onMarkAsUnread}
          data-testid={`sidebar-workspace-menu-mark-as-unread-${key}`}
        >
          <Circle />
          Mark as unread
        </kit.Item>
      ) : null}
      {actions.onTogglePin ? (
        <kit.Item onSelect={actions.onTogglePin} data-testid={`sidebar-workspace-menu-pin-${key}`}>
          {actions.isPinned ? <PinOff /> : <Pin />}
          {actions.isPinned
            ? t("sidebar.workspace.actions.unpin")
            : t("sidebar.workspace.actions.pin")}
        </kit.Item>
      ) : null}
      {actions.showLabels ? (
        <WorkspaceLabelsSubmenu
          kit={kit}
          serverId={actions.workspace.serverId}
          workspaceId={actions.workspace.workspaceId}
          assignedLabels={actions.workspace.labels ?? NO_LABELS}
          testId={`sidebar-workspace-menu-labels-${key}`}
        />
      ) : null}
      {actions.onArchive ? (
        <kit.Item
          onSelect={actions.onArchive}
          disabled={actions.isArchiving}
          data-testid={`sidebar-workspace-menu-archive-${key}`}
        >
          {actions.isArchiving ? <Spinner /> : <Archive />}
          {actions.isArchiving
            ? t("sidebar.workspace.actions.archiving")
            : t("sidebar.workspace.actions.archive")}
          {actions.archiveShortcutKeys && !actions.isArchiving ? (
            <span className="ml-auto">
              <Shortcut chord={actions.archiveShortcutKeys} />
            </span>
          ) : null}
        </kit.Item>
      ) : null}
    </>
  );
}

export interface WorkspaceRowProps {
  workspace: SidebarWorkspaceEntry;
  hostBadge?: HostBadgeModel | null;
  leadingProjectName?: string | null;
  leadingProjectNameCue?: string | null;
  leadingProjectIconDataUri?: string | null;
  selected: boolean;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  canCopyBranchName: boolean;
  canPin: boolean;
  onToggleWorkspacePin: ToggleSidebarWorkspacePin;
  reserveIdleStatusIndicatorSpace?: boolean;
  isCreating?: boolean;
  onWorkspacePress?: () => void;
  /** The status grouping leaves "Rename with agent" out, as the Expo app does. */
  allowRenameWithAgent?: boolean;
  /** Present when the row sits in a reorderable list. */
  sortable?: SortableItemProps;
}

function isPlainLeftClick(event: MouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

type EventHandler = (event: unknown) => void;

/** Adds the drag listeners to the anchor's props, running both when Radix already set the same handler. */
function withDragListeners(
  props: ComponentProps<"a">,
  listeners: Record<string, unknown> | undefined,
): ComponentProps<"a"> {
  if (!listeners) return props;
  const merged: Record<string, unknown> = { ...props };
  for (const [name, listener] of Object.entries(listeners)) {
    const own = merged[name];
    merged[name] =
      typeof own === "function"
        ? (event: unknown) => {
            (own as EventHandler)(event);
            (listener as EventHandler)(event);
          }
        : listener;
  }
  return merged;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Archive, with the selected row's keyboard shortcut, as the Expo app's row wires it. */
function useRowArchive(
  workspace: SidebarWorkspaceEntry,
  selected: boolean,
  isFixedActionRow: boolean,
) {
  const [isHiding, setIsHiding] = useState(false);
  const isArchiving = workspace.archivingAt !== null || isHiding;
  const archiveController = useWorkspaceArchive({
    serverId: workspace.serverId,
    workspaceId: workspace.workspaceId,
    workspaceKind: workspace.workspaceKind,
    name: workspace.name,
    ...toWorktreeArchiveRisk(workspace),
    onArchiveStarted: () =>
      redirectIfArchivingActiveWorkspace({
        serverId: workspace.serverId,
        workspaceId: workspace.workspaceId,
        activeWorkspaceSelection: selected
          ? { serverId: workspace.serverId, workspaceId: workspace.workspaceId }
          : null,
      }),
    onSetHiding: setIsHiding,
  });
  const archive = useCallback(() => {
    if (!isArchiving) archiveController.archive();
  }, [archiveController, isArchiving]);
  useKeyboardActionHandler({
    handlerId: `workspace-archive-${workspace.workspaceKey}`,
    actions: ["workspace.archive"],
    enabled: selected && !isArchiving && !isFixedActionRow,
    priority: 0,
    handle: () => {
      archive();
      return true;
    },
  });
  return { archive, isArchiving };
}

/** Everything the kebab and right-click menus offer for a row. */
function useWorkspaceMenuActions({
  workspace,
  selected,
  canCopyBranchName,
  canPin,
  onToggleWorkspacePin,
  allowRenameWithAgent,
  openRename,
}: {
  workspace: SidebarWorkspaceEntry;
  selected: boolean;
  canCopyBranchName: boolean;
  canPin: boolean;
  onToggleWorkspacePin: ToggleSidebarWorkspacePin;
  allowRenameWithAgent: boolean;
  openRename: () => void;
}): WorkspaceMenuActions {
  const { t } = useTranslation();
  const toast = useToast();
  const isFixedActionRow = isHomeWorkspace(workspace);
  const { archive, isArchiving } = useRowArchive(workspace, selected, isFixedActionRow);
  const supportsAgentRename = useHostFeature(workspace.serverId, "workspaceAgentRename");
  const archiveShortcutKeys = useShortcutKeys("archive-workspace");
  const clipboard = useWorkspaceClipboardActions();
  const { hasClearableAttention, canMarkUnread, clearAttention, markUnread } =
    useWorkspaceReadState({
      serverId: workspace.serverId,
      workspaceId: workspace.workspaceId,
    });
  const copyPath = useCallback(() => clipboard.copyPath(workspace), [clipboard, workspace]);
  const copyBranchName = useCallback(
    () => clipboard.copyBranchName(workspace),
    [clipboard, workspace],
  );
  const renameWithAgent = useCallback(() => {
    navigator.clipboard
      .writeText(AGENT_WORKSPACE_RENAME_PROMPT)
      .then(() => toast.copied(t("sidebar.workspace.toasts.agentRenamePromptCopied")))
      .catch(() => toast.error(t("sidebar.workspace.toasts.agentRenamePromptCopyFailed")));
  }, [t, toast]);
  const markAsRead = useCallback(() => {
    clearAttention().catch((error: unknown) =>
      toast.error(errorMessage(error, "Failed to mark workspace as read")),
    );
  }, [clearAttention, toast]);
  const markAsUnread = useCallback(() => {
    markUnread().catch((error: unknown) =>
      toast.error(errorMessage(error, "Failed to mark workspace as unread")),
    );
  }, [markUnread, toast]);
  const togglePin = useCallback(
    () => onToggleWorkspacePin(workspace),
    [onToggleWorkspacePin, workspace],
  );
  const editable = !isFixedActionRow;
  return useMemo(
    () => ({
      workspace,
      onCopyPath: copyPath,
      onCopyBranchName: canCopyBranchName ? copyBranchName : undefined,
      onRename: editable ? openRename : undefined,
      onRenameWithAgent:
        allowRenameWithAgent && supportsAgentRename && editable ? renameWithAgent : undefined,
      onMarkAsRead: hasClearableAttention ? markAsRead : undefined,
      onMarkAsUnread: canMarkUnread ? markAsUnread : undefined,
      isPinned: workspace.pinnedAt != null && editable,
      onTogglePin: canPin && editable ? togglePin : undefined,
      showLabels: editable,
      onArchive: editable ? archive : undefined,
      isArchiving,
      archiveShortcutKeys: selected && editable ? archiveShortcutKeys : null,
    }),
    [
      allowRenameWithAgent,
      archive,
      archiveShortcutKeys,
      canCopyBranchName,
      canMarkUnread,
      canPin,
      copyBranchName,
      copyPath,
      editable,
      hasClearableAttention,
      isArchiving,
      markAsRead,
      markAsUnread,
      openRename,
      renameWithAgent,
      selected,
      supportsAgentRename,
      togglePin,
      workspace,
    ],
  );
}

function useRowAccessibilityLabel(
  workspace: SidebarWorkspaceEntry,
  leadingProjectName: string | null,
  hostBadge: HostBadgeModel | null,
): string {
  const { t } = useTranslation();
  const { settings } = useAppSettings();
  const serviceSummary = selectWorkspaceServiceSummary(workspace.scripts);
  const prHint = workspace.prHint;
  return resolveSidebarWorkspaceAccessibilityLabel({
    workspace,
    workspaceTitleSource: settings.workspaceTitleSource,
    leadingProjectName,
    hostBadgeLabel: hostBadge?.label ?? null,
    pullRequestLabel: prHint
      ? t("workspace.git.pr.accessibility.pullRequest", {
          number: prHint.number,
          context: getForgePresentation(normalizeForge(prHint.forge)).changeRequestContext,
        })
      : null,
    serviceLabel: serviceSummary
      ? t(workspaceServiceLabelKey(serviceSummary), { name: serviceSummary.name })
      : null,
  });
}

/** The row's title line and the meta line under it. */
function WorkspaceRowText({
  workspace,
  hostBadge,
  leadingProjectName,
  leadingProjectNameCue,
  isCreating,
  showShortcut,
}: {
  workspace: SidebarWorkspaceEntry;
  hostBadge: HostBadgeModel | null;
  leadingProjectName: string | null;
  leadingProjectNameCue: string | null;
  isCreating: boolean;
  showShortcut: boolean;
}) {
  const { t } = useTranslation();
  const {
    settings: { workspaceTitleSource, sidebarWorkspaceTrailing },
  } = useAppSettings();
  const labels = useWorkspaceLabelDefinitions(workspace.serverId, workspace.labels);
  const title = resolveSidebarWorkspacePrimaryLabel({ workspace, workspaceTitleSource });
  const hasTrailing =
    (sidebarWorkspaceTrailing === "diff" && workspace.diffStat !== null) ||
    (sidebarWorkspaceTrailing === "timestamp" && workspace.statusEnteredAt !== null);
  return (
    // The meta line sits right under the title, as in the Expo app (no gap between the two).
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="flex h-5 min-w-0 items-center gap-2">
        <span
          className={cn("min-w-0 flex-1 truncate leading-5", isCreating && "text-muted-foreground")}
        >
          {title}
        </span>
        {isCreating ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {t("sidebar.workspace.status.creating")}
          </span>
        ) : null}
        {hasTrailing && !showShortcut ? (
          <span className="shrink-0">
            <WorkspaceTrailingContent workspace={workspace} trailing={sidebarWorkspaceTrailing} />
          </span>
        ) : null}
      </span>
      <WorkspaceMetaRow
        currentBranch={workspace.currentBranch}
        projectName={leadingProjectName}
        projectNameCue={leadingProjectNameCue}
        hostBadge={hostBadge}
        prHint={workspace.prHint}
        serviceSummary={selectWorkspaceServiceSummary(workspace.scripts)}
        labels={labels}
      />
    </span>
  );
}

function WorkspaceRowLeading({
  workspace,
  leadingProjectName,
  leadingProjectIconDataUri,
  loading,
  reserveIdleSpace,
}: {
  workspace: SidebarWorkspaceEntry;
  leadingProjectName: string | null;
  leadingProjectIconDataUri: string | null;
  loading: boolean;
  reserveIdleSpace: boolean;
}) {
  return (
    <span className="flex h-5 shrink-0 items-center">
      {leadingProjectName ? (
        <ProjectStatusIndicator
          iconDataUri={leadingProjectIconDataUri}
          displayName={leadingProjectName}
          projectViewKey={workspace.projectViewKey}
          statusBucket={workspace.statusBucket}
          loading={loading}
          testId={`sidebar-row-project-icon-${workspace.workspaceKey}`}
        />
      ) : (
        <WorkspaceStatusIndicator
          bucket={workspace.statusBucket}
          workspaceKind={workspace.workspaceKind}
          loading={loading}
          reserveIdleSpace={reserveIdleSpace}
        />
      )}
    </span>
  );
}

function WorkspaceRowKebab({
  workspaceKey,
  actions,
  open,
  onOpenChange,
}: {
  workspaceKey: string;
  actions: WorkspaceMenuActions;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <SidebarMenuAction
          showOnHover
          aria-label={t("sidebar.workspace.actions.menu")}
          data-testid={`sidebar-workspace-kebab-${workspaceKey}`}
          // Hover-revealed on desktop: not a Tab stop (docs/hover.md).
          tabIndex={isCompact ? undefined : -1}
        >
          <EllipsisVertical />
        </SidebarMenuAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[260px]">
        <WorkspaceMenuItems kit={dropdownMenuKit} actions={actions} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type WorkspaceRowLinkProps = ComponentProps<"a"> &
  Pick<
    WorkspaceRowProps,
    | "workspace"
    | "hostBadge"
    | "leadingProjectName"
    | "leadingProjectNameCue"
    | "leadingProjectIconDataUri"
    | "selected"
    | "reserveIdleStatusIndicatorSpace"
    | "isCreating"
    | "onWorkspacePress"
    | "sortable"
  > & { isArchiving: boolean; showShortcut: boolean };

/**
 * The row itself, a link to the workspace inside shadcn's SidebarMenuButton. The menu button and
 * Radix's hover-card and context-menu triggers merge their props and ref into it, so it spreads
 * the rest onto the anchor.
 */
function WorkspaceRowLink({
  workspace,
  hostBadge = null,
  leadingProjectName = null,
  leadingProjectNameCue = null,
  leadingProjectIconDataUri = null,
  selected,
  reserveIdleStatusIndicatorSpace = true,
  isCreating = false,
  onWorkspacePress,
  sortable,
  isArchiving,
  showShortcut,
  onClick,
  className,
  ref,
  ...rest
}: WorkspaceRowLinkProps) {
  // The triggers' ref (hover-card anchoring) and the drag handle's ref both need the anchor.
  const dragHandleRef = sortable?.handle.ref;
  const setRefs = useCallback(
    (node: HTMLAnchorElement | null) => {
      dragHandleRef?.(node);
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [dragHandleRef, ref],
  );
  const connectionStatus = useHostRuntimeConnectionStatus(workspace.serverId);
  const isHostDisconnected = connectionStatus === "offline" || connectionStatus === "error";
  const accessibilityLabel = useRowAccessibilityLabel(workspace, leadingProjectName, hostBadge);
  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);
      if (!isPlainLeftClick(event)) return;
      event.preventDefault();
      if (isArchiving) return;
      onWorkspacePress?.();
      navigateToWorkspace({ serverId: workspace.serverId, workspaceId: workspace.workspaceId });
    },
    [isArchiving, onClick, onWorkspacePress, workspace.serverId, workspace.workspaceId],
  );
  return (
    <a
      {...withDragListeners(rest, sortable?.handle.listeners)}
      ref={setRefs}
      href={buildHostWorkspaceRoute(workspace.serverId, workspace.workspaceId)}
      onClick={handleClick}
      aria-label={accessibilityLabel}
      aria-current={selected ? "page" : undefined}
      aria-disabled={isArchiving || undefined}
      // What the e2e helpers read for selection (the Expo app's row carried aria-selected, which a
      // link does not take; aria-current is the link's).
      data-selected={selected ? "true" : "false"}
      data-testid={`sidebar-workspace-row-${workspace.workspaceKey}`}
      className={cn(className, isHostDisconnected && "opacity-60")}
    >
      <WorkspaceRowLeading
        workspace={workspace}
        leadingProjectName={leadingProjectName}
        leadingProjectIconDataUri={leadingProjectIconDataUri}
        loading={isArchiving || isCreating}
        reserveIdleSpace={reserveIdleStatusIndicatorSpace}
      />
      <WorkspaceRowText
        workspace={workspace}
        hostBadge={hostBadge}
        leadingProjectName={leadingProjectName}
        leadingProjectNameCue={leadingProjectNameCue}
        isCreating={isCreating}
        showShortcut={showShortcut}
      />
    </a>
  );
}

/** One workspace in the sidebar: status, title, meta line, trailing info, its menus and its dialogs. */
export const WorkspaceRow = memo(function WorkspaceRow(props: WorkspaceRowProps) {
  const { workspace, selected, sortable } = props;
  const [renameOpen, setRenameOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const openRename = useCallback(() => setRenameOpen(true), []);
  const closeRename = useCallback(() => setRenameOpen(false), []);
  const actions = useWorkspaceMenuActions({
    workspace,
    selected,
    canCopyBranchName: props.canCopyBranchName,
    canPin: props.canPin,
    onToggleWorkspacePin: props.onToggleWorkspacePin,
    allowRenameWithAgent: props.allowRenameWithAgent ?? true,
    openRename,
  });
  const isDragging = sortable?.isDragging === true;
  const anyMenuOpen = menuOpen || contextMenuOpen;
  // shadcn's two-line menu button is its lg size; a row without a meta line is the default one.
  const labels = useWorkspaceLabelDefinitions(workspace.serverId, workspace.labels);
  const metaItems = useWorkspaceMetaRowItems({
    currentBranch: workspace.currentBranch,
    projectName: props.leadingProjectName ?? null,
    projectNameCue: props.leadingProjectNameCue ?? null,
    hostBadge: props.hostBadge ?? null,
    prHint: workspace.prHint,
    serviceSummary: selectWorkspaceServiceSummary(workspace.scripts),
    labels,
  });
  const showShortcut = props.showShortcutBadge && props.shortcutNumber !== null;
  // As in the Expo app, only rows that can be archived carry the kebab; the right-click menu is always there.
  const hasKebab = actions.onArchive !== undefined;

  return (
    <SidebarMenuItem
      ref={sortable?.nodeRef}
      style={sortable?.style}
      className={cn(isDragging && "rounded-md bg-sidebar shadow-md")}
    >
      <ContextMenu onOpenChange={setContextMenuOpen}>
        <WorkspaceHoverCard workspace={workspace} disabled={anyMenuOpen || isDragging}>
          <ContextMenuTrigger asChild>
            <SidebarMenuButton
              asChild
              isActive={selected}
              size={metaItems.length > 0 ? "lg" : "default"}
            >
              <WorkspaceRowLink
                workspace={workspace}
                hostBadge={props.hostBadge}
                leadingProjectName={props.leadingProjectName}
                leadingProjectNameCue={props.leadingProjectNameCue}
                leadingProjectIconDataUri={props.leadingProjectIconDataUri}
                selected={selected}
                reserveIdleStatusIndicatorSpace={props.reserveIdleStatusIndicatorSpace}
                isCreating={props.isCreating}
                onWorkspacePress={props.onWorkspacePress}
                sortable={sortable}
                isArchiving={actions.isArchiving}
                showShortcut={showShortcut}
              />
            </SidebarMenuButton>
          </ContextMenuTrigger>
        </WorkspaceHoverCard>
        <ContextMenuContent
          className="w-[260px]"
          data-testid={`sidebar-workspace-context-menu-${workspace.workspaceKey}`}
        >
          <WorkspaceMenuItems kit={contextMenuKit} actions={actions} />
        </ContextMenuContent>
      </ContextMenu>
      {showShortcut ? (
        <SidebarMenuBadge>
          <Kbd>{props.shortcutNumber}</Kbd>
        </SidebarMenuBadge>
      ) : null}
      {hasKebab && !showShortcut ? (
        <WorkspaceRowKebab
          workspaceKey={workspace.workspaceKey}
          actions={actions}
          open={menuOpen}
          onOpenChange={setMenuOpen}
        />
      ) : null}
      <WorkspaceRenameModal
        visible={renameOpen}
        workspace={workspace}
        onClose={closeRename}
        testID={`sidebar-workspace-rename-modal-${workspace.workspaceKey}`}
      />
    </SidebarMenuItem>
  );
});
