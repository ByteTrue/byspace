import type {
  EmptyProjectDescriptor,
  ProjectDescriptor,
  WorkspaceDescriptor,
} from "@/stores/session-store";
import { projectDisplayNameFromProjectId } from "@/utils/project-display-name";

export interface WorkspaceStructureHostPlacement {
  serverId: string;
  /** Host-local mutation authority. */
  projectId?: string;
  iconWorkingDir: string;
  canCreateWorktree: boolean;
}

export interface WorkspaceStructureProject {
  projectKey: string;
  projectName: string;
  projectKind: WorkspaceDescriptor["projectKind"];
  iconWorkingDir: string;
  hosts: WorkspaceStructureHostPlacement[];
  workspaceKeys: string[];
}

export interface WorkspaceStructure {
  projects: WorkspaceStructureProject[];
}

interface WorkspaceStructureSession {
  serverId: string;
  projects?: Iterable<ProjectDescriptor>;
  workspaces: Iterable<WorkspaceDescriptor>;
  emptyProjects?: Iterable<EmptyProjectDescriptor>;
}

interface ProjectDraft {
  projectKey: string;
  projectName: string;
  hasCustomName: boolean;
  projectKind: WorkspaceDescriptor["projectKind"];
  iconWorkingDir: string;
  hosts: Map<string, WorkspaceStructureHostPlacement>;
  workspaces: Array<{ workspaceId: string; workspaceName: string; workspaceKey: string }>;
}

/** The single app boundary that turns host-local projects into grouped display projects. */
export function buildWorkspaceStructureProjects(input: {
  sessions: WorkspaceStructureSession[];
}): WorkspaceStructureProject[] {
  const byProject = new Map<string, ProjectDraft>();
  const projectEntries: Array<{ serverId: string; project: ProjectDescriptor }> = [];
  const keyCountsByServer = new Map<string, Map<string, number>>();
  const viewKeyByServerProjectId = new Map<string, Map<string, string>>();
  const workspacesByServer = new Map<string, WorkspaceDescriptor[]>();

  for (const session of input.sessions) {
    const workspaces = Array.from(session.workspaces);
    workspacesByServer.set(session.serverId, workspaces);
    const listedProjects = Array.from(session.projects ?? []);
    const projects =
      listedProjects.length > 0
        ? listedProjects
        : buildLegacyProjects(workspaces, Array.from(session.emptyProjects ?? []));
    for (const project of projects) {
      projectEntries.push({ serverId: session.serverId, project });
      const sharedKey = project.projectKey ?? null;
      if (sharedKey) {
        const counts = getOrCreate(keyCountsByServer, session.serverId, () => new Map());
        counts.set(sharedKey, (counts.get(sharedKey) ?? 0) + 1);
      }
    }
  }

  for (const { serverId, project } of projectEntries) {
    const projectKey = addProjectToView({ byProject, keyCountsByServer, serverId, project });
    getOrCreate(viewKeyByServerProjectId, serverId, () => new Map()).set(
      project.projectId,
      projectKey,
    );
  }

  for (const [serverId, workspaces] of workspacesByServer) {
    for (const workspace of workspaces) {
      const projectKey = viewKeyByServerProjectId.get(serverId)?.get(workspace.projectId);
      if (!projectKey) continue;
      byProject.get(projectKey)?.workspaces.push({
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        workspaceKey: `${serverId}:${workspace.id}`,
      });
    }
  }

  return Array.from(byProject.values())
    .map((draft) => ({
      projectKey: draft.projectKey,
      projectName: draft.projectName,
      projectKind: draft.projectKind,
      iconWorkingDir: draft.iconWorkingDir,
      hosts: Array.from(draft.hosts.values()),
      workspaceKeys: draft.workspaces
        .sort(compareWorkspaceStructureItems)
        .map((workspace) => workspace.workspaceKey),
    }))
    .sort((left, right) =>
      left.projectName.localeCompare(right.projectName, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
}

function buildLegacyProjects(
  workspaces: WorkspaceDescriptor[],
  emptyProjects: EmptyProjectDescriptor[],
): ProjectDescriptor[] {
  const projects = new Map<string, ProjectDescriptor>();
  for (const project of emptyProjects) {
    projects.set(project.projectId, {
      ...project,
      projectKey: project.projectKey ?? project.projectId,
    });
  }
  for (const workspace of workspaces) {
    if (projects.has(workspace.projectId)) continue;
    projects.set(workspace.projectId, {
      projectId: workspace.projectId,
      projectKey: workspace.project?.projectKey ?? workspace.projectId,
      projectDisplayName: workspace.projectDisplayName,
      projectCustomName: workspace.projectCustomName ?? null,
      projectRootPath: workspace.projectRootPath,
      projectKind: workspace.projectKind,
    });
  }
  return Array.from(projects.values());
}

function addProjectToView(input: {
  byProject: Map<string, ProjectDraft>;
  keyCountsByServer: Map<string, Map<string, number>>;
  serverId: string;
  project: ProjectDescriptor;
}): string {
  const { byProject, keyCountsByServer, serverId, project } = input;
  const sharedKey = project.projectKey ?? null;
  const canUseSharedKey =
    sharedKey !== null && keyCountsByServer.get(serverId)?.get(sharedKey) === 1;
  const projectKey = canUseSharedKey ? sharedKey : JSON.stringify([serverId, project.projectId]);
  const placement: WorkspaceStructureHostPlacement = {
    serverId,
    projectId: project.projectId,
    iconWorkingDir: project.projectRootPath,
    canCreateWorktree: project.projectKind === "git",
  };
  const draft = byProject.get(projectKey);
  if (!draft) {
    byProject.set(projectKey, {
      projectKey,
      projectName:
        project.projectCustomName ??
        project.projectDisplayName ??
        projectDisplayNameFromProjectId(project.projectId),
      hasCustomName: Boolean(project.projectCustomName),
      projectKind: project.projectKind,
      iconWorkingDir: project.projectRootPath,
      hosts: new Map([[serverId, placement]]),
      workspaces: [],
    });
  } else {
    if (project.projectCustomName && !draft.hasCustomName) {
      draft.projectName = project.projectCustomName;
      draft.hasCustomName = true;
    }
    draft.hosts.set(serverId, placement);
  }
  return projectKey;
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const value = create();
  map.set(key, value);
  return value;
}

function compareWorkspaceStructureItems(
  left: { workspaceId: string; workspaceName: string },
  right: { workspaceId: string; workspaceName: string },
): number {
  return (
    left.workspaceName.localeCompare(right.workspaceName, undefined, {
      numeric: true,
      sensitivity: "base",
    }) || left.workspaceId.localeCompare(right.workspaceId, undefined, { sensitivity: "base" })
  );
}
