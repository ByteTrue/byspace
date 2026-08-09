import type { WorkspaceDescriptor } from "@/stores/session-store";
import type {
  WorkspaceStructureHostPlacement,
  WorkspaceStructureProject,
} from "@/projects/workspace-structure";

export interface HostProjectListItem {
  projectKey: string;
  projectName: string;
  projectKind: WorkspaceDescriptor["projectKind"];
  iconWorkingDir: string;
  hosts: WorkspaceStructureHostPlacement[];
  workspaceKeys: string[];
}

export interface HostProjectRouteContext {
  serverId: string;
  projectId?: string;
  displayName?: string;
  sourceDirectory?: string;
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}

export function canCreateWorktreeForProjectKind(
  projectKind: WorkspaceDescriptor["projectKind"],
): boolean {
  return projectKind === "git";
}

export function buildHostProjectList(input: {
  projects: readonly WorkspaceStructureProject[];
}): HostProjectListItem[] {
  return input.projects.map((project) => ({
    projectKey: project.projectKey,
    projectName: project.projectName,
    projectKind: project.projectKind,
    iconWorkingDir: project.iconWorkingDir,
    hosts: project.hosts,
    workspaceKeys: project.workspaceKeys,
  }));
}

export function hostProjectFromRoute(route: HostProjectRouteContext): HostProjectListItem | null {
  const projectKey = trimOptional(route.projectId);
  const iconWorkingDir = trimOptional(route.sourceDirectory);
  if (!projectKey || !iconWorkingDir) {
    return null;
  }
  return {
    projectKey,
    projectName: trimOptional(route.displayName) ?? projectKey,
    projectKind: "git",
    iconWorkingDir,
    hosts: [
      {
        serverId: route.serverId,
        projectId: projectKey,
        iconWorkingDir,
        canCreateWorktree: true,
      },
    ],
    workspaceKeys: [],
  };
}

export function getHostProjectSourceDirectory(
  project: HostProjectListItem,
  serverId: string,
): string | null {
  return project.hosts.find((host) => host.serverId === serverId)?.iconWorkingDir ?? null;
}

export function getHostProjectId(project: HostProjectListItem, serverId: string): string | null {
  return project.hosts.find((host) => host.serverId === serverId)?.projectId ?? null;
}

export function resolveHostProjectWorkspaceIdentity(
  project: Pick<HostProjectListItem, "hosts">,
  workspaceKey: string,
): { serverId: string; workspaceId: string } | null {
  const hostsByLongestPrefix = [...project.hosts].sort(
    (left, right) => right.serverId.length - left.serverId.length,
  );
  for (const host of hostsByLongestPrefix) {
    const prefix = `${host.serverId}:`;
    if (!workspaceKey.startsWith(prefix)) continue;
    const workspaceId = workspaceKey.slice(prefix.length);
    if (workspaceId) return { serverId: host.serverId, workspaceId };
  }
  return null;
}

export function getWorkspaceCreationHosts(input: {
  project: Pick<HostProjectListItem, "hosts">;
  workspaceMultiplicityByServerId: ReadonlyMap<string, boolean>;
}): WorkspaceStructureHostPlacement[] {
  return input.project.hosts.filter(
    (host) =>
      host.canCreateWorktree || input.workspaceMultiplicityByServerId.get(host.serverId) === true,
  );
}

function hydrateHostLocalProject(
  candidate: HostProjectListItem,
  projects: readonly HostProjectListItem[],
): HostProjectListItem {
  return (
    projects.find((project) =>
      candidate.hosts.some((candidateHost) =>
        project.hosts.some(
          (host) =>
            host.serverId === candidateHost.serverId && host.projectId === candidateHost.projectId,
        ),
      ),
    ) ?? candidate
  );
}

export function resolveSelectedHostProject(input: {
  selectedProjectKey: string | null;
  projects: readonly HostProjectListItem[];
  routeProject: HostProjectListItem | null;
}): HostProjectListItem | null {
  const selectedProjectKey = input.selectedProjectKey;
  if (!selectedProjectKey?.trim()) {
    return null;
  }

  const selected = input.projects.find((project) => project.projectKey === selectedProjectKey);
  if (selected) return selected;
  if (input.routeProject?.projectKey === selectedProjectKey) {
    return hydrateHostLocalProject(input.routeProject, input.projects);
  }
  return null;
}
