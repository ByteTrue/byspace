import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import type { WorkspaceGitService } from "./workspace-git-service.js";
import { getRealpathAwareRelativePath } from "../utils/path.js";
import type { PersistedWorkspaceRecord } from "./workspace-registry.js";
import type { WorkspaceProvisioningService } from "./session/workspace-provisioning/workspace-provisioning-service.js";
import {
  createWorktreeCore,
  type CreateWorktreeCoreDeps,
  type CreateWorktreeCoreInput,
} from "./worktree-core.js";
import {
  mapWorkspaceRelativeCwdToWorktree,
  rollbackCreatedPaseoWorktree,
  seedPaseoConfigFile,
  validateBranchSlug,
  type WorktreeConfig,
} from "../utils/worktree.js";
import {
  getBranchUpstreamRef,
  getCheckoutStatus,
  getCurrentBranch,
  localBranchExists,
  remoteBranchExists,
  renameCurrentBranch,
} from "../utils/checkout-git.js";
import {
  markPaseoWorktreeFirstAgentBranchAutoNameAttempted,
  normalizeBaseRefName,
  readPaseoWorktreeMetadata,
  recordPaseoWorktreeFirstAgentBranchAutoName,
  writePaseoWorktreeFirstAgentBranchAutoNameMetadata,
} from "../utils/worktree-metadata.js";
import type { WorktreeCreationIntent } from "./resolve-worktree-creation-intent.js";
import { resolveFirstAgentPromptTitle } from "./agent/create-agent-title.js";
import { buildAgentBranchNameSeed } from "./agent/prompt-attachments.js";
import type { FirstAgentContext } from "@getpaseo/protocol/messages";
import { runWithGitCommandPriority } from "../utils/run-git-command.js";

export interface CreatePaseoWorktreeInput extends CreateWorktreeCoreInput {
  projectId?: string;
  title?: string;
}

export interface CreatePaseoWorktreeResult {
  worktree: WorktreeConfig;
  intent: WorktreeCreationIntent;
  workspace: PersistedWorkspaceRecord;
  repoRoot: string;
  created: boolean;
}

export type CreatePaseoWorktreeFn = (
  input: CreatePaseoWorktreeInput,
  options?: {
    resolveDefaultBranch?: (repoRoot: string) => Promise<string>;
  },
) => Promise<CreatePaseoWorktreeResult>;

export interface AttemptFirstAgentBranchAutoNameResult {
  attempted: boolean;
  renamed: boolean;
  branchName: string | null;
}

export interface RenameWorkspaceBranchResult {
  previousBranch: string;
  currentBranch: string;
}

export interface CreatePaseoWorktreeDeps extends CreateWorktreeCoreDeps {
  workspaceGitService: WorkspaceGitService;
  workspaceProvisioning: Pick<WorkspaceProvisioningService, "createWorkspaceForWorktree">;
}

export async function createPaseoWorktree(
  input: CreatePaseoWorktreeInput,
  deps: CreatePaseoWorktreeDeps,
): Promise<CreatePaseoWorktreeResult> {
  return runWithGitCommandPriority("high", () => createPaseoWorktreeWithPriority(input, deps));
}

