import { basename, resolve } from "node:path";
import { stat } from "node:fs/promises";
import type { Logger } from "pino";
import {
  generateWorkspaceId,
  initialWorkspacePlacement,
  reconcileWorkspacePlacement,
} from "../../workspace-registry-model.js";
import {
  createPersistedWorkspaceRecord,
  type PersistedProjectRecord,
  type PersistedWorkspaceRecord,
  type ProjectRegistry,
  type WorkspaceRegistry,
} from "../../workspace-registry.js";
import type { WorkspaceGitService } from "../../workspace-git-service.js";
import type { CreateBySpaceWorktreeWorkflowResult } from "../../worktree-session.js";
import { areEquivalentPaths, createRealpathAwarePathMatcher } from "../../../utils/path.js";
import { withWorkspaceLifecycleLocks } from "../../workspace-lifecycle-lock.js";

export interface ResolveOrCreateWorkspaceIdInput {
  createdWorktree: CreateBySpaceWorktreeWorkflowResult | null;
  requestedWorkspaceId?: string;
  cwd: string;
  initialTitle: string | null;
}

export interface ImportWorkspaceInput {
  cwd: string;
  requestedWorkspaceId?: string;
}

export interface ImportWorkspaceResult<T> {
  value: T;
  createdWorkspace: PersistedWorkspaceRecord | null;
}
type ImportProjectRollback =
  | {
      kind: "created";
      provisioned: PersistedProjectRecord;
    }
  | {
      kind: "updated";
      previous: PersistedProjectRecord;
      provisioned: PersistedProjectRecord;
    }
  | null;

export interface CreateWorktreeWorkspaceInput {
  sourceCwd: string;
  projectId?: string;
  repoRoot: string;
  cwd: string;
  worktreeRoot: string;
  branch: string | null;
  baseBranch: string | null;
  title: string | null;
}

export interface WorkspaceProvisioningService {
  runInImportWorkspace<T>(
    input: ImportWorkspaceInput,
    operation: (workspace: PersistedWorkspaceRecord) => Promise<T>,
  ): Promise<ImportWorkspaceResult<T>>;
  findOrCreateWorkspaceForDirectory(cwd: string): Promise<PersistedWorkspaceRecord>;
  resolveOrCreateWorkspaceIdForCreateAgent(input: ResolveOrCreateWorkspaceIdInput): Promise<string>;
  createWorkspaceForDirectory(
    cwd: string,
    title?: string | null,
    projectId?: string,
  ): Promise<PersistedWorkspaceRecord>;
  createWorkspaceForWorktree(
    input: CreateWorktreeWorkspaceInput,
  ): Promise<PersistedWorkspaceRecord>;
  findOrCreateProjectForDirectory(cwd: string): Promise<PersistedProjectRecord>;
  ensureWorkspaceRecordUnarchived(
    workspace: PersistedWorkspaceRecord,
  ): Promise<PersistedWorkspaceRecord>;
}

export type WorkspaceProvisioningErrorCode = "unknown_project" | "archived_project";

export class WorkspaceProvisioningError extends Error {
  constructor(
    readonly code: WorkspaceProvisioningErrorCode,
    projectId: string,
  ) {
    super(
      code === "unknown_project"
        ? `Unknown project: ${projectId}`
        : `Archived project: ${projectId}`,
    );
    this.name = "WorkspaceProvisioningError";
  }
}

