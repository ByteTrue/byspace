import { memo, useCallback, useMemo, useState } from "react";
import { EllipsisVertical, Plus, Settings, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isHomeProjectViewKey } from "@/chief/home-workspace";
import { useLimitedSidebarGroup } from "@/components/sidebar/use-limited-sidebar-group";
import { useToast } from "@/contexts/toast-context";
import type { HostBadgeModel } from "@/hosts/appearance";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import type { ToggleSidebarWorkspacePin } from "@/hooks/use-sidebar-workspace-pin";
import {
  resolveProjectHostBadge,
  type SidebarProjectEntry,
  type SidebarWorkspaceEntry,
  type SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import {
  getCurrentProjectRemoveReadiness,
  removeProjectFromHosts,
} from "@/projects/project-remove";
import { ProjectRemoveModal } from "@/projects/project-remove-modal";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { ActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import { buildNewWorkspaceRoute, buildProjectSettingsRoute } from "@/utils/host-routes";
import { buildProjectRowPathLines } from "@/utils/project-row-cue";
import {
  buildSidebarProjectRowModel,
  type SidebarProjectHostTarget,
} from "@/utils/sidebar-project-row-model";
import { router } from "~/app/navigation";
import { cn } from "cn";
import { contextMenuKit, dropdownMenuKit, type MenuKit } from "~/components/menu-kit";
import { Shortcut } from "~/components/shortcut";
import { SortableList, type SortableItemProps } from "~/components/sortable-list";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "~/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";
import { Spinner } from "~/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { ShowMoreRow } from "~/sidebar/list-parts";
import { ProjectLeadingVisual } from "~/sidebar/status-visuals";
import { WorkspaceRow } from "~/sidebar/workspace-row";

export function isWorkspaceSelected(input: {
  selection: ActiveWorkspaceSelection | null;
  serverId: string | null;
  workspaceId: string;
  enabled: boolean;
}): boolean {
  return (
    input.enabled &&
    input.selection?.serverId === input.serverId &&
    input.selection.workspaceId === input.workspaceId
  );
}

function ProjectMenuItems({
  kit,
  projectViewKey,
  settingsTarget,
  onRemoveProject,
  isRemoving,
}: {
  kit: MenuKit;
  projectViewKey: string;
  settingsTarget: { serverId: string; projectId: string } | null;
  onRemoveProject: () => void;
  isRemoving: boolean;
}) {
  const { t } = useTranslation();
  const openSettings = useCallback(() => {
    if (settingsTarget)
      router.navigate(buildProjectSettingsRoute(settingsTarget.serverId, settingsTarget.projectId));
  }, [settingsTarget]);
  return (
    <>
      {settingsTarget ? (
        <kit.Item
          onSelect={openSettings}
          data-testid={`sidebar-project-menu-open-settings-${projectViewKey}`}
        >
          <Settings />
          {t("sidebar.project.actions.openSettings")}
        </kit.Item>
      ) : null}
      <kit.Item
        onSelect={onRemoveProject}
        disabled={isRemoving}
        data-testid={`sidebar-project-menu-remove-${projectViewKey}`}
      >
        {isRemoving ? <Spinner /> : <Trash2 />}
        {isRemoving ? t("sidebar.project.actions.removing") : t("sidebar.project.actions.remove")}
      </kit.Item>
    </>
  );
}

function NewWorkspaceAction({
  projectViewKey,
  displayName,
  showShortcutHint,
  besideKebab,
  onPress,
}: {
  projectViewKey: string;
  displayName: string;
  showShortcutHint: boolean;
  besideKebab: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const keys = useShortcutKeys("new-worktree");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <SidebarMenuAction
          showOnHover
          aria-label={t("sidebar.workspace.actions.createWorkspaceFor", {
            projectName: displayName,
          })}
          data-testid={`sidebar-project-new-worktree-${projectViewKey}`}
          // Hover-revealed: not a Tab stop (docs/hover.md).
          tabIndex={-1}
          // SidebarMenuAction holds one slot at the row's end; a second action sits one slot in.
          className={besideKebab ? "right-7" : undefined}
          onClick={onPress}
        >
          <Plus />
        </SidebarMenuAction>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {t("sidebar.workspace.actions.newWorkspace")}
        {showShortcutHint ? <Shortcut chord={keys} /> : null}
      </TooltipContent>
    </Tooltip>
  );
}

interface ProjectHeaderRowProps {
  project: SidebarProjectEntry;
  displayName: string;
  nameCue: string | null;
  iconDataUri: string | null;
  hostLabelByServerId: ReadonlyMap<string, string>;
  worktreeTarget: SidebarProjectHostTarget | null;
  isProjectActive: boolean;
  onWorkspacePress?: () => void;
  isRemoving: boolean;
  onRemoveProject?: () => void;
  sortable?: SortableItemProps;
}

function ProjectHeaderRow({
  project,
  displayName,
  nameCue,
  iconDataUri,
  hostLabelByServerId,
  worktreeTarget,
  isProjectActive,
  onWorkspacePress,
  isRemoving,
  onRemoveProject,
  sortable,
}: ProjectHeaderRowProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const settingsTarget = project.hosts[0] ?? null;
  const pathLines = useMemo(
    () => buildProjectRowPathLines({ project, hostLabelByServerId }),
    [project, hostLabelByServerId],
  );
  const beginWorkspaceSetup = useCallback(() => {
    if (!worktreeTarget) return;
    onWorkspacePress?.();
    router.navigate(
      buildNewWorkspaceRoute({
        serverId: worktreeTarget.serverId,
        sourceDirectory: worktreeTarget.iconWorkingDir,
        displayName,
        projectId: worktreeTarget.projectId,
      }),
    );
  }, [displayName, onWorkspacePress, worktreeTarget]);

  const actionCount = (worktreeTarget ? 1 : 0) + (onRemoveProject ? 1 : 0);
  const row = (
    <SidebarMenuButton
      ref={sortable?.handle.ref}
      {...sortable?.handle.listeners}
      data-testid={`sidebar-project-row-${project.viewKey}`}
      className={cn(
        // Room for both actions; shadcn's menu button keeps room for one.
        actionCount > 1 && "group-has-data-[sidebar=menu-action]/menu-item:pr-14",
        sortable?.isDragging && "bg-sidebar shadow-md",
      )}
    >
      <ProjectLeadingVisual
        displayName={displayName}
        iconDataUri={iconDataUri}
        projectViewKey={project.viewKey}
        isArchiving={isRemoving}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="truncate font-medium">{displayName}</span>
            {nameCue ? (
              <span
                className="truncate text-xs leading-[14px] text-muted-foreground"
                data-testid={`sidebar-project-name-cue-${project.viewKey}`}
              >
                {nameCue}
              </span>
            ) : null}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          <span className="flex flex-col" data-testid={`sidebar-project-path-${project.viewKey}`}>
            {pathLines.map((line) => (
              <span key={line.serverId} className="line-clamp-2">
                {line.text}
              </span>
            ))}
          </span>
        </TooltipContent>
      </Tooltip>
    </SidebarMenuButton>
  );

  const rowWithContextMenu = onRemoveProject ? (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent
        className="w-[220px]"
        data-testid={`sidebar-project-context-menu-${project.viewKey}`}
      >
        <ProjectMenuItems
          kit={contextMenuKit}
          projectViewKey={project.viewKey}
          settingsTarget={settingsTarget}
          onRemoveProject={onRemoveProject}
          isRemoving={isRemoving}
        />
      </ContextMenuContent>
    </ContextMenu>
  ) : (
    row
  );

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {rowWithContextMenu}
        {worktreeTarget ? (
          <NewWorkspaceAction
            projectViewKey={project.viewKey}
            displayName={displayName}
            showShortcutHint={isProjectActive}
            besideKebab={onRemoveProject !== undefined}
            onPress={beginWorkspaceSetup}
          />
        ) : null}
        {onRemoveProject ? (
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <SidebarMenuAction
                showOnHover
                aria-label={t("sidebar.project.actions.menu")}
                data-testid={`sidebar-project-kebab-${project.viewKey}`}
              >
                <EllipsisVertical />
              </SidebarMenuAction>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[220px]">
              <ProjectMenuItems
                kit={dropdownMenuKit}
                projectViewKey={project.viewKey}
                settingsTarget={settingsTarget}
                onRemoveProject={onRemoveProject}
                isRemoving={isRemoving}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export interface ProjectBlockProps {
  project: SidebarProjectEntry;
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  iconDataUri: string | null;
  selectionEnabled: boolean;
  activeWorkspaceSelection: ActiveWorkspaceSelection | null;
  showShortcutBadges: boolean;
  shortcutIndexByWorkspaceKey: Map<string, number>;
  hostBadgeByServerId: ReadonlyMap<string, HostBadgeModel>;
  autoHostLabelProjectKeys: ReadonlySet<string>;
  hostLabelByServerId: ReadonlyMap<string, string>;
  projectNameCueByViewKey: ReadonlyMap<string, string>;
  supportsMultiplicityByServerId: ReadonlyMap<string, boolean>;
  supportsPinningByServerId: ReadonlyMap<string, boolean>;
  preferredServerIdsByProjectViewKey: ReadonlyMap<string, readonly string[]>;
  onToggleWorkspacePin: ToggleSidebarWorkspacePin;
  onWorkspacePress?: () => void;
  onWorkspaceReorder: (projectViewKey: string, workspaces: SidebarWorkspacePlacement[]) => void;
  sortable?: SortableItemProps;
}

const workspaceKeyOf = (workspace: SidebarWorkspacePlacement) => workspace.workspaceKey;

/** A project and its workspaces (the Expo app's ProjectBlock). */
export const ProjectBlock = memo(function ProjectBlock({
  project,
  workspaceEntriesByKey,
  iconDataUri,
  selectionEnabled,
  activeWorkspaceSelection,
  showShortcutBadges,
  shortcutIndexByWorkspaceKey,
  hostBadgeByServerId,
  autoHostLabelProjectKeys,
  hostLabelByServerId,
  projectNameCueByViewKey,
  supportsMultiplicityByServerId,
  supportsPinningByServerId,
  preferredServerIdsByProjectViewKey,
  onToggleWorkspacePin,
  onWorkspacePress,
  onWorkspaceReorder,
  sortable,
}: ProjectBlockProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const displayName = project.projectName;
  const { visibleItems, expanded, canToggle, toggleExpanded } = useLimitedSidebarGroup(
    project.workspaces,
  );
  const rowModel = useMemo(
    () =>
      buildSidebarProjectRowModel({
        project,
        supportsMultiplicityByServerId,
        preferredServerIds: preferredServerIdsByProjectViewKey.get(project.viewKey),
      }),
    [project, supportsMultiplicityByServerId, preferredServerIdsByProjectViewKey],
  );
  const isFixedActionRow = isHomeProjectViewKey(project.viewKey);
  const isProjectActive =
    selectionEnabled &&
    project.workspaces.some(
      (workspace) =>
        workspace.serverId === activeWorkspaceSelection?.serverId &&
        workspace.workspaceId === activeWorkspaceSelection.workspaceId,
    );
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeModalOpen, setRemoveModalOpen] = useState(false);
  const closeRemoveModal = useCallback(() => setRemoveModalOpen(false), []);

  const removeProject = useCallback(() => {
    if (isRemoving) return;
    if (project.hosts.length > 1) {
      setRemoveModalOpen(true);
      return;
    }
    void (async () => {
      const confirmed = await confirmDialog({
        title: t("sidebar.project.confirmations.removeTitle"),
        message: t("sidebar.project.confirmations.removeMessage", { projectName: displayName }),
        confirmLabel: t("sidebar.project.confirmations.removeConfirm"),
        cancelLabel: t("sidebar.project.confirmations.cancel"),
        destructive: true,
      });
      if (!confirmed) return;
      setIsRemoving(true);
      const readiness = getCurrentProjectRemoveReadiness({ hosts: project.hosts });
      if (readiness.kind === "needs_host_update") {
        toast.error(t("sidebar.project.toasts.updateHostToRemove"));
        setIsRemoving(false);
        return;
      }
      try {
        const outcome = await removeProjectFromHosts({
          targets: readiness.targets,
          getClient: (serverId) => getHostRuntimeStore().getClient(serverId),
        });
        if (outcome.kind === "host_disconnected")
          toast.error(t("sidebar.project.toasts.hostDisconnected"));
        else if (outcome.kind === "failed") toast.error(t("sidebar.project.toasts.removeFailed"));
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("sidebar.project.toasts.removeFailed"),
        );
      } finally {
        setIsRemoving(false);
      }
    })();
  }, [displayName, isRemoving, project.hosts, t, toast]);

  const renderWorkspace = useCallback(
    (item: SidebarWorkspacePlacement, rowSortable?: SortableItemProps) => {
      const entry = workspaceEntriesByKey.get(item.workspaceKey);
      if (!entry) return null;
      return (
        <WorkspaceRow
          key={item.workspaceKey}
          workspace={entry}
          hostBadge={resolveProjectHostBadge({
            badge: hostBadgeByServerId.get(item.serverId),
            showAutoLabel: autoHostLabelProjectKeys.has(item.projectViewKey),
          })}
          selected={isWorkspaceSelected({
            selection: activeWorkspaceSelection,
            serverId: item.serverId,
            workspaceId: item.workspaceId,
            enabled: selectionEnabled,
          })}
          shortcutNumber={shortcutIndexByWorkspaceKey.get(item.workspaceKey) ?? null}
          showShortcutBadge={showShortcutBadges}
          canCopyBranchName={project.projectKind === "git"}
          canPin={supportsPinningByServerId.get(item.serverId) === true}
          onToggleWorkspacePin={onToggleWorkspacePin}
          onWorkspacePress={onWorkspacePress}
          sortable={rowSortable}
        />
      );
    },
    [
      activeWorkspaceSelection,
      autoHostLabelProjectKeys,
      hostBadgeByServerId,
      onToggleWorkspacePin,
      onWorkspacePress,
      project.projectKind,
      selectionEnabled,
      shortcutIndexByWorkspaceKey,
      showShortcutBadges,
      supportsPinningByServerId,
      workspaceEntriesByKey,
    ],
  );

  const handleReorder = useCallback(
    (workspaces: SidebarWorkspacePlacement[]) => onWorkspaceReorder(project.viewKey, workspaces),
    [onWorkspaceReorder, project.viewKey],
  );

  return (
    <div
      ref={sortable?.nodeRef}
      style={sortable?.style}
      role="group"
      aria-label={displayName}
      // The gap to the next project belongs to a block that has rows under its header.
      className={cn("flex flex-col", project.workspaces.length > 0 && "pb-3")}
    >
      <ProjectHeaderRow
        project={project}
        displayName={displayName}
        nameCue={projectNameCueByViewKey.get(project.viewKey) ?? null}
        iconDataUri={iconDataUri}
        hostLabelByServerId={hostLabelByServerId}
        worktreeTarget={
          !isFixedActionRow && rowModel.trailingAction.kind === "new_workspace"
            ? rowModel.trailingAction.target
            : null
        }
        isProjectActive={isProjectActive}
        onWorkspacePress={onWorkspacePress}
        isRemoving={isRemoving}
        onRemoveProject={isFixedActionRow ? undefined : removeProject}
        sortable={sortable}
      />
      {project.workspaces.length > 0 ? (
        <>
          <SidebarMenu data-testid={`sidebar-workspace-list-${project.viewKey}`}>
            <SortableList
              items={visibleItems}
              getId={workspaceKeyOf}
              onReorder={handleReorder}
              render={renderWorkspace}
            />
          </SidebarMenu>
          {canToggle ? (
            <ShowMoreRow
              expanded={expanded}
              onToggle={toggleExpanded}
              testId={`sidebar-project-show-more-${project.viewKey}`}
            />
          ) : null}
        </>
      ) : null}
      {project.hosts.length > 1 ? (
        <ProjectRemoveModal
          visible={removeModalOpen}
          projectName={displayName}
          projectViewKey={project.viewKey}
          hosts={project.hosts}
          onClose={closeRemoveModal}
        />
      ) : null}
    </div>
  );
});
