import type {
  EmptyProjectDescriptor,
  ProjectDescriptor,
  WorkspaceDescriptor,
} from "@/stores/session-store";
import { buildWorkspaceStructureProjects } from "@/projects/workspace-structure";

export interface WorkspaceSummary {
  id: string;
  name: string;
  title?: string;
  workspaceKind: WorkspaceDescriptor["workspaceKind"];
  status: WorkspaceDescriptor["status"];
  currentBranch: string | null;
  archivingAt?: string;
}

export interface ProjectHostEntry {
  serverId: string;
  projectId?: string;
  projectName?: string;
  projectCustomName?: string | null;
  serverName: string;
  isOnline: boolean;
  repoRoot: string;
  workspaceCount: number;
  workspaces: WorkspaceSummary[];
  gitRuntime?: WorkspaceDescriptor["gitRuntime"];
  githubRuntime?: WorkspaceDescriptor["githubRuntime"];
}

export interface ProjectSummary {
  projectKey: string;
  projectName: string;
  projectCustomName?: string | null;
  hosts: ProjectHostEntry[];
  totalWorkspaceCount: number;
  hostCount: number;
  onlineHostCount: number;
  githubUrl?: string;
}

export interface ProjectHost {
  serverId: string;
  serverName: string;
  isOnline: boolean;
  workspaces: WorkspaceDescriptor[];
  emptyProjects?: EmptyProjectDescriptor[];
  projects?: ProjectDescriptor[];
}

export interface BuildProjectsInput {
  hosts: ProjectHost[];
}

export interface BuildProjectsResult {
  projects: ProjectSummary[];
}

export function getProjectSummaryForHostProject(
  projects: readonly ProjectSummary[],
  serverId: string,
  projectId: string,
): ProjectSummary | undefined {
  return projects.find((project) =>
    project.hosts.some((host) => host.serverId === serverId && host.projectId === projectId),
  );
}

export function getProjectHostEntry(
  project: ProjectSummary | undefined,
  serverId: string,
  projectId?: string,
): ProjectHostEntry | undefined {
  return project?.hosts.find(
    (host) => host.serverId === serverId && (!projectId || host.projectId === projectId),
  );
}

interface HostGroup {
  serverId: string;
  projectId: string;
  projectName: string;
  projectCustomName: string | null;
  serverName: string;
  isOnline: boolean;
  workspaces: WorkspaceDescriptor[];
  fallbackRepoRoot: string;
}

interface ProjectGroup {
  projectKey: string;
  projectName: string;
  projectCustomName: string | null;
  hostsByServerId: Map<string, HostGroup>;
}

function hostProjectRecords(host: ProjectHost): ProjectDescriptor[] {
  const listed = host.projects ?? [];
  if (listed.length > 0) return listed;
  const records = new Map<string, ProjectDescriptor>();
  for (const project of host.emptyProjects ?? []) {
    records.set(project.projectId, { ...project, projectKey: project.projectId });
  }
  for (const workspace of host.workspaces) {
    if (records.has(workspace.projectId)) continue;
    records.set(workspace.projectId, {
      projectId: workspace.projectId,
      projectKey: workspace.project?.projectKey ?? workspace.projectId,
      projectDisplayName: workspace.projectDisplayName,
      projectCustomName: workspace.projectCustomName ?? null,
      projectRootPath: workspace.projectRootPath,
      projectKind: workspace.projectKind,
    });
  }
  return Array.from(records.values());
}

function deriveGithubUrl(projectKey: string): string | undefined {
  if (!projectKey.startsWith("remote:")) return undefined;
  try {
    const remote = new URL(projectKey.slice("remote:".length));
    const path = remote.pathname.split("/").filter(Boolean);
    if (
      (remote.protocol !== "http:" && remote.protocol !== "https:") ||
      remote.hostname.toLowerCase() !== "github.com" ||
      path.length !== 2
    ) {
      return undefined;
    }
    return `${remote.protocol}//${remote.host}/${path[0]}/${path[1]}`;
  } catch {
    return undefined;
  }
}