export function createWorkspaceProvisioningService(deps: {
  workspaceRegistry: WorkspaceRegistry;
  projectRegistry: ProjectRegistry;
  workspaceGitService: Pick<WorkspaceGitService, "getCheckout" | "peekSnapshot">;
  logger: Logger;
  isDirectory?: (path: string) => Promise<boolean>;
}): WorkspaceProvisioningService {
  const { workspaceRegistry, projectRegistry, workspaceGitService, logger } = deps;
  const isDirectory =
    deps.isDirectory ??
    (async (path: string) => {
      try {
        return (await stat(path)).isDirectory();
      } catch {
        return false;
      }
    });

  async function runInImportWorkspace<T>(
    input: ImportWorkspaceInput,
    operation: (workspace: PersistedWorkspaceRecord) => Promise<T>,
  ): Promise<ImportWorkspaceResult<T>> {
    if (input.requestedWorkspaceId) {
      const workspace = await workspaceRegistry.get(input.requestedWorkspaceId);
      if (!workspace || workspace.archivedAt) {
        throw new Error(`Workspace not found: ${input.requestedWorkspaceId}`);
      }
      const project = await projectRegistry.get(workspace.projectId);
      if (!project || project.archivedAt) {
        throw new Error(`Project not found: ${workspace.projectId}`);
      }
      if (!createRealpathAwarePathMatcher(workspace.cwd)(input.cwd)) {
        throw new Error(`Import cwd does not match workspace: ${workspace.workspaceId}`);
      }
      return {
        value: await operation(workspace),
        createdWorkspace: null,
      };
    }

    const [projectsBeforeImport, workspacesBeforeImport] = await Promise.all([
      projectRegistry.list(),
      workspaceRegistry.list(),
    ]);
    const workspace = await createWorkspaceForDirectory(input.cwd);
    const createdWorkspace = !workspacesBeforeImport.some(
      (candidate) => candidate.workspaceId === workspace.workspaceId,
    );
    const previousProject =
      projectsBeforeImport.find((project) => project.projectId === workspace.projectId) ?? null;
    const provisionedProject = await projectRegistry.get(workspace.projectId);
    if (!provisionedProject) throw new Error(`Project not found: ${workspace.projectId}`);
    let projectRollback: ImportProjectRollback = null;
    if (!previousProject) {
      projectRollback = { kind: "created", provisioned: provisionedProject };
    } else if (
      previousProject.kind !== provisionedProject.kind ||
      previousProject.archivedAt !== provisionedProject.archivedAt
    ) {
      projectRollback = {
        kind: "updated",
        previous: previousProject,
        provisioned: provisionedProject,
      };
    }

    try {
      return {
        value: await operation(workspace),
        createdWorkspace: createdWorkspace ? workspace : null,
      };
    } catch (error) {
      if (createdWorkspace) {
        await rollbackFailedImportWorkspace(workspace, projectRollback);
      }
      throw error;
    }
  }

  async function rollbackFailedImportWorkspace(
    workspace: PersistedWorkspaceRecord,
    projectRollback: ImportProjectRollback,
  ): Promise<void> {
    try {
      await withWorkspaceLifecycleLocks(
        {
          paths: [workspace.worktreeRoot ?? workspace.cwd],
          projectIds: [workspace.projectId],
        },
        async () => {
          await workspaceRegistry.remove(workspace.workspaceId);
          const projectHasActiveWorkspace = (await workspaceRegistry.list()).some(
            (candidate) => candidate.projectId === workspace.projectId && !candidate.archivedAt,
          );
          if (projectHasActiveWorkspace || !projectRollback) return;

          if (projectRollback.kind === "created") {
            const currentProject = await projectRegistry.get(workspace.projectId);
            if (
              currentProject === projectRollback.provisioned &&
              currentProject.customName === null &&
              currentProject.updatedAt === currentProject.createdAt
            ) {
              await projectRegistry.remove(workspace.projectId);
            }
            return;
          }

          await projectRegistry.update(workspace.projectId, (current) => {
            if (
              current.kind !== projectRollback.provisioned.kind ||
              current.archivedAt !== projectRollback.provisioned.archivedAt
            ) {
              return current;
            }
            return {
              ...current,
              kind: projectRollback.previous.kind,
              archivedAt: projectRollback.previous.archivedAt,
              updatedAt: projectRollback.previous.updatedAt,
            };
          });
        },
      );
    } catch (error) {
      logger.error(
        { err: error, workspaceId: workspace.workspaceId, projectId: workspace.projectId },
        "Failed to restore workspace state after provider import failure",
      );
    }
  }

  async function findOrCreateProjectForDirectoryUnlocked(
    cwd: string,
  ): Promise<PersistedProjectRecord> {
    const rootPath = resolve(cwd);
    const checkout = await workspaceGitService.getCheckout(rootPath);
    const timestamp = new Date().toISOString();
    return projectRegistry.getOrCreateActiveByRoot({
      rootPath,
      kind: checkout.isGit ? "git" : "non_git",
      displayName: basename(rootPath) || rootPath,
      timestamp,
    });
  }

  async function findOrCreateProjectForDirectory(cwd: string): Promise<PersistedProjectRecord> {
    const rootPath = resolve(cwd);
    const existingProjectId = (await projectRegistry.list()).find(
      (project) => !project.archivedAt && areEquivalentPaths(project.rootPath, rootPath),
    )?.projectId;
    return withWorkspaceLifecycleLocks(
      {
        paths: [rootPath],
        projectIds: existingProjectId ? [existingProjectId] : [],
      },
      () => findOrCreateProjectForDirectoryUnlocked(rootPath),
    );
  }

  async function requireActiveProject(projectId: string): Promise<PersistedProjectRecord> {
    const project = await projectRegistry.get(projectId);
    if (!project) throw new WorkspaceProvisioningError("unknown_project", projectId);
    if (project.archivedAt) throw new WorkspaceProvisioningError("archived_project", projectId);
    return project;
  }

  async function createWorkspaceForDirectory(
    cwd: string,
    title?: string | null,
    projectId?: string,
  ): Promise<PersistedWorkspaceRecord> {
    const normalizedCwd = resolve(cwd);
    const lockProjectId =
      projectId ??
      (await projectRegistry.list()).find(
        (project) => !project.archivedAt && areEquivalentPaths(project.rootPath, normalizedCwd),
      )?.projectId;
    return withWorkspaceLifecycleLocks(
      { paths: [normalizedCwd], projectIds: lockProjectId ? [lockProjectId] : [] },
      async () => {
        const checkout = await workspaceGitService.getCheckout(normalizedCwd);
        const project = projectId
          ? await refreshProjectKind(await requireActiveProject(projectId), normalizedCwd, checkout)
          : // COMPAT(workspaceCreateMissingProjectId): added in v0.1.107, remove after 2027-01-15.
            await findOrCreateProjectForDirectoryUnlocked(normalizedCwd);
        const timestamp = new Date().toISOString();
        const workspace = createPersistedWorkspaceRecord({
          workspaceId: generateWorkspaceId(),
          projectId: project.projectId,
          ...initialWorkspacePlacement({ source: "checkout", cwd: normalizedCwd, checkout }),
          title: title?.trim() || null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        await workspaceRegistry.upsert(workspace);
        return workspace;
      },
    );
  }

  async function createWorkspaceForWorktree(
    input: CreateWorktreeWorkspaceInput,
  ): Promise<PersistedWorkspaceRecord> {
    const sourceCwd = resolve(input.sourceCwd);
    const repoRoot = resolve(input.repoRoot);
    const cwd = resolve(input.cwd);
    const worktreeRoot = resolve(input.worktreeRoot);
    const resolvedProject = await resolveSourceProjectForWorktree({
      sourceCwd,
      projectId: input.projectId,
      repoRoot,
    });
    return withWorkspaceLifecycleLocks(
      { paths: [worktreeRoot], projectIds: [resolvedProject.projectId] },
      async () => {
        const project = await refreshProjectKind(
          await requireActiveProject(resolvedProject.projectId),
        );
        if (!(await isDirectory(cwd))) {
          throw new Error(`Workspace directory does not exist: ${cwd}`);
        }
        const timestamp = new Date().toISOString();
        const workspace = createPersistedWorkspaceRecord({
          workspaceId: generateWorkspaceId(),
          projectId: project.projectId,
          ...initialWorkspacePlacement({
            source: "created_worktree",
            cwd,
            worktreeRoot,
            branch: input.branch,
            baseBranch: input.baseBranch,
            mainRepoRoot: repoRoot,
          }),
          title: input.title,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        await workspaceRegistry.upsert(workspace);
        return workspace;
      },
    );
  }

  async function resolveSourceProjectForWorktree(input: {
    sourceCwd: string;
    projectId?: string;
    repoRoot: string;
  }): Promise<PersistedProjectRecord> {
    if (input.projectId) {
      return refreshProjectKind(await requireActiveProject(input.projectId));
    }

    const workspaces = await workspaceRegistry.list();
    const sourceWorkspace =
      workspaces.find(
        (workspace) => !workspace.archivedAt && areEquivalentPaths(workspace.cwd, input.sourceCwd),
      ) ??
      workspaces.find(
        (workspace) => !workspace.archivedAt && areEquivalentPaths(workspace.cwd, input.repoRoot),
      );
    if (sourceWorkspace) {
      const project = await projectRegistry.get(sourceWorkspace.projectId);
      if (project) return refreshProjectKind(project);
      // COMPAT(worktreeMissingSourceProject): added in v0.1.107, remove after 2027-01-15.
      // Orphaned legacy workspace FKs fall through to exact-root allocation.
    }

    const project = await projectRegistry.getOrCreateActiveByRoot({
      rootPath: input.repoRoot,
      kind: "git",
      displayName: basename(input.repoRoot) || input.repoRoot,
      timestamp: new Date().toISOString(),
    });
    return refreshProjectKind(project);
  }

  async function findOrCreateWorkspaceForDirectory(cwd: string): Promise<PersistedWorkspaceRecord> {
    const normalizedCwd = resolve(cwd);
    const workspaces = await workspaceRegistry.list();
    const active = workspaces
      .filter(
        (workspace) => !workspace.archivedAt && areEquivalentPaths(workspace.cwd, normalizedCwd),
      )
      .sort(
        (left, right) =>
          Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
          left.workspaceId.localeCompare(right.workspaceId),
      )[0];
    if (active) return ensureWorkspaceRecordUnarchived(active);
    const archived = workspaces
      .filter(
        (workspace) => workspace.archivedAt && areEquivalentPaths(workspace.cwd, normalizedCwd),
      )
      .sort(
        (left, right) =>
          Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
          left.workspaceId.localeCompare(right.workspaceId),
      )[0];
    if (archived) {
      const project = await projectRegistry.get(archived.projectId);
      if (project && !project.archivedAt) return ensureWorkspaceRecordUnarchived(archived);
    }
    return createWorkspaceForDirectory(normalizedCwd);
  }

  async function resolveOrCreateWorkspaceIdForCreateAgent(
    input: ResolveOrCreateWorkspaceIdInput,
  ): Promise<string> {
    if (input.createdWorktree) return input.createdWorktree.workspace.workspaceId;
    if (input.requestedWorkspaceId) return input.requestedWorkspaceId;
    return (await createWorkspaceForDirectory(input.cwd, input.initialTitle)).workspaceId;
  }

  async function ensureWorkspaceRecordUnarchived(
    workspace: PersistedWorkspaceRecord,
  ): Promise<PersistedWorkspaceRecord> {
    return withWorkspaceLifecycleLocks(
      {
        paths: [workspace.worktreeRoot ?? workspace.cwd],
        projectIds: [workspace.projectId],
      },
      async () => {
        const current = await workspaceRegistry.get(workspace.workspaceId);
        if (!current) throw new Error(`Unknown workspace: ${workspace.workspaceId}`);
        const project = await projectRegistry.get(current.projectId);
        if (!project) throw new Error(`Unknown project: ${current.projectId}`);
        if (current.archivedAt && !(await isDirectory(current.cwd))) {
          throw new Error(`Workspace directory does not exist: ${current.cwd}`);
        }

        const timestamp = new Date().toISOString();
        const checkout = await workspaceGitService.getCheckout(current.cwd);
        const projectCheckout = areEquivalentPaths(project.rootPath, current.cwd)
          ? checkout
          : await workspaceGitService.getCheckout(project.rootPath);
        const kind = projectCheckout.isGit ? "git" : "non_git";
        const updatedProject = await projectRegistry.update(project.projectId, (latest) => {
          if (!latest.archivedAt && latest.kind === kind) return latest;
          return { ...latest, kind, archivedAt: null, updatedAt: timestamp };
        });
        if (!updatedProject) throw new Error(`Unknown project: ${current.projectId}`);

        const updatedWorkspace = await workspaceRegistry.update(current.workspaceId, (latest) => {
          const placementUpdate = reconcileWorkspacePlacement({
            workspace: latest,
            checkout,
            updatedAt: timestamp,
          });
          if (!latest.archivedAt && !placementUpdate) return latest;
          return {
            ...(placementUpdate?.workspace ?? latest),
            archivedAt: null,
            updatedAt: timestamp,
          };
        });
        if (!updatedWorkspace) throw new Error(`Unknown workspace: ${current.workspaceId}`);
        return updatedWorkspace;
      },
    );
  }

  async function refreshProjectKind(
    project: PersistedProjectRecord,
    workspaceCwd?: string,
    workspaceCheckout?: Awaited<ReturnType<WorkspaceGitService["getCheckout"]>>,
  ): Promise<PersistedProjectRecord> {
    const projectCheckout =
      workspaceCwd && workspaceCheckout && areEquivalentPaths(project.rootPath, workspaceCwd)
        ? workspaceCheckout
        : await workspaceGitService.getCheckout(project.rootPath);
    const kind: PersistedProjectRecord["kind"] = projectCheckout.isGit ? "git" : "non_git";
    const refreshed = await projectRegistry.update(project.projectId, (current) => {
      if (current.archivedAt || current.kind === kind) return current;
      return { ...current, kind, updatedAt: new Date().toISOString() };
    });
    if (!refreshed) {
      throw new WorkspaceProvisioningError("unknown_project", project.projectId);
    }
    if (refreshed.archivedAt) {
      throw new WorkspaceProvisioningError("archived_project", project.projectId);
    }
    return refreshed;
  }

  return {
    runInImportWorkspace,
    findOrCreateWorkspaceForDirectory,
    resolveOrCreateWorkspaceIdForCreateAgent,
    createWorkspaceForDirectory,
    createWorkspaceForWorktree,
    findOrCreateProjectForDirectory,
    ensureWorkspaceRecordUnarchived,
  };
}
