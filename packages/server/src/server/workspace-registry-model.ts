import { randomBytes } from "node:crypto";
import { normalize, resolve } from "node:path";

import type {
  ProjectCheckoutLitePayload,
  ProjectPlacementPayload,
} from "@bytetrue/byspace-protocol/messages";
import { parseGitRevParsePath } from "../utils/git-rev-parse-path.js";
import type { PersistedWorkspaceRecord } from "./workspace-registry.js";

export type PersistedProjectKind = "git" | "non_git";
export type PersistedWorkspaceKind = "local_checkout" | "worktree" | "directory";

export interface DirectoryProjectMembership {
  cwd: string;
  checkout: ProjectCheckoutLitePayload;
  workspaceDirectoryKey: string;
  workspaceKind: PersistedWorkspaceKind;
  workspaceDisplayName: string;
  projectKey: string;
  projectName: string;
  projectRootPath: string;
  projectKind: PersistedProjectKind;
}

export interface DetectStaleWorkspacesInput {
  activeWorkspaces: PersistedWorkspaceRecord[];
  checkDirectoryExists: (cwd: string) => Promise<boolean>;
}

export function generateWorkspaceId(): string {
  return `wks_${randomBytes(8).toString("hex")}`;
}

export function generateProjectId(): string {
  return `prj_${randomBytes(8).toString("hex")}`;
}

export function normalizeProjectRootPath(rootPath: string): string {
  return normalize(resolve(rootPath));
}

// Path-derived grouping key for a workspace directory. This is NOT the opaque
// workspace identity (see generateWorkspaceId); never persist or compare it as one.
export function deriveWorkspaceDirectoryKey(
  cwd: string,
  checkout: ProjectCheckoutLitePayload,
): string {
  const worktreeRoot = checkout.worktreeRoot ? parseGitRevParsePath(checkout.worktreeRoot) : null;
  return worktreeRoot ?? resolve(cwd);
}

function deriveRemoteProjectKey(remoteUrl: string | null): string | null {
  if (!remoteUrl) {
    return null;
  }

  const trimmed = remoteUrl.trim();
  if (!trimmed) {
    return null;
  }

  let host: string | null = null;
  let remotePath: string | null = null;

  const scpLike = trimmed.match(/^[^@]+@([^:]+):(.+)$/);
  if (scpLike) {
    host = scpLike[1] ?? null;
    remotePath = scpLike[2] ?? null;
  } else if (trimmed.includes("://")) {
    try {
      const parsed = new URL(trimmed);
      host = parsed.hostname || null;
      remotePath = parsed.pathname ? parsed.pathname.replace(/^\/+/, "") : null;
    } catch {
      return null;
    }
  }

  if (!host || !remotePath) {
    return null;
  }

  let cleanedPath = remotePath.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (cleanedPath.endsWith(".git")) {
    cleanedPath = cleanedPath.slice(0, -4);
  }
  if (!cleanedPath.includes("/")) {
    return null;
  }

  const cleanedHost = host.toLowerCase();
  if (cleanedHost === "github.com") {
    return `remote:github.com/${cleanedPath}`;
  }

  return `remote:${cleanedHost}/${cleanedPath}`;
}

export function deriveProjectGroupingKey(options: {
  cwd: string;
  remoteUrl: string | null;
  mainRepoRoot: string | null;
}): string {
  const remoteKey = deriveRemoteProjectKey(options.remoteUrl);
  if (remoteKey) {
    return remoteKey;
  }

  const mainRepoRoot = options.mainRepoRoot?.trim();
  if (mainRepoRoot) {
    return mainRepoRoot;
  }

  return options.cwd;
}

export function deriveProjectGroupingName(projectKey: string): string {
  if (projectKey.startsWith("remote:")) {
    const remainder = projectKey.slice("remote:".length);
    const pathSegments = remainder.split("/").filter(Boolean).slice(1);
    if (pathSegments.length >= 2) {
      return pathSegments.slice(-2).join("/");
    }
    if (pathSegments.length === 1) {
      return pathSegments[0];
    }
    return projectKey;
  }

  const segments = projectKey.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || projectKey;
}

function deriveWorkspaceDirectoryName(cwd: string): string {
  const normalized = cwd.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? cwd;
}

export function deriveWorkspaceDisplayName(input: {
  cwd: string;
  checkout: ProjectCheckoutLitePayload;
}): string {
  const branch = input.checkout.currentBranch?.trim() ?? null;
  if (branch && branch.toUpperCase() !== "HEAD") {
    return branch;
  }
  return deriveWorkspaceDirectoryName(input.cwd);
}