function toWorkspaceSummary(workspace: WorkspaceDescriptor): WorkspaceSummary {
  const currentBranch = workspace.gitRuntime?.currentBranch?.trim();
  return {
    id: workspace.id,
    name: workspace.name,
    ...(workspace.title ? { title: workspace.title } : {}),
    workspaceKind: workspace.workspaceKind,
    status: workspace.status,
    currentBranch: currentBranch && currentBranch !== "HEAD" ? currentBranch : null,
    ...(workspace.archivingAt ? { archivingAt: workspace.archivingAt } : {}),
  };
}

function toHostEntry(group: HostGroup): ProjectHostEntry {
  const canonical =
    group.workspaces.find((workspace) => workspace.projectRootPath === group.fallbackRepoRoot) ??
    group.workspaces[0];
  return {
    serverId: group.serverId,
    projectId: group.projectId,
    projectName: group.projectName,
    projectCustomName: group.projectCustomName,
    serverName: group.serverName,
    isOnline: group.isOnline,
    repoRoot: canonical?.project?.checkout.mainRepoRoot ?? group.fallbackRepoRoot,
    workspaceCount: group.workspaces.length,
    workspaces: group.workspaces.map(toWorkspaceSummary),
    gitRuntime: canonical?.gitRuntime,
    githubRuntime: canonical?.githubRuntime,
  };
}

export function buildProjects(input: BuildProjectsInput): BuildProjectsResult {
  const groups = new Map<string, ProjectGroup>();
  const recordsByServer = new Map(
    input.hosts.map((host) => [host.serverId, hostProjectRecords(host)] as const),
  );
  const structures = buildWorkspaceStructureProjects({
    sessions: input.hosts.map((host) => ({
      serverId: host.serverId,
      projects: recordsByServer.get(host.serverId) ?? [],
      workspaces: host.workspaces,
      emptyProjects: host.emptyProjects,
    })),
  });

  for (const structure of structures) {
    const group: ProjectGroup = {
      projectKey: structure.projectKey,
      projectName: structure.projectName,
      projectCustomName: null,
      hostsByServerId: new Map(),
    };
    for (const placement of structure.hosts) {
      if (!placement.projectId) continue;
      const host = input.hosts.find((candidate) => candidate.serverId === placement.serverId);
      const project = recordsByServer
        .get(placement.serverId)
        ?.find((candidate) => candidate.projectId === placement.projectId);
      if (!host || !project) continue;
      if (project.projectCustomName && !group.projectCustomName) {
        group.projectCustomName = project.projectCustomName;
        group.projectName = project.projectDisplayName;
      }
      group.hostsByServerId.set(placement.serverId, {
        serverId: placement.serverId,
        projectId: placement.projectId,
        projectName: project.projectDisplayName,
        projectCustomName: project.projectCustomName,
        serverName: host.serverName,
        isOnline: host.isOnline,
        workspaces: host.workspaces.filter(
          (workspace) => workspace.projectId === placement.projectId,
        ),
        fallbackRepoRoot: project.projectRootPath,
      });
    }
    groups.set(structure.projectKey, group);
  }

  const projects = Array.from(groups.values()).map((draft) => {
    const hosts = Array.from(draft.hostsByServerId.values())
      .map(toHostEntry)
      .sort(
        (left, right) =>
          left.serverName.localeCompare(right.serverName) ||
          left.serverId.localeCompare(right.serverId),
      );
    return {
      projectKey: draft.projectKey,
      projectName: draft.projectName,
      projectCustomName: draft.projectCustomName,
      hosts,
      totalWorkspaceCount: hosts.reduce((sum, host) => sum + host.workspaceCount, 0),
      hostCount: hosts.length,
      onlineHostCount: hosts.filter((host) => host.isOnline).length,
      githubUrl: deriveGithubUrl(draft.projectKey),
    };
  });
  projects.sort(
    (left, right) =>
      left.projectName.localeCompare(right.projectName) ||
      left.projectKey.localeCompare(right.projectKey),
  );
  return { projects };
}