async function createPaseoWorktreeWithPriority(
  input: CreatePaseoWorktreeInput,
  deps: CreatePaseoWorktreeDeps,
): Promise<CreatePaseoWorktreeResult> {
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
      await seedPaseoConfigFile({
        sourceCwd: workspaceCwdPlan.inputCwd,
        targetCwd: workspaceCwd,
      });
    }
    const workspace = await deps.workspaceProvisioning.createWorkspaceForWorktree({
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
    return rollbackCreatedPaseoWorktree(
      {
        cwd: createdWorktree.repoRoot,
        worktreePath: createdWorktree.worktree.worktreePath,
        ...(input.runSetup === false ? { teardownCwds: [] } : {}),
        paseoHome: input.paseoHome,
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
  getBranchUpstreamRef?: typeof getBranchUpstreamRef;
  remoteBranchExists?: typeof remoteBranchExists;
  renameCurrentBranch?: typeof renameCurrentBranch;
  localBranchExists?: typeof localBranchExists;
  paseoHome?: string;
  worktreesRoot?: string;
}): Promise<AttemptFirstAgentBranchAutoNameResult> {
  const firstAgentContext = options.firstAgentContext;
  if (!firstAgentContext || !buildAgentBranchNameSeed(firstAgentContext)) {
    return { attempted: false, renamed: false, branchName: null };
  }

  let metadata: ReturnType<typeof readPaseoWorktreeMetadata>;
  try {
    metadata = readPaseoWorktreeMetadata(options.cwd);
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
    markPaseoWorktreeFirstAgentBranchAutoNameAttempted(options.cwd);
    return { attempted: true, renamed: false, branchName: null };
  }

  markPaseoWorktreeFirstAgentBranchAutoNameAttempted(options.cwd);

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
  return runWithGitCommandPriority("high", async () => {
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

    if (
      !(await isInitialAutoBranchRenameStillSafe({
        cwd: options.cwd,
        placeholderBranchName,
        getCurrentBranch: getCurrentBranchImpl,
        getBranchUpstreamRef: options.getBranchUpstreamRef,
        remoteBranchExists: options.remoteBranchExists,
        paseoHome: options.paseoHome,
        worktreesRoot: options.worktreesRoot,
      }))
    ) {
      return { attempted: true, renamed: false, branchName: null };
    }

    const renameCurrentBranchImpl = options.renameCurrentBranch ?? renameCurrentBranch;
    const renamedBranch = await renameCurrentBranchImpl(
      options.cwd,
      targetName,
      placeholderBranchName,
    );
    const currentBranch = renamedBranch.currentBranch ?? targetName;
    recordPaseoWorktreeFirstAgentBranchAutoName(options.cwd, currentBranch);
    return { attempted: true, renamed: true, branchName: currentBranch };
  });
}

async function isInitialAutoBranchRenameStillSafe(options: {
  cwd: string;
  placeholderBranchName: string;
  getCurrentBranch: typeof getCurrentBranch;
  getBranchUpstreamRef?: typeof getBranchUpstreamRef;
  remoteBranchExists?: typeof remoteBranchExists;
  paseoHome?: string;
  worktreesRoot?: string;
}): Promise<boolean> {
  let currentMetadata: ReturnType<typeof readPaseoWorktreeMetadata>;
  try {
    currentMetadata = readPaseoWorktreeMetadata(options.cwd);
  } catch {
    return false;
  }
  if (
    !currentMetadata ||
    currentMetadata.changeRequestLookupTarget?.changeRequestNumber !== undefined
  ) {
    return false;
  }

  let currentBranch: string | null;
  let upstreamRef: string | null;
  if (options.paseoHome || options.worktreesRoot) {
    const status = await getCheckoutStatus(options.cwd, {
      paseoHome: options.paseoHome,
      worktreesRoot: options.worktreesRoot,
    });
    if (!status.isGit || !status.isPaseoOwnedWorktree) {
      return false;
    }
    currentBranch = status.currentBranch;
    upstreamRef = status.upstreamRef;
  } else {
    currentBranch = await options.getCurrentBranch(options.cwd);
    const getBranchUpstreamRefImpl = options.getBranchUpstreamRef ?? getBranchUpstreamRef;
    upstreamRef = await getBranchUpstreamRefImpl(options.cwd, options.placeholderBranchName);
  }

  const remoteBranchExistsImpl = options.remoteBranchExists ?? remoteBranchExists;
  return (
    currentBranch === options.placeholderBranchName &&
    !upstreamRef &&
    !(await remoteBranchExistsImpl(options.cwd, options.placeholderBranchName))
  );
}

function getEligiblePaseoGeneratedBranchName(
  metadata: ReturnType<typeof readPaseoWorktreeMetadata>,
): string | null {
  if (!metadata || metadata.version !== 2 || !metadata.firstAgentBranchAutoName) {
    return null;
  }
  const autoName = metadata.firstAgentBranchAutoName;
  return autoName.status === "attempted"
    ? (autoName.renamedBranchName ?? autoName.placeholderBranchName)
    : autoName.placeholderBranchName;
}

export async function renameWorkspaceBranch(options: {
  cwd: string;
  newBranchName: string;
  paseoHome?: string;
  worktreesRoot?: string;
}): Promise<RenameWorkspaceBranchResult> {
  const validation = validateBranchSlug(options.newBranchName);
  if (!validation.valid) {
    throw new Error(validation.error);
  }
  const expectedCurrentBranch = await getCurrentBranch(options.cwd);

  return runWithGitCommandPriority("high", async () => {
    const status = await getCheckoutStatus(options.cwd, {
      paseoHome: options.paseoHome,
      worktreesRoot: options.worktreesRoot,
    });
    if (!status.isGit || !status.isPaseoOwnedWorktree || !status.currentBranch) {
      throw new Error("Branch rename is limited to BySpace-owned worktree branches");
    }
    if (status.currentBranch !== expectedCurrentBranch) {
      throw new Error("Current branch changed before it could be renamed");
    }

    const metadata = readPaseoWorktreeMetadata(status.repoRoot);
    const eligibleBranchName = getEligiblePaseoGeneratedBranchName(metadata);
    if (!eligibleBranchName || status.currentBranch !== eligibleBranchName) {
      throw new Error("Branch rename is limited to the current BySpace-generated worktree branch");
    }
    if (
      metadata?.changeRequestLookupTarget?.changeRequestNumber !== undefined ||
      status.upstreamRef ||
      (await remoteBranchExists(options.cwd, status.currentBranch))
    ) {
      throw new Error("Published branches cannot be renamed");
    }
    if (await localBranchExists(options.cwd, options.newBranchName)) {
      throw new Error(`Branch already exists: ${options.newBranchName}`);
    }
    if (await remoteBranchExists(options.cwd, options.newBranchName)) {
      throw new Error(`Remote branch already exists: ${options.newBranchName}`);
    }

    const renamed = await renameCurrentBranch(
      options.cwd,
      options.newBranchName,
      status.currentBranch,
    );
    if (!renamed.previousBranch || !renamed.currentBranch) {
      throw new Error("Branch rename did not produce a named branch");
    }
    markPaseoWorktreeFirstAgentBranchAutoNameAttempted(status.repoRoot);
    recordPaseoWorktreeFirstAgentBranchAutoName(status.repoRoot, renamed.currentBranch);
    return { previousBranch: renamed.previousBranch, currentBranch: renamed.currentBranch };
  });
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

  writePaseoWorktreeFirstAgentBranchAutoNameMetadata(createdWorktree.worktree.worktreePath, {
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