export function deriveProjectRootPath(input: {
  cwd: string;
  checkout: ProjectCheckoutLitePayload;
}): string {
  if (input.checkout.isGit && input.checkout.mainRepoRoot) {
    return input.checkout.mainRepoRoot;
  }
  return input.cwd;
}

export function deriveProjectKind(checkout: ProjectCheckoutLitePayload): PersistedProjectKind {
  return checkout.isGit ? "git" : "non_git";
}

export function deriveWorkspaceKind(checkout: ProjectCheckoutLitePayload): PersistedWorkspaceKind {
  if (!checkout.isGit) {
    return "directory";
  }
  return checkout.mainRepoRoot ? "worktree" : "local_checkout";
}

export function checkoutLiteFromGitSnapshot(
  cwd: string,
  git: {
    isGit: boolean;
    currentBranch: string | null;
    remoteUrl: string | null;
    repoRoot: string | null;
    isBySpaceOwnedWorktree: boolean;
    mainRepoRoot: string | null;
  },
): ProjectCheckoutLitePayload {
  if (!git.isGit) {
    return {
      cwd,
      isGit: false,
      currentBranch: null,
      remoteUrl: null,
      worktreeRoot: null,
      isBySpaceOwnedWorktree: false,
      mainRepoRoot: null,
    };
  }
  if (git.isBySpaceOwnedWorktree && git.mainRepoRoot) {
    return {
      cwd,
      isGit: true,
      currentBranch: git.currentBranch,
      remoteUrl: git.remoteUrl,
      worktreeRoot: git.repoRoot ?? cwd,
      isBySpaceOwnedWorktree: true,
      mainRepoRoot: git.mainRepoRoot,
    };
  }
  return {
    cwd,
    isGit: true,
    currentBranch: git.currentBranch,
    remoteUrl: git.remoteUrl,
    worktreeRoot: git.repoRoot ?? cwd,
    isBySpaceOwnedWorktree: false,
    mainRepoRoot: git.mainRepoRoot,
  };
}

export type PersistedWorkspacePlacement = Pick<
  PersistedWorkspaceRecord,
  | "cwd"
  | "kind"
  | "displayName"
  | "branch"
  | "worktreeRoot"
  | "baseBranch"
  | "isBySpaceOwnedWorktree"
  | "mainRepoRoot"
>;

export type MutableWorkspacePlacement = Pick<
  PersistedWorkspaceRecord,
  "kind" | "branch" | "worktreeRoot" | "isBySpaceOwnedWorktree" | "mainRepoRoot"
>;

export type InitialWorkspacePlacementInput =
  | {
      source: "checkout";
      cwd: string;
      checkout: ProjectCheckoutLitePayload;
    }
  | {
      source: "created_worktree";
      cwd: string;
      worktreeRoot: string;
      branch: string | null;
      baseBranch: string | null;
      mainRepoRoot: string;
    };

export interface WorkspacePlacementUpdate {
  workspace: PersistedWorkspaceRecord;
  fields: Partial<MutableWorkspacePlacement>;
}

export function initialWorkspacePlacement(
  input: InitialWorkspacePlacementInput,
): PersistedWorkspacePlacement {
  if (input.source === "created_worktree") {
    return {
      cwd: input.cwd,
      kind: "worktree",
      displayName: input.branch || input.cwd,
      branch: input.branch,
      worktreeRoot: input.worktreeRoot,
      baseBranch: input.baseBranch,
      isBySpaceOwnedWorktree: true,
      mainRepoRoot: input.mainRepoRoot,
    };
  }

  const branch = normalizeBranch(input.checkout.currentBranch);
  return {
    cwd: input.cwd,
    kind: deriveWorkspaceKind(input.checkout),
    displayName: deriveWorkspaceDisplayName(input),
    branch,
    worktreeRoot: input.checkout.isGit ? (input.checkout.worktreeRoot ?? input.cwd) : null,
    baseBranch: null,
    isBySpaceOwnedWorktree: input.checkout.isGit && input.checkout.isBySpaceOwnedWorktree,
    mainRepoRoot: input.checkout.isGit ? input.checkout.mainRepoRoot : null,
  };
}

