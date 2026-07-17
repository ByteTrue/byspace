import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { isAbsolute, join, resolve } from "path";
import { z } from "zod";

const ChangeRequestLookupTargetSchema = z.object({
  headRef: z.string().min(1),
  headRepositoryOwner: z.string().min(1).optional(),
  changeRequestNumber: z.number().int().positive().optional(),
  forge: z.string().min(1).optional(),
  projectPath: z.string().min(1).optional(),
});

const BySpaceWorktreeMetadataV1Schema = z.object({
  version: z.literal(1),
  baseRefName: z.string().min(1),
  changeRequestLookupTarget: ChangeRequestLookupTargetSchema.optional(),
});

const BySpaceWorktreeMetadataV2Schema = z.object({
  version: z.literal(2),
  baseRefName: z.string().min(1),
  changeRequestLookupTarget: ChangeRequestLookupTargetSchema.optional(),
  firstAgentBranchAutoName: z
    .discriminatedUnion("status", [
      z.object({
        status: z.literal("pending"),
        placeholderBranchName: z.string().min(1),
      }),
      z.object({
        status: z.literal("attempted"),
        placeholderBranchName: z.string().min(1),
        attemptedAt: z.string().min(1),
      }),
    ])
    .optional(),
  runtime: z
    .object({
      worktreePort: z.number().int().positive(),
    })
    .optional(),
});

const BySpaceWorktreeMetadataSchema = z.union([
  BySpaceWorktreeMetadataV1Schema,
  BySpaceWorktreeMetadataV2Schema,
]);

export type BySpaceWorktreeMetadata = z.infer<typeof BySpaceWorktreeMetadataSchema>;
export type BySpaceWorktreeChangeRequestLookupTarget = z.infer<
  typeof ChangeRequestLookupTargetSchema
>;

function getGitDirForWorktreeRoot(worktreeRoot: string): string {
  const gitPath = join(worktreeRoot, ".git");
  if (!existsSync(gitPath)) {
    throw new Error(`Not a git repository: ${worktreeRoot}`);
  }

  // In a worktree checkout, `.git` is a file containing `gitdir: <path>`.
  // In a normal checkout, `.git` is a directory.
  try {
    const gitFileContent = readFileSync(gitPath, "utf8");
    const match = gitFileContent.match(/gitdir:\s*(.+)/);
    if (match?.[1]) {
      const raw = match[1].trim();
      return isAbsolute(raw) ? raw : resolve(worktreeRoot, raw);
    }
  } catch {
    // If `.git` is a directory, readFileSync will throw; fall through.
  }

  return gitPath;
}

export function getBySpaceWorktreeMetadataPath(worktreeRoot: string): string {
  const gitDir = getGitDirForWorktreeRoot(worktreeRoot);
  return join(gitDir, "byspace", "worktree.json");
}

export function normalizeBaseRefName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Base branch is required");
  }
  if (trimmed.startsWith("origin/")) {
    return trimmed.slice("origin/".length);
  }
  return trimmed;
}

export function writeBySpaceWorktreeMetadata(
  worktreeRoot: string,
  options: {
    baseRefName: string;
    changeRequestLookupTarget?: BySpaceWorktreeChangeRequestLookupTarget;
  },
): void {
  const baseRefName = normalizeBaseRefName(options.baseRefName);
  if (baseRefName === "HEAD") {
    throw new Error("Base branch cannot be HEAD");
  }
  if (baseRefName.includes("..") || baseRefName.includes("@{")) {
    throw new Error(`Invalid base branch: ${baseRefName}`);
  }
  if (!/^[0-9A-Za-z._/-]+$/.test(baseRefName)) {
    throw new Error(`Invalid base branch: ${baseRefName}`);
  }

  const metadata: BySpaceWorktreeMetadata = {
    version: 1,
    baseRefName,
    ...(options.changeRequestLookupTarget
      ? { changeRequestLookupTarget: options.changeRequestLookupTarget }
      : {}),
  };
  writeBySpaceWorktreeMetadataFile(worktreeRoot, metadata);
}

