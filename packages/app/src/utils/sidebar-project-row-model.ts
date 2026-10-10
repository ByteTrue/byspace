import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import { createProjectIconTarget, type ProjectIconTarget } from "@/projects/icon-target";

export interface SidebarProjectHostTarget {
  serverId: string;
  projectId: string;
  iconWorkingDir: string;
  customIconRevision?: string | null;
  iconRevision?: string;
}

export type SidebarProjectTrailingAction =
  | { kind: "new_workspace"; target: SidebarProjectHostTarget }
  | { kind: "none" };

export interface SidebarProjectSectionRowModel {
  kind: "project_section";
  trailingAction: SidebarProjectTrailingAction;
}

export type SidebarProjectRowModel = SidebarProjectSectionRowModel;

const EMPTY_MULTIPLICITY_MAP: ReadonlyMap<string, boolean> = new Map();
function hostTarget(input: {
  serverId: string;
  projectId: string;
  iconWorkingDir: string;
  customIconRevision?: string | null;
  iconRevision?: string;
}): SidebarProjectHostTarget | null {
  const iconWorkingDir = input.iconWorkingDir.trim();
  if (!input.serverId || !iconWorkingDir) {
    return null;
  }
  return {
    serverId: input.serverId,
    projectId: input.projectId,
    iconWorkingDir,
    customIconRevision: input.customIconRevision,
    iconRevision: input.iconRevision,
  };
}

export function resolveSidebarProjectIconTarget(
  project: SidebarProjectEntry,
): SidebarProjectHostTarget | null {
  for (const host of project.hosts) {
    const target = hostTarget(host);
    if (target) {
      return target;
    }
  }
  return null;
}

export type SidebarProjectIconTarget = ProjectIconTarget;

export function resolveSidebarProjectIconTargets(
  projects: readonly SidebarProjectEntry[],
): SidebarProjectIconTarget[] {
  return projects.flatMap((project) => {
    const target = resolveSidebarProjectIconTarget(project);
    const iconTarget = target
      ? createProjectIconTarget({ projectViewKey: project.viewKey, placement: target })
      : null;
    return iconTarget ? [iconTarget] : [];
  });
}

export function resolveSidebarProjectLocalPath(
  project: SidebarProjectEntry,
  localServerId: string | null,
): string {
  if (!localServerId) return "";
  return project.hosts.find((host) => host.serverId === localServerId)?.iconWorkingDir.trim() ?? "";
}

// A project can host a brand-new workspace on a host when that host can create a
// git worktree (git projects) OR the host supports running multiple independent
// workspaces per directory (`workspaceMultiplicity`), which is what lets non-git
// directories add a second workspace. Mirrors the gate used by the global "New
// workspace" affordances (use-global-new-workspace-action.ts and left-sidebar's
// SidebarNewWorkspaceHeaderRow): `canCreateWorktree || supportsMultiplicity`.
function resolveNewWorkspaceTarget(
  project: SidebarProjectEntry,
  supportsMultiplicityByServerId: ReadonlyMap<string, boolean>,
  preferredServerIds: readonly string[],
): SidebarProjectHostTarget | null {
  const eligibleHosts = project.hosts.filter(
    (host) =>
      host.worktreeSupport !== "unsupported" ||
      supportsMultiplicityByServerId.get(host.serverId) === true,
  );
  // The trailing action's host becomes the new-workspace route's serverId, and the
  // screen's resolver honors a known route serverId unconditionally — so the 062
  // default-host preference (project pin, then the local daemon host) has to be
  // applied here. A preferred host that does not carry the project is skipped.
  for (const preferredServerId of preferredServerIds) {
    const host = eligibleHosts.find((candidate) => candidate.serverId === preferredServerId);
    const target = host ? hostTarget(host) : null;
    if (target) return target;
  }
  for (const host of eligibleHosts) {
    const target = hostTarget(host);
    if (target) return target;
  }
  return null;
}

function projectTrailingAction(
  project: SidebarProjectEntry,
  supportsMultiplicityByServerId: ReadonlyMap<string, boolean>,
  preferredServerIds: readonly string[],
): SidebarProjectTrailingAction {
  const target = resolveNewWorkspaceTarget(
    project,
    supportsMultiplicityByServerId,
    preferredServerIds,
  );
  return target ? { kind: "new_workspace", target } : { kind: "none" };
}

// Preferred hosts for the sidebar's "+" entry (issue 067): the project's pinned host when
// online, then the local daemon host when online and different. Offline hosts don't count,
// matching the new-workspace screen's stale-pin rule.
export function buildPreferredServerIdsByProjectViewKey(input: {
  projects: ReadonlyArray<{ viewKey: string }>;
  defaultHostByProject: Record<string, string | undefined>;
  hostConnectionStatusByServerId: ReadonlyMap<string, string>;
  localServerId: string | null;
}): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const project of input.projects) {
    const pinnedServerId = input.defaultHostByProject[project.viewKey];
    const preferred: string[] = [];
    if (pinnedServerId && input.hostConnectionStatusByServerId.get(pinnedServerId) === "online") {
      preferred.push(pinnedServerId);
    }
    if (
      input.localServerId &&
      input.localServerId !== pinnedServerId &&
      input.hostConnectionStatusByServerId.get(input.localServerId) === "online"
    ) {
      preferred.push(input.localServerId);
    }
    if (preferred.length > 0) {
      map.set(project.viewKey, preferred);
    }
  }
  return map;
}

// Content equality for the map above. The connection-status hook returns a fresh Map on
// every host-runtime emit (agent output bumps the aggregate version), so the sidebar's
// memo must reuse the previous instance unless a preferred id actually changed —
// otherwise every unrelated emit re-renders the whole project list.
export function isSamePreferredServerIds(
  prev: ReadonlyMap<string, readonly string[]>,
  next: ReadonlyMap<string, readonly string[]>,
): boolean {
  if (prev.size !== next.size) return false;
  for (const [viewKey, ids] of next) {
    const prevIds = prev.get(viewKey);
    if (!prevIds || prevIds.length !== ids.length) return false;
    for (let index = 0; index < ids.length; index++) {
      if (prevIds[index] !== ids[index]) return false;
    }
  }
  return true;
}

export function buildSidebarProjectRowModel(input: {
  project: SidebarProjectEntry;
  supportsMultiplicityByServerId?: ReadonlyMap<string, boolean>;
  /** Hosts tried before project.hosts order: the project's pinned host, then the local daemon host. Callers drop offline ones (issue 062 stale-pin rule). */
  preferredServerIds?: readonly string[];
}): SidebarProjectRowModel {
  return {
    kind: "project_section",
    trailingAction: projectTrailingAction(
      input.project,
      input.supportsMultiplicityByServerId ?? EMPTY_MULTIPLICITY_MAP,
      input.preferredServerIds ?? [],
    ),
  };
}
