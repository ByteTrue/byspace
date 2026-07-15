import { join } from "node:path";

import { getBySpaceWorktreesRoot, isBySpaceOwnedWorktreeCwd } from "../../utils/worktree.js";
import {
  archiveByScope,
  resolveWorkspaceIdAtPath,
  type ArchiveDependencies,
  type ArchiveScope,
} from "../workspace-archive-service.js";
import type {
  CreateBySpaceWorktreeInput,
  CreateBySpaceWorktreeResult,
} from "../byspace-worktree-service.js";
import { toWorktreeWireError, type WorktreeWireError } from "../worktree-errors.js";
import type { WorkspaceGitService, WorkspaceGitWorktreeInfo } from "../workspace-git-service.js";

export interface ListBySpaceWorktreesCommandDependencies {
  workspaceGitService: Pick<WorkspaceGitService, "listWorktrees">;
}

export interface ListBySpaceWorktreesCommandInput {
  cwd: string;
  reason?: string;
}

export async function listBySpaceWorktreesCommand(
  dependencies: ListBySpaceWorktreesCommandDependencies,
  input: ListBySpaceWorktreesCommandInput,
): Promise<WorkspaceGitWorktreeInfo[]> {
  if (input.reason) {
    return dependencies.workspaceGitService.listWorktrees(input.cwd, { reason: input.reason });
  }
  return dependencies.workspaceGitService.listWorktrees(input.cwd);
}

type CreateBySpaceWorktreeWorkflow<Result extends CreateBySpaceWorktreeResult> = (
  input: CreateBySpaceWorktreeInput,
) => Promise<Result>;

export interface CreateBySpaceWorktreeCommandDependencies<
  Result extends CreateBySpaceWorktreeResult = CreateBySpaceWorktreeResult,
> {
  byspaceHome?: string;
  worktreesRoot?: string;
  createBySpaceWorktreeWorkflow?: CreateBySpaceWorktreeWorkflow<Result>;
}

export type CreateBySpaceWorktreeCommandInput = Omit<
  CreateBySpaceWorktreeInput,
  "byspaceHome" | "runSetup"
> & {
  byspaceHome?: string;
  worktreesRoot?: string;
};

export type CreateBySpaceWorktreeCommandResult<Result extends CreateBySpaceWorktreeResult> =
  | {
      ok: true;
      createdWorktree: Result;
    }
  | {
      ok: false;
      error: WorktreeWireError;
      cause: unknown;
    };

export async function createBySpaceWorktreeCommand<Result extends CreateBySpaceWorktreeResult>(
  dependencies: CreateBySpaceWorktreeCommandDependencies<Result>,
  input: CreateBySpaceWorktreeCommandInput,
): Promise<CreateBySpaceWorktreeCommandResult<Result>> {
  try {
    if (!dependencies.createBySpaceWorktreeWorkflow) {
      throw new Error("BySpace worktree service is not configured");
    }

    const createdWorktree = await dependencies.createBySpaceWorktreeWorkflow({
      ...input,
      runSetup: false,
      byspaceHome: input.byspaceHome ?? dependencies.byspaceHome,
      worktreesRoot: input.worktreesRoot ?? dependencies.worktreesRoot,
    });
    return { ok: true, createdWorktree };
  } catch (error) {
    return {
      ok: false,
      error: toWorktreeWireError(error),
      cause: error,
    };
  }
}

export interface ArchiveCommandDependencies extends Omit<
  ArchiveDependencies,
  "workspaceGitService"
> {
  workspaceGitService: Pick<WorkspaceGitService, "getSnapshot" | "listWorktrees">;
}

export interface ArchiveCommandInput {
  requestId: string;
  repoRoot?: string | null;
  worktreePath?: string;
  worktreeSlug?: string;
  branchName?: string;
  workspaceId?: string;
  scope?: ArchiveScope["kind"];
}

export type ArchiveCommandResult =
  | {
      ok: true;
      removedAgents: string[];
    }
  | {
      ok: false;
      code: "NOT_ALLOWED";
      message: string;
      removedAgents: [];
    };

export async function archiveCommand(
  dependencies: ArchiveCommandDependencies,
  input: ArchiveCommandInput,
): Promise<ArchiveCommandResult> {
  const resolvedTarget = await resolveArchiveTarget(dependencies, input);
  const scope = input.scope ?? "workspace";

  if (scope === "worktree") {
    const ownership = await isBySpaceOwnedWorktreeCwd(resolvedTarget.targetPath, {
      byspaceHome: dependencies.byspaceHome,
      worktreesRoot: dependencies.byspaceWorktreesBaseRoot,
    });

    if (!ownership.allowed) {
      return {
        ok: false,
        code: "NOT_ALLOWED",
        message: "Worktree is not a BySpace-owned worktree",
        removedAgents: [],
      };
    }

    const result = await archiveByScope(dependencies, {
      scope: { kind: "worktree", targetPath: resolvedTarget.targetPath },
      repoRoot: ownership.repoRoot ?? resolvedTarget.repoRoot ?? null,
      repoWorktreesRoot: ownership.worktreeRoot,
      byspaceWorktreesBaseRoot: dependencies.byspaceWorktreesBaseRoot,
      requestId: input.requestId,
    });

    return {
      ok: true,
      removedAgents: result.archivedAgentIds,
    };
  }

  const workspaceId =
    input.workspaceId ?? (await resolveWorkspaceIdAtPath(dependencies, resolvedTarget.targetPath));

  if (!workspaceId) {
    dependencies.sessionLogger?.warn(
      { targetPath: resolvedTarget.targetPath },
      "Could not resolve workspace for archive; skipping",
    );
    return {
      ok: true,
      removedAgents: [],
    };
  }

  const result = await archiveByScope(dependencies, {
    scope: { kind: "workspace", workspaceId },
    repoRoot: resolvedTarget.repoRoot,
    byspaceWorktreesBaseRoot: dependencies.byspaceWorktreesBaseRoot,
    requestId: input.requestId,
  });

  return {
    ok: true,
    removedAgents: result.archivedAgentIds,
  };
}

interface ResolvedArchiveTarget {
  targetPath: string;
  repoRoot: string | null;
}

async function resolveArchiveTarget(
  dependencies: ArchiveCommandDependencies,
  input: ArchiveCommandInput,
): Promise<ResolvedArchiveTarget> {
  const repoRoot = input.repoRoot ?? null;
  if (input.worktreePath) {
    return { targetPath: input.worktreePath, repoRoot };
  }

  if (input.worktreeSlug) {
    if (!repoRoot) {
      throw new Error("repoRoot is required when worktreeSlug is supplied");
    }
    return {
      targetPath: await resolveWorktreeSlugPath(dependencies, repoRoot, input.worktreeSlug),
      repoRoot,
    };
  }

  if (repoRoot && input.branchName) {
    const worktrees = await dependencies.workspaceGitService.listWorktrees(repoRoot);
    const match = worktrees.find((entry) => entry.branchName === input.branchName);
    if (!match) {
      throw new Error(`BySpace worktree not found for branch ${input.branchName}`);
    }
    return { targetPath: match.path, repoRoot };
  }

  throw new Error("worktreePath, worktreeSlug, or repoRoot+branchName is required");
}

async function resolveWorktreeSlugPath(
  dependencies: ArchiveCommandDependencies,
  repoRoot: string,
  worktreeSlug: string,
): Promise<string> {
  const worktreesRoot = await getBySpaceWorktreesRoot(
    repoRoot,
    dependencies.byspaceHome,
    dependencies.byspaceWorktreesBaseRoot,
  );
  return join(worktreesRoot, worktreeSlug);
}