export function reconcileWorkspacePlacement(input: {
  workspace: PersistedWorkspaceRecord;
  checkout: ProjectCheckoutLitePayload;
  updatedAt: string;
}): WorkspacePlacementUpdate | null {
  const observed = initialWorkspacePlacement({
    source: "checkout",
    cwd: input.workspace.cwd,
    checkout: input.checkout,
  });
  const fields: Partial<MutableWorkspacePlacement> = {};
  if (input.workspace.kind !== observed.kind) fields.kind = observed.kind;
  if (input.workspace.branch !== observed.branch) fields.branch = observed.branch;
  if (input.workspace.worktreeRoot !== observed.worktreeRoot)
    fields.worktreeRoot = observed.worktreeRoot;
  if (input.workspace.isBySpaceOwnedWorktree !== observed.isBySpaceOwnedWorktree)
    fields.isBySpaceOwnedWorktree = observed.isBySpaceOwnedWorktree;
  if (input.workspace.mainRepoRoot !== observed.mainRepoRoot)
    fields.mainRepoRoot = observed.mainRepoRoot;

  if (Object.keys(fields).length === 0) return null;
  return {
    workspace: { ...input.workspace, ...fields, updatedAt: input.updatedAt },
    fields,
  };
}

export function checkoutFromPersistedWorkspacePlacement(input: {
  workspace: PersistedWorkspaceRecord;
  fallbackBranch?: string | null;
  fallbackWorktreeRoot?: string | null;
}): ProjectPlacementPayload["checkout"] {
  const { workspace } = input;
  if (workspace.kind === "directory") {
    return {
      cwd: workspace.cwd,
      isGit: false,
      currentBranch: null,
      remoteUrl: null,
      worktreeRoot: null,
      isBySpaceOwnedWorktree: false,
      mainRepoRoot: null,
    };
  }

  const checkout = {
    cwd: workspace.cwd,
    currentBranch: workspace.branch ?? input.fallbackBranch ?? null,
    remoteUrl: null,
    worktreeRoot: workspace.worktreeRoot ?? input.fallbackWorktreeRoot ?? workspace.cwd,
  };
  if (workspace.isBySpaceOwnedWorktree && workspace.mainRepoRoot) {
    return {
      ...checkout,
      isGit: true,
      isBySpaceOwnedWorktree: true,
      mainRepoRoot: workspace.mainRepoRoot,
    };
  }
  return {
    ...checkout,
    isGit: true,
    isBySpaceOwnedWorktree: false,
    mainRepoRoot: workspace.mainRepoRoot ?? null,
  };
}

function normalizeBranch(branch: string | null | undefined): string | null {
  const normalized = branch?.trim() ?? null;
  return normalized && normalized.toUpperCase() !== "HEAD" ? normalized : null;
}

export async function detectStaleWorkspaces(
  input: DetectStaleWorkspacesInput,
): Promise<Set<string>> {
  const staleWorkspaceIds = new Set<string>();

  const existenceChecks = await Promise.all(
    input.activeWorkspaces.map(async (workspace) => ({
      workspace,
      exists: await input.checkDirectoryExists(workspace.cwd),
    })),
  );
  for (const { workspace, exists } of existenceChecks) {
    if (!exists) {
      staleWorkspaceIds.add(workspace.workspaceId);
    }
  }

  return staleWorkspaceIds;
}

export function buildProjectPlacementForCwd(input: {
  cwd: string;
  checkout: ProjectCheckoutLitePayload;
}): ProjectPlacementPayload {
  const membership = classifyDirectoryForProjectMembership(input);
  return {
    projectKey: membership.projectKey,
    projectName: membership.projectName,
    checkout: membership.checkout,
  };
}

export function classifyDirectoryForProjectMembership(input: {
  cwd: string;
  checkout: ProjectCheckoutLitePayload;
}): DirectoryProjectMembership {
  const normalizedCwd = resolve(input.cwd);
  const checkout: ProjectCheckoutLitePayload = {
    ...input.checkout,
    cwd: normalizedCwd,
  };

  const projectKey = deriveProjectGroupingKey({
    cwd: checkout.worktreeRoot ?? normalizedCwd,
    remoteUrl: checkout.remoteUrl,
    mainRepoRoot: checkout.mainRepoRoot,
  });

  return {
    cwd: normalizedCwd,
    checkout,
    workspaceDirectoryKey: deriveWorkspaceDirectoryKey(normalizedCwd, checkout),
    workspaceKind: deriveWorkspaceKind(checkout),
    workspaceDisplayName: deriveWorkspaceDisplayName({
      cwd: normalizedCwd,
      checkout,
    }),
    projectKey,
    projectName: deriveProjectGroupingName(projectKey),
    projectRootPath: deriveProjectRootPath({
      cwd: normalizedCwd,
      checkout,
    }),
    projectKind: deriveProjectKind(checkout),
  };
}
