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

export function hostProjectFromWorkspace(input: {
  serverId: string;
  workspace: WorkspaceDescriptor | null;
}): HostProjectListItem | null {
  if (!input.workspace) {
    return null;
  }
  const projectKey = input.workspace.projectId.trim();
  const iconWorkingDir = input.workspace.projectRootPath.trim();
  if (!projectKey || !iconWorkingDir) {
    return null;
  }
  const canCreate = canCreateWorktreeForProjectKind(input.workspace.projectKind);
  return {
    projectKey,
    projectName: input.workspace.projectDisplayName || projectKey,
    projectKind: input.workspace.projectKind,
    iconWorkingDir,
    hosts: [
      {
        serverId: input.serverId,
        projectId: input.workspace.projectId,
        iconWorkingDir,
        canCreateWorktree: canCreate,
      },
    ],
    workspaceKeys: [`${input.serverId}:${input.workspace.id}`],
  };
}

function projectCanCreateWorktree(project: HostProjectListItem): boolean {
  return project.hosts.some((h) => h.canCreateWorktree);
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

export function canCreateWorkspaceForHostProject(input: {
  project: HostProjectListItem;
  serverId: string;
  allowAllProjects: boolean;
}): boolean {
  const host = input.project.hosts.find((candidate) => candidate.serverId === input.serverId);
  if (!host) {
    return false;
  }
  return input.allowAllProjects || host.canCreateWorktree;
}

export function filterWorkspaceProjectsForHost(input: {
  projects: readonly HostProjectListItem[];
  serverId: string;
  allowAllProjects: boolean;
}): HostProjectListItem[] {
  return input.projects.filter((project) =>
    canCreateWorkspaceForHostProject({
      project,
      serverId: input.serverId,
      allowAllProjects: input.allowAllProjects,
    }),
  );
}

function hydrateHostLocalProject(
  candidate: HostProjectListItem,
  projects: readonly HostProjectListItem[],
  serverId?: string,
): HostProjectListItem {
  const candidateHosts = serverId
    ? candidate.hosts.filter((host) => host.serverId === serverId)
    : candidate.hosts;
  return (
    projects.find((project) =>
      candidateHosts.some((candidateHost) =>
        project.hosts.some(
          (host) =>
            host.serverId === candidateHost.serverId && host.projectId === candidateHost.projectId,
        ),
      ),
    ) ?? candidate
  );
}

export function resolveInitialWorkspaceProject(input: {
  routeProject: HostProjectListItem | null;
  lastActiveProject: HostProjectListItem | null;
  projects: readonly HostProjectListItem[];
  serverId: string;
  allowAllProjects: boolean;
}): HostProjectListItem | null {
  const candidates = [input.routeProject, input.lastActiveProject];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const hydratedProject = hydrateHostLocalProject(candidate, input.projects, input.serverId);
    if (
      canCreateWorkspaceForHostProject({
        project: hydratedProject,
        serverId: input.serverId,
        allowAllProjects: input.allowAllProjects,
      })
    ) {
      return hydratedProject;
    }
  }

  return input.projects[0] ?? null;
}

export function resolveInitialWorktreeProject(input: {
  routeProject: HostProjectListItem | null;
  lastActiveProject: HostProjectListItem | null;
  projects: readonly HostProjectListItem[];
}): HostProjectListItem | null {
  if (input.routeProject && projectCanCreateWorktree(input.routeProject)) {
    return input.routeProject;
  }
  if (input.lastActiveProject && projectCanCreateWorktree(input.lastActiveProject)) {
    return input.lastActiveProject;
  }
  return input.projects.find((project) => projectCanCreateWorktree(project)) ?? null;
}

export function resolveSelectedHostProject(input: {
  selectedProjectKey: string | null;
  projects: readonly HostProjectListItem[];
  routeProject: HostProjectListItem | null;
  lastActiveProject: HostProjectListItem | null;
}): HostProjectListItem | null {
  const selectedProjectKey = input.selectedProjectKey?.trim() ?? "";
  if (!selectedProjectKey) {
    return null;
  }

  const selected = input.projects.find((project) => project.projectKey === selectedProjectKey);
  if (selected) return selected;
  if (input.routeProject?.projectKey === selectedProjectKey) {
    return hydrateHostLocalProject(input.routeProject, input.projects);
  }
  if (input.lastActiveProject?.projectKey === selectedProjectKey) {
    return hydrateHostLocalProject(input.lastActiveProject, input.projects);
  }
  return null;
}
