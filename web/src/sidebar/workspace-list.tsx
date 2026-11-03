import { SidebarGroupLabel } from "~/components/ui/sidebar";
import { useCallback, useMemo, useRef, type ReactNode } from "react";
import {
  CircleAlert,
  CircleCheck,
  CircleDot,
  CircleX,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useLocation } from "react-router";
import { isHomeProjectViewKey } from "@/chief/home-workspace";
import { useSidebarRowItems } from "@/components/sidebar/display-preferences/model";
import type { SidebarWorkspaceGroup } from "@/components/sidebar/sidebar-labels";
import { useLimitedSidebarGroup } from "@/components/sidebar/use-limited-sidebar-group";
import type { HostBadgeModel } from "@/hosts/appearance";
import { useHostBadges } from "@/hosts/use-host-badges";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useSettings } from "@/hooks/use-settings";
import { useShowShortcutBadges } from "@/hooks/use-show-shortcut-badges";
import type { PinnedSidebarGroups } from "@/hooks/use-sidebar-pins";
import {
  useSidebarWorkspacePinController,
  type ToggleSidebarWorkspacePin,
} from "@/hooks/use-sidebar-workspace-pin";
import {
  resolveProjectHostBadge,
  shouldShowProjectHostLabels,
  type SidebarProjectEntry,
  type SidebarWorkspaceEntry,
  type SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import { useProjectIcons } from "@/projects/icons";
import { useHostFeatureMap } from "@/runtime/host-features";
import { useHostRuntimeConnectionStatuses, useHosts } from "@/runtime/host-runtime";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import {
  hasActiveSidebarLabelFilter,
  useSidebarViewStore,
  type SidebarGroupMode,
} from "@/stores/sidebar-view-store";
import { parseHostWorkspaceRouteFromPathname } from "@/utils/host-routes";
import { buildProjectRowCues } from "@/utils/project-row-cue";
import { hasVisibleOrderChanged, mergeWithRemainder } from "@/utils/sidebar-reorder";
import {
  buildPreferredServerIdsByProjectViewKey,
  isSamePreferredServerIds,
  type SidebarProjectIconTarget,
} from "@/utils/sidebar-project-row-model";
import type { StatusBucket } from "@/hooks/sidebar-status-view-model";
import { SortableList, type SortableItemProps } from "~/components/sortable-list";
import { SidebarMenu } from "~/components/ui/sidebar";
import { isWorkspaceSelected, ProjectBlock } from "~/sidebar/project-block";
import {
  PinnedSectionHeader,
  ShowMoreRow,
  SidebarFilterEmptyState,
  SidebarProjectEmptyState,
} from "~/sidebar/list-parts";
import { WorkspacesSectionHeader } from "~/sidebar/section-header";
import { WorkspaceRow } from "~/sidebar/workspace-row";

/** Everything a row needs that is the same for every row in the list. */
interface ListContext {
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  projectIconByProjectViewKey: ReadonlyMap<string, string | null>;
  shortcutIndexByWorkspaceKey: Map<string, number>;
  showShortcutBadges: boolean;
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
  /**
   * Whether a row may show as selected. Project mode only marks it on a workspace route; the
   * status grouping marks the active workspace anywhere, as the Expo app does.
   */
  selectionEnabled: boolean;
}

/** A workspace shown away from its project row (pinned, or grouped by status): the project leads the row. */
function DetachedWorkspaceRow({
  workspace,
  context,
  inStatusGroup,
  sortable,
}: {
  workspace: SidebarWorkspaceEntry;
  context: ListContext;
  inStatusGroup: boolean;
  sortable?: SortableItemProps;
}) {
  const selection = useActiveWorkspaceSelection();
  return (
    <WorkspaceRow
      workspace={workspace}
      hostBadge={resolveProjectHostBadge({
        badge: context.hostBadgeByServerId.get(workspace.serverId),
        showAutoLabel: context.autoHostLabelProjectKeys.has(workspace.projectViewKey),
      })}
      leadingProjectName={workspace.projectName}
      leadingProjectNameCue={context.projectNameCueByViewKey.get(workspace.projectViewKey) ?? null}
      leadingProjectIconDataUri={
        context.projectIconByProjectViewKey.get(workspace.projectViewKey) ?? null
      }
      selected={isWorkspaceSelected({
        selection,
        serverId: workspace.serverId,
        workspaceId: workspace.workspaceId,
        enabled: context.selectionEnabled,
      })}
      shortcutNumber={context.shortcutIndexByWorkspaceKey.get(workspace.workspaceKey) ?? null}
      showShortcutBadge={context.showShortcutBadges}
      canCopyBranchName={workspace.projectKind === "git"}
      canPin={context.supportsPinningByServerId.get(workspace.serverId) === true}
      onToggleWorkspacePin={context.onToggleWorkspacePin}
      onWorkspacePress={context.onWorkspacePress}
      allowRenameWithAgent={!inStatusGroup}
      sortable={sortable}
    />
  );
}

const workspaceKeyOf = (workspace: { workspaceKey: string }) => workspace.workspaceKey;
const projectKeyOf = (project: SidebarProjectEntry) => project.viewKey;

function PinnedSection({
  workspaces,
  context,
  inStatusGroup,
  onReorder,
}: {
  workspaces: SidebarWorkspaceEntry[];
  context: ListContext;
  inStatusGroup: boolean;
  onReorder: (workspaces: SidebarWorkspacePlacement[]) => void;
}) {
  const collapsed = useSidebarCollapsedSectionsStore((state) => state.collapsedPinned);
  const toggleCollapsed = useSidebarCollapsedSectionsStore((state) => state.togglePinnedCollapsed);
  const { visibleItems, expanded, canToggle, toggleExpanded } = useLimitedSidebarGroup(workspaces);
  const renderRow = useCallback(
    (workspace: SidebarWorkspaceEntry, sortable: SortableItemProps) => (
      <DetachedWorkspaceRow
        key={workspace.workspaceKey}
        workspace={workspace}
        context={context}
        inStatusGroup={inStatusGroup}
        sortable={sortable}
      />
    ),
    [context, inStatusGroup],
  );
  if (workspaces.length === 0) return null;
  return (
    <div className="flex flex-col pb-2" data-testid="sidebar-pinned-section">
      <PinnedSectionHeader collapsed={collapsed} onToggle={toggleCollapsed} />
      {collapsed ? null : (
        <>
          <SidebarMenu data-testid="sidebar-pinned-list">
            <SortableList
              items={visibleItems}
              getId={workspaceKeyOf}
              onReorder={onReorder}
              render={renderRow}
            />
          </SidebarMenu>
          {canToggle ? (
            <ShowMoreRow
              expanded={expanded}
              onToggle={toggleExpanded}
              testId="sidebar-pinned-show-more"
            />
          ) : null}
        </>
      )}
    </div>
  );
}

const STATUS_GROUP_ICON: Record<StatusBucket, ReactNode> = {
  needs_input: <CircleAlert className="size-3.5 text-status-dot-warning" />,
  failed: <CircleX className="size-3.5 text-status-dot-danger" />,
  attention: <CircleCheck className="size-3.5 text-status-dot-success" />,
  running: <CircleDot className="size-3.5 text-status-dot-running" />,
  done: <CircleCheck className="size-3.5 text-muted-foreground" />,
};

function StatusGroupHeader({
  group,
  collapsed,
}: {
  group: SidebarWorkspaceGroup;
  collapsed: boolean;
}) {
  const toggle = useSidebarCollapsedSectionsStore((state) => state.toggleWorkspaceGroupCollapsed);
  const handleClick = useCallback(() => toggle(group.key), [group.key, toggle]);
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <SidebarGroupLabel asChild>
      <button
        type="button"
        onClick={handleClick}
        aria-label={`${group.label} group`}
        aria-expanded={!collapsed}
        data-testid={`sidebar-status-group-${group.key}`}
        className="group/status-group"
      >
        <span className="mr-2 flex size-4 items-center justify-center">
          <span className="group-hover/status-group:hidden">
            {STATUS_GROUP_ICON[group.leading.bucket]}
          </span>
          <Chevron className="hidden group-hover/status-group:block" />
        </span>
        {group.label}
      </button>
    </SidebarGroupLabel>
  );
}