export function writeBySpaceWorktreeRuntimeMetadata(
  worktreeRoot: string,
  options: { worktreePort: number },
): void {
  if (!Number.isInteger(options.worktreePort) || options.worktreePort <= 0) {
    throw new Error(`Invalid worktree runtime port: ${options.worktreePort}`);
  }

  const current = readBySpaceWorktreeMetadata(worktreeRoot);
  if (!current) {
    throw new Error("Cannot persist worktree runtime metadata: missing base metadata");
  }

  const next: BySpaceWorktreeMetadata = {
    version: 2,
    baseRefName: current.baseRefName,
    ...(current.changeRequestLookupTarget
      ? { changeRequestLookupTarget: current.changeRequestLookupTarget }
      : {}),
    ...(current.version === 2 && current.firstAgentBranchAutoName
      ? { firstAgentBranchAutoName: current.firstAgentBranchAutoName }
      : {}),
    runtime: {
      worktreePort: options.worktreePort,
    },
  };
  writeBySpaceWorktreeMetadataFile(worktreeRoot, next);
}

export function writeBySpaceWorktreeFirstAgentBranchAutoNameMetadata(
  worktreeRoot: string,
  options: { placeholderBranchName: string },
): void {
  const placeholderBranchName = options.placeholderBranchName.trim();
  if (!placeholderBranchName) {
    throw new Error("Placeholder branch name is required");
  }

  const current = readBySpaceWorktreeMetadata(worktreeRoot);
  if (!current) {
    throw new Error("Cannot persist first-agent branch auto-name metadata: missing base metadata");
  }

  writeBySpaceWorktreeMetadataFile(worktreeRoot, {
    version: 2,
    baseRefName: current.baseRefName,
    ...(current.changeRequestLookupTarget
      ? { changeRequestLookupTarget: current.changeRequestLookupTarget }
      : {}),
    firstAgentBranchAutoName: {
      status: "pending",
      placeholderBranchName,
    },
    ...(current.version === 2 && current.runtime ? { runtime: current.runtime } : {}),
  });
}

export function markBySpaceWorktreeFirstAgentBranchAutoNameAttempted(
  worktreeRoot: string,
  options: { attemptedAt?: string } = {},
): BySpaceWorktreeMetadata | null {
  const current = readBySpaceWorktreeMetadata(worktreeRoot);
  if (!current || current.version !== 2 || current.firstAgentBranchAutoName?.status !== "pending") {
    return current;
  }

  const next: BySpaceWorktreeMetadata = {
    version: 2,
    baseRefName: current.baseRefName,
    ...(current.changeRequestLookupTarget
      ? { changeRequestLookupTarget: current.changeRequestLookupTarget }
      : {}),
    firstAgentBranchAutoName: {
      status: "attempted",
      placeholderBranchName: current.firstAgentBranchAutoName.placeholderBranchName,
      attemptedAt: options.attemptedAt ?? new Date().toISOString(),
    },
    ...(current.runtime ? { runtime: current.runtime } : {}),
  };
  writeBySpaceWorktreeMetadataFile(worktreeRoot, next);
  return next;
}

export function readBySpaceWorktreeMetadata(worktreeRoot: string): BySpaceWorktreeMetadata | null {
  const metadataPath = getBySpaceWorktreeMetadataPath(worktreeRoot);
  if (!existsSync(metadataPath)) {
    return null;
  }
  const parsed = JSON.parse(readFileSync(metadataPath, "utf8"));
  return BySpaceWorktreeMetadataSchema.parse(parsed);
}

export function requireBySpaceWorktreeBaseRefName(worktreeRoot: string): string {
  const metadataPath = getBySpaceWorktreeMetadataPath(worktreeRoot);
  const metadata = readBySpaceWorktreeMetadata(worktreeRoot);
  if (!metadata) {
    throw new Error(`Missing BySpace worktree base metadata: ${metadataPath}`);
  }
  return metadata.baseRefName;
}

export function readBySpaceWorktreeRuntimePort(worktreeRoot: string): number | null {
  const metadata = readBySpaceWorktreeMetadata(worktreeRoot);
  if (!metadata) {
    return null;
  }
  if (metadata.version === 2 && metadata.runtime?.worktreePort) {
    return metadata.runtime.worktreePort;
  }
  return null;
}

function writeBySpaceWorktreeMetadataFile(
  worktreeRoot: string,
  metadata: BySpaceWorktreeMetadata,
): void {
  const metadataPath = getBySpaceWorktreeMetadataPath(worktreeRoot);
  mkdirSync(join(getGitDirForWorktreeRoot(worktreeRoot), "byspace"), { recursive: true });
  const tempPath = `${metadataPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  renameSync(tempPath, metadataPath);
}
