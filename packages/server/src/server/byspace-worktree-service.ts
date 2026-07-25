import { stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

import type { WorkspaceGitService } from "./workspace-git-service.js";
import { getRealpathAwareRelativePath } from "../utils/path.js";
import {
  createPersistedWorkspaceRecord,
  type PersistedProjectRecord,
  type PersistedWorkspaceRecord,
  type ProjectRegistry,
  type WorkspaceRegistry,
} from "./workspace-registry.js";
import { generateWorkspaceId, initialWorkspacePlacement } from "./workspace-registry-model.js";
import { workspaceLifecycleCoordinator } from "./workspace-lifecycle-coordinator.js";
import type { WorkspaceProvisioningService } from "./session/workspace-provisioning/workspace-provisioning-service.js";
import {
  createWorktreeCore,
  type CreateWorktreeCoreDeps,
  type CreateWorktreeCoreInput,
} from "./worktree-core.js";
import {
  mapWorkspaceRelativeCwdToWorktree,
  rollbackCreatedBySpaceWorktree,
  seedBySpaceConfigFile,
  validateBranchSlug,
  type WorktreeConfig,
} from "../utils/worktree.js";
import { getCurrentBranch, localBranchExists, renameCurrentBranch } from "../utils/checkout-git.js";
import {
  markBySpaceWorktreeFirstAgentBranchAutoNameAttempted,
  normalizeBaseRefName,
  readBySpaceWorktreeMetadata,
  writeBySpaceWorktreeFirstAgentBranchAutoNameMetadata,
} from "../utils/worktree-metadata.js";
import type { WorktreeCreationIntent } from "./resolve-worktree-creation-intent.js";
import { resolveFirstAgentPromptTitle } from "./agent/create-agent-title.js";
import { buildAgentBranchNameSeed } from "./agent/prompt-attachments.js";
import type { FirstAgentContext } from "@bytetrue/byspace-protocol/messages";

export interface CreateBySpaceWorktreeInput extends CreateWorktreeCoreInput {
  projectId?: string;
  title?: string;
}

export interface CreateBySpaceWorktreeResult {
  worktree: WorktreeConfig;
  intent: WorktreeCreationIntent;
  workspace: PersistedWorkspaceRecord;
  repoRoot: string;
  created: boolean;
}

export type CreateBySpaceWorktreeFn = (
  input: CreateBySpaceWorktreeInput,
  options?: {
    resolveDefaultBranch?: (repoRoot: string) => Promise<string>;
  },
) => Promise<CreateBySpaceWorktreeResult>;

export interface AttemptFirstAgentBranchAutoNameResult {
  attempted: boolean;
  renamed: boolean;
  branchName: string | null;
}

export interface CreateBySpaceWorktreeDeps extends CreateWorktreeCoreDeps {
  workspaceGitService: WorkspaceGitService;
  workspaceProvisioning?: Pick<WorkspaceProvisioningService, "createWorkspaceForWorktree">;
  projectRegistry?: ProjectRegistry;
  workspaceRegistry?: WorkspaceRegistry;
}

export async function createBySpaceWorktree(
  input: CreateBySpaceWorktreeInput,
  deps: CreateBySpaceWorktreeDeps,
): Promise<CreateBySpaceWorktreeResult> {
  return workspaceLifecycleCoordinator.runExclusive(() =>
    createBySpaceWorktreeUnlocked(input, deps),
  );
}

async function createBySpaceWorktreeUnlocked(
  input: CreateBySpaceWorktreeInput,
  deps: CreateBySpaceWorktreeDeps,
): Promise<CreateBySpaceWorktreeResult> {
  const workspaceCwdPlan = await planWorkspaceCwdForWorktree(input.cwd, deps.workspaceGitService);
  const createdWorktree = await createWorktreeCore(input, deps);
  try {
    maybeMarkFirstAgentBranchAutoNameEligible({ createdWorktree });
    const workspaceCwd = mapWorkspaceRelativeCwdToWorktree({
      relativeWorkspaceCwd: workspaceCwdPlan.relativeWorkspaceCwd,
      targetWorktreePath: createdWorktree.worktree.worktreePath,
    });
    if (!(await isDirectory(workspaceCwd))) {
      throw new Error(`Selected project directory is missing from the worktree: ${workspaceCwd}`);
    }

    if (createdWorktree.created) {
      await seedBySpaceConfigFile({
        sourceCwd: workspaceCwdPlan.inputCwd,
        targetCwd: workspaceCwd,
      });
    }
    const workspaceProvisioning = deps.workspaceProvisioning ?? {
      createWorkspaceForWorktree: (
        workspaceInput: Parameters<WorkspaceProvisioningService["createWorkspaceForWorktree"]>[0],
      ) => registerWorktreeWorkspace(workspaceInput, deps),
    };
    const workspace = await workspaceProvisioning.createWorkspaceForWorktree({
      sourceCwd: workspaceCwdPlan.inputCwd,
      projectId: input.projectId,
      repoRoot: createdWorktree.repoRoot,
      cwd: workspaceCwd,
      worktreeRoot: createdWorktree.worktree.worktreePath,
      branch: createdWorktree.worktree.branchName || null,
      baseBranch: resolveIntentBaseBranch(createdWorktree.intent),
      title: input.title?.trim() || resolveFirstAgentPromptTitle(input.firstAgentContext),
      expectsInitialAgent: Boolean(input.firstAgentContext),
    });

    deps.github.invalidate({ cwd: createdWorktree.worktree.worktreePath });

    return {
      worktree: createdWorktree.worktree,
      intent: createdWorktree.intent,
      workspace,
      repoRoot: createdWorktree.repoRoot,
      created: createdWorktree.created,
    };
  } catch (error) {
    if (!createdWorktree.created) {
      throw error;
    }
    return rollbackCreatedBySpaceWorktree(
      {
        cwd: createdWorktree.repoRoot,
        worktreePath: createdWorktree.worktree.worktreePath,
        ...(input.runSetup === false ? { teardownCwds: [] } : {}),
        byspaceHome: input.byspaceHome,
        worktreesBaseRoot: input.worktreesRoot,
      },
      error,
    );
  }
}

async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    return (await stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

async function planWorkspaceCwdForWorktree(
  inputCwd: string,
  workspaceGitService: Pick<WorkspaceGitService, "getCheckout">,
): Promise<{ inputCwd: string; relativeWorkspaceCwd: string }> {
  const normalizedInputCwd = resolve(inputCwd);
  const sourceCheckout = await workspaceGitService.getCheckout(normalizedInputCwd);
  const sourceWorktreePath = sourceCheckout.worktreeRoot ?? normalizedInputCwd;
  const relativeWorkspaceCwd = getRealpathAwareRelativePath(sourceWorktreePath, normalizedInputCwd);
  if (relativeWorkspaceCwd === null) {
    throw new Error(`Workspace cwd is outside its source worktree: ${normalizedInputCwd}`);
  }
  return { inputCwd: normalizedInputCwd, relativeWorkspaceCwd };
}

export async function attemptFirstAgentBranchAutoName(options: {
  cwd: string;
  firstAgentContext: FirstAgentContext | undefined;
  generateBranchNameFromContext: (input: {
    cwd: string;
    firstAgentContext: FirstAgentContext;
  }) => Promise<string | null>;
  getCurrentBranch?: typeof getCurrentBranch;
  renameCurrentBranch?: typeof renameCurrentBranch;
  localBranchExists?: typeof localBranchExists;
}): Promise<AttemptFirstAgentBranchAutoNameResult> {
  const firstAgentContext = options.firstAgentContext;
  if (!firstAgentContext || !buildAgentBranchNameSeed(firstAgentContext)) {
    return { attempted: false, renamed: false, branchName: null };
  }

  let metadata: ReturnType<typeof readBySpaceWorktreeMetadata>;
  try {
    metadata = readBySpaceWorktreeMetadata(options.cwd);
  } catch {
    return { attempted: false, renamed: false, branchName: null };
  }
  if (
    !metadata ||
    metadata.version !== 2 ||
    metadata.firstAgentBranchAutoName?.status !== "pending"
  ) {
    return { attempted: false, renamed: false, branchName: null };
  }

  const getCurrentBranchImpl = options.getCurrentBranch ?? getCurrentBranch;
  const placeholderBranchName = metadata.firstAgentBranchAutoName.placeholderBranchName;
  if ((await getCurrentBranchImpl(options.cwd)) !== placeholderBranchName) {
    markBySpaceWorktreeFirstAgentBranchAutoNameAttempted(options.cwd);
    return { attempted: true, renamed: false, branchName: null };
  }

  markBySpaceWorktreeFirstAgentBranchAutoNameAttempted(options.cwd);

  const branchName = await options.generateBranchNameFromContext({
    cwd: options.cwd,
    firstAgentContext,
  });
  if (!branchName) {
    return { attempted: true, renamed: false, branchName: null };
  }
  const validation = validateBranchSlug(branchName);
  if (!validation.valid || branchName === placeholderBranchName) {
    return { attempted: true, renamed: false, branchName: null };
  }
  if ((await getCurrentBranchImpl(options.cwd)) !== placeholderBranchName) {
    return { attempted: true, renamed: false, branchName: null };
  }

  const localBranchExistsImpl = options.localBranchExists ?? localBranchExists;
  const targetName = await findAvailableBranchName({
    cwd: options.cwd,
    desiredName: branchName,
    placeholderBranchName,
    localBranchExists: localBranchExistsImpl,
  });
  if (!targetName) {
    return { attempted: true, renamed: false, branchName: null };
  }

  const renameCurrentBranchImpl = options.renameCurrentBranch ?? renameCurrentBranch;
  const renamedBranch = await renameCurrentBranchImpl(options.cwd, targetName);
  return {
    attempted: true,
    renamed: true,
    branchName: renamedBranch.currentBranch ?? targetName,
  };
}

const MAX_BRANCH_NAME_SUFFIX_ATTEMPTS = 50;

async function findAvailableBranchName(options: {
  cwd: string;
  desiredName: string;
  placeholderBranchName: string;
  localBranchExists: (cwd: string, branchName: string) => Promise<boolean>;
}): Promise<string | null> {
  const { cwd, desiredName, placeholderBranchName } = options;
  if (!(await options.localBranchExists(cwd, desiredName))) {
    return desiredName;
  }
  for (let suffix = 2; suffix <= MAX_BRANCH_NAME_SUFFIX_ATTEMPTS; suffix++) {
    const candidate = `${desiredName}-${suffix}`;
    if (candidate === placeholderBranchName) {
      continue;
    }
    if (!(await options.localBranchExists(cwd, candidate))) {
      return candidate;
    }
  }
  return null;
}

function maybeMarkFirstAgentBranchAutoNameEligible(options: {
  createdWorktree: Awaited<ReturnType<typeof createWorktreeCore>>;
}): void {
  const { createdWorktree } = options;
  if (!createdWorktree.created || createdWorktree.intent.kind !== "branch-off") {
    return;
  }

  writeBySpaceWorktreeFirstAgentBranchAutoNameMetadata(createdWorktree.worktree.worktreePath, {
    placeholderBranchName: createdWorktree.worktree.branchName,
  });
}

// The base branch is normalized to match worktree.json's baseRefName (origin/
// stripped). checkout-branch worktrees have no distinct base, so they stay null.
function resolveIntentBaseBranch(intent: WorktreeCreationIntent): string | null {
  switch (intent.kind) {
    case "branch-off":
      return normalizeBaseRefName(intent.baseBranch);
    case "checkout-change-request":
      return normalizeBaseRefName(intent.baseRefName);
    case "checkout-github-pr":
      return normalizeBaseRefName(intent.baseRefName);
    case "checkout-branch":
      return null;
  }
}

export interface CreateLocalCheckoutWorkspaceDeps {
  projectRegistry: ProjectRegistry;
  workspaceRegistry: WorkspaceRegistry;
  workspaceGitService: Pick<WorkspaceGitService, "getCheckout">;
}

export async function createLocalCheckoutWorkspace(
  options: { cwd: string; title?: string | null; projectId?: string },
  deps: CreateLocalCheckoutWorkspaceDeps,
): Promise<PersistedWorkspaceRecord> {
  return workspaceLifecycleCoordinator.runExclusive(async () => {
    const cwd = resolve(options.cwd);
    const checkout = await deps.workspaceGitService.getCheckout(cwd);
    const timestamp = new Date().toISOString();
    let project: PersistedProjectRecord;
    if (options.projectId) {
      const existing = await deps.projectRegistry.get(options.projectId);
      if (!existing || existing.archivedAt) {
        throw new Error(`Project not found: ${options.projectId}`);
      }
      project = { ...existing, kind: checkout.isGit ? "git" : "non_git", updatedAt: timestamp };
      await deps.projectRegistry.upsert(project);
    } else {
      project = await deps.projectRegistry.getOrCreateActiveByRoot({
        rootPath: cwd,
        kind: checkout.isGit ? "git" : "non_git",
        displayName: basename(cwd) || cwd,
        timestamp,
      });
    }
    const workspace = createPersistedWorkspaceRecord({
      workspaceId: generateWorkspaceId(),
      projectId: project.projectId,
      ...initialWorkspacePlacement({ source: "checkout", cwd, checkout }),
      title: options.title?.trim() || null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await deps.workspaceRegistry.upsert(workspace);
    return workspace;
  });
}

async function registerWorktreeWorkspace(
  input: Parameters<WorkspaceProvisioningService["createWorkspaceForWorktree"]>[0],
  deps: CreateBySpaceWorktreeDeps,
): Promise<PersistedWorkspaceRecord> {
  if (!deps.projectRegistry || !deps.workspaceRegistry) {
    throw new Error("Worktree workspace registration is unavailable");
  }
  return workspaceLifecycleCoordinator.runExclusive(async () => {
    let project: PersistedProjectRecord | null = input.projectId
      ? await deps.projectRegistry!.get(input.projectId)
      : null;
    if (!project && !input.projectId) {
      const workspaces = await deps.workspaceRegistry!.list();
      const source = workspaces.find(
        (workspace) => !workspace.archivedAt && resolve(workspace.cwd) === resolve(input.sourceCwd),
      );
      project = source ? await deps.projectRegistry!.get(source.projectId) : null;
    }
    if (!project && !input.projectId) {
      project = await deps.projectRegistry!.getOrCreateActiveByRoot({
        rootPath: input.repoRoot,
        kind: "git",
        displayName: basename(input.repoRoot) || input.repoRoot,
        timestamp: new Date().toISOString(),
      });
    }
    if (!project || project.archivedAt) {
      throw new Error(`Project not found: ${input.projectId ?? input.repoRoot}`);
    }
    const timestamp = new Date().toISOString();
    const workspace = createPersistedWorkspaceRecord({
      workspaceId: generateWorkspaceId(),
      projectId: project.projectId,
      ...initialWorkspacePlacement({
        source: "created_worktree",
        cwd: input.cwd,
        worktreeRoot: input.worktreeRoot,
        branch: input.branch,
        baseBranch: input.baseBranch,
        mainRepoRoot: input.repoRoot,
      }),
      title: input.title,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await deps.workspaceRegistry!.upsert(workspace, {
      expectsInitialAgent: input.expectsInitialAgent,
    });
    return workspace;
  });
}