function StatusGroup({ group, context }: { group: SidebarWorkspaceGroup; context: ListContext }) {
  const collapsed = useSidebarCollapsedSectionsStore((state) =>
    state.collapsedWorkspaceGroupKeys.has(group.key),
  );
  const { visibleItems, expanded, canToggle, toggleExpanded } = useLimitedSidebarGroup(group.rows);
  return (
    <div className="flex flex-col pb-2">
      <StatusGroupHeader group={group} collapsed={collapsed} />
      {collapsed ? null : (
        <>
          <SidebarMenu data-testid={`sidebar-status-group-rows-${group.key}`}>
            {visibleItems.map((workspace) => (
              <DetachedWorkspaceRow
                key={workspace.workspaceKey}
                workspace={workspace}
                context={context}
                inStatusGroup
              />
            ))}
          </SidebarMenu>
          {canToggle ? (
            <ShowMoreRow
              expanded={expanded}
              onToggle={toggleExpanded}
              testId={`sidebar-status-group-show-more-${group.key}`}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function ProjectBlockItem({
  project,
  context,
  sortable,
}: {
  project: SidebarProjectEntry;
  context: ListContext;
  sortable?: SortableItemProps;
}) {
  const activeWorkspaceSelection = useActiveWorkspaceSelection();
  return (
    <ProjectBlock
      project={project}
      workspaceEntriesByKey={context.workspaceEntriesByKey}
      iconDataUri={context.projectIconByProjectViewKey.get(project.viewKey) ?? null}
      selectionEnabled={context.selectionEnabled}
      activeWorkspaceSelection={activeWorkspaceSelection}
      showShortcutBadges={context.showShortcutBadges}
      shortcutIndexByWorkspaceKey={context.shortcutIndexByWorkspaceKey}
      hostBadgeByServerId={context.hostBadgeByServerId}
      autoHostLabelProjectKeys={context.autoHostLabelProjectKeys}
      hostLabelByServerId={context.hostLabelByServerId}
      projectNameCueByViewKey={context.projectNameCueByViewKey}
      supportsMultiplicityByServerId={context.supportsMultiplicityByServerId}
      supportsPinningByServerId={context.supportsPinningByServerId}
      preferredServerIdsByProjectViewKey={context.preferredServerIdsByProjectViewKey}
      onToggleWorkspacePin={context.onToggleWorkspacePin}
      onWorkspacePress={context.onWorkspacePress}
      onWorkspaceReorder={context.onWorkspaceReorder}
      sortable={sortable}
    />
  );
}

/** Chief's Home project stays first; the rest reorder by dragging. */
function ProjectList({
  projects,
  context,
  onReorder,
}: {
  projects: SidebarProjectEntry[];
  context: ListContext;
  onReorder: (projects: SidebarProjectEntry[]) => void;
}) {
  const homeProject = projects.find((project) => isHomeProjectViewKey(project.viewKey));
  const draggableProjects = useMemo(
    () => projects.filter((project) => !isHomeProjectViewKey(project.viewKey)),
    [projects],
  );
  const renderProject = useCallback(
    (project: SidebarProjectEntry, sortable: SortableItemProps) => (
      <ProjectBlockItem
        key={project.viewKey}
        project={project}
        context={context}
        sortable={sortable}
      />
    ),
    [context],
  );
  return (
    <div className="flex flex-col px-2" data-testid="sidebar-project-list">
      {homeProject ? <ProjectBlockItem project={homeProject} context={context} /> : null}
      <SortableList
        items={draggableProjects}
        getId={projectKeyOf}
        onReorder={onReorder}
        render={renderProject}
      />
    </div>
  );
}

export interface SidebarWorkspaceListProps {
  workspaceGroups: SidebarWorkspaceGroup[];
  projectIconTargets: SidebarProjectIconTarget[];
  pinnedGroups: PinnedSidebarGroups;
  projects: SidebarProjectEntry[];
  hasProjectsBeforeFilter: boolean;
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  shortcutIndexByWorkspaceKey: Map<string, number>;
  groupMode: SidebarGroupMode;
  onWorkspacePress?: () => void;
  onAddProject?: () => void;
  onImportSession?: () => void;
}

function useSidebarOrdering() {
  const getProjectOrder = useSidebarOrderStore((state) => state.getProjectOrder);
  const setProjectOrder = useSidebarOrderStore((state) => state.setProjectOrder);
  const getWorkspaceOrder = useSidebarOrderStore((state) => state.getWorkspaceOrder);
  const setWorkspaceOrder = useSidebarOrderStore((state) => state.setWorkspaceOrder);
  const getPinnedWorkspaceOrder = useSidebarOrderStore((state) => state.getPinnedWorkspaceOrder);
  const setPinnedWorkspaceOrder = useSidebarOrderStore((state) => state.setPinnedWorkspaceOrder);
  const reorder = useCallback(
    (currentOrder: string[], reorderedVisibleKeys: string[], save: (order: string[]) => void) => {
      if (!hasVisibleOrderChanged({ currentOrder, reorderedVisibleKeys })) return;
      save(mergeWithRemainder({ currentOrder, reorderedVisibleKeys }));
    },
    [],
  );
  const onProjectReorder = useCallback(
    (reordered: SidebarProjectEntry[]) =>
      reorder(getProjectOrder(), reordered.map(projectKeyOf), setProjectOrder),
    [getProjectOrder, reorder, setProjectOrder],
  );
  const onWorkspaceReorder = useCallback(
    (projectViewKey: string, reordered: SidebarWorkspacePlacement[]) =>
      reorder(getWorkspaceOrder(projectViewKey), reordered.map(workspaceKeyOf), (order) =>
        setWorkspaceOrder(projectViewKey, order),
      ),
    [getWorkspaceOrder, reorder, setWorkspaceOrder],
  );
  const onPinnedReorder = useCallback(
    (reordered: SidebarWorkspacePlacement[]) =>
      reorder(getPinnedWorkspaceOrder(), reordered.map(workspaceKeyOf), setPinnedWorkspaceOrder),
    [getPinnedWorkspaceOrder, reorder, setPinnedWorkspaceOrder],
  );
  return { onProjectReorder, onWorkspaceReorder, onPinnedReorder };
}

/** The per-host lookups every row reads, built once for the list. */
function useHostLookups(projects: SidebarProjectEntry[]) {
  const hosts = useHosts();
  const rowItems = useSidebarRowItems();
  const hostLabelByServerId = useMemo(
    () => new Map(hosts.map((host) => [host.serverId, host.label.trim() || host.serverId])),
    [hosts],
  );
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const hostConnectionStatusByServerId = useHostRuntimeConnectionStatuses(serverIds);
  const localServerId = useLocalDaemonServerId();
  const defaultHostByProject = useSettings((settings) => settings.defaultHostByProject);
  const preferredRef = useRef(new Map<string, string[]>());
  const preferredServerIdsByProjectViewKey = useMemo(() => {
    const next = buildPreferredServerIdsByProjectViewKey({
      projects,
      defaultHostByProject,
      hostConnectionStatusByServerId,
      localServerId,
    });
    if (isSamePreferredServerIds(preferredRef.current, next)) return preferredRef.current;
    preferredRef.current = next;
    return next;
  }, [projects, defaultHostByProject, hostConnectionStatusByServerId, localServerId]);
  return {
    hostLabelByServerId,
    hostBadgeByServerId: useHostBadges({ enabled: rowItems.host }),
    supportsMultiplicityByServerId: useHostFeatureMap(serverIds, "workspaceMultiplicity"),
    supportsPinningByServerId: useHostFeatureMap(serverIds, "workspacePinning"),
    preferredServerIdsByProjectViewKey,
  };
}

/** The Expo app's SidebarWorkspaceList: pinned workspaces, the Workspaces header, then projects (or status groups). */
export function SidebarWorkspaceList({
  workspaceGroups,
  projectIconTargets,
  pinnedGroups,
  projects,
  hasProjectsBeforeFilter,
  workspaceEntriesByKey,
  shortcutIndexByWorkspaceKey,
  groupMode,
  onWorkspacePress,
  onAddProject,
  onImportSession,
}: SidebarWorkspaceListProps) {
  const { pathname } = useLocation();
  const showShortcutBadges = useShowShortcutBadges();
  const lookups = useHostLookups(projects);
  const autoHostLabelProjectKeys = useMemo(
    () => new Set(projects.filter(shouldShowProjectHostLabels).map((project) => project.viewKey)),
    [projects],
  );
  const { hostLabelByServerId } = lookups;
  const projectNameCueByViewKey = useMemo(
    () => buildProjectRowCues({ projects, hostLabelByServerId }),
    [projects, hostLabelByServerId],
  );
  const onToggleWorkspacePin = useSidebarWorkspacePinController();
  const projectIconByProjectViewKey = useProjectIcons({ projects: projectIconTargets });
  const hasActiveLabelFilter = useSidebarViewStore((state) =>
    hasActiveSidebarLabelFilter(state.labelFilter),
  );
  const sidebarFilterEmpty =
    hasActiveLabelFilter && hasProjectsBeforeFilter && projects.length === 0;
  const { onProjectReorder, onWorkspaceReorder, onPinnedReorder } = useSidebarOrdering();
  const isProjectMode = groupMode === "project";
  const selectionEnabled = !isProjectMode || parseHostWorkspaceRouteFromPathname(pathname) !== null;

  const context = useMemo<ListContext>(
    () => ({
      ...lookups,
      workspaceEntriesByKey,
      projectIconByProjectViewKey,
      shortcutIndexByWorkspaceKey,
      showShortcutBadges,
      autoHostLabelProjectKeys,
      projectNameCueByViewKey,
      onToggleWorkspacePin,
      onWorkspacePress,
      onWorkspaceReorder,
      selectionEnabled,
    }),
    [
      autoHostLabelProjectKeys,
      lookups,
      onToggleWorkspacePin,
      onWorkspacePress,
      onWorkspaceReorder,
      projectIconByProjectViewKey,
      projectNameCueByViewKey,
      selectionEnabled,
      shortcutIndexByWorkspaceKey,
      showShortcutBadges,
      workspaceEntriesByKey,
    ],
  );

  const pinnedWorkspaces = useMemo(
    () =>
      pinnedGroups.pinnedChats.flatMap((placement) => {
        const entry = workspaceEntriesByKey.get(placement.workspaceKey);
        return entry ? [entry] : [];
      }),
    [pinnedGroups.pinnedChats, workspaceEntriesByKey],
  );

  let body: ReactNode;
  if (sidebarFilterEmpty) {
    body = <SidebarFilterEmptyState />;
  } else if (!isProjectMode) {
    body = (
      <div className="flex flex-col px-2" data-testid="sidebar-status-list">
        {workspaceGroups.map((group) => (
          <StatusGroup key={group.key} group={group} context={context} />
        ))}
      </div>
    );
  } else if (projects.length === 0) {
    body = (
      <SidebarProjectEmptyState onAddProject={onAddProject} onImportSession={onImportSession} />
    );
  } else {
    body = (
      <ProjectList
        projects={pinnedGroups.unpinnedProjects}
        context={context}
        onReorder={onProjectReorder}
      />
    );
  }
  return (
    <>
      <div className="px-2">
        <PinnedSection
          workspaces={pinnedWorkspaces}
          context={context}
          inStatusGroup={!isProjectMode}
          onReorder={onPinnedReorder}
        />
      </div>
      <WorkspacesSectionHeader onBeforeNavigate={onWorkspacePress} />
      {body}
    </>
  );
}
