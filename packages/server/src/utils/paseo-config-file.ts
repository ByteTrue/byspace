import {
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  PaseoConfigRawSchema,
  type PaseoConfigRaw,
  type PaseoConfigRevision,
  type ProjectConfigRpcError,
} from "@getpaseo/protocol/paseo-config-schema";
export {
  PaseoConfigRevisionSchema,
  ProjectConfigRpcErrorSchema,
  type PaseoConfigRevision,
  type ProjectConfigRpcError,
} from "@getpaseo/protocol/paseo-config-schema";

export const BYSPACE_CONFIG_FILE_NAME = "byspace.json";
export const LEGACY_PASEO_CONFIG_FILE_NAME = "paseo.json";

export class ConflictingProjectConfigFilesError extends Error {
  readonly byspacePath: string;
  readonly legacyPath: string;

  constructor(repoRoot: string) {
    const byspacePath = join(repoRoot, BYSPACE_CONFIG_FILE_NAME);
    const legacyPath = join(repoRoot, LEGACY_PASEO_CONFIG_FILE_NAME);
    super(`Both ${byspacePath} and legacy ${legacyPath} exist. Keep only one project config file.`);
    this.name = "ConflictingProjectConfigFilesError";
    this.byspacePath = byspacePath;
    this.legacyPath = legacyPath;
  }
}

export type ReadPaseoConfigForEditResult =
  | { ok: true; config: PaseoConfigRaw | null; revision: PaseoConfigRevision | null }
  | { ok: false; error: ProjectConfigRpcError };

export type WritePaseoConfigForEditResult =
  | { ok: true; config: PaseoConfigRaw; revision: PaseoConfigRevision }
  | { ok: false; error: ProjectConfigRpcError };

export interface WritePaseoConfigForEditInput {
  repoRoot: string;
  config: PaseoConfigRaw;
  expectedRevision: PaseoConfigRevision | null;
}

function pathEntryExists(path: string): boolean {
  return lstatSync(path, { throwIfNoEntry: false }) !== undefined;
}

export function resolvePaseoConfigPath(repoRoot: string): string {
  const byspacePath = join(repoRoot, BYSPACE_CONFIG_FILE_NAME);
  const legacyPath = join(repoRoot, LEGACY_PASEO_CONFIG_FILE_NAME);
  const hasByspaceConfig = pathEntryExists(byspacePath);
  // COMPAT(byspaceProjectConfigFilename): added after v0.7.0-beta.2; remove when legacy paseo.json projects are no longer supported.
  const hasLegacyConfig = pathEntryExists(legacyPath);
  if (hasByspaceConfig && hasLegacyConfig) {
    throw new ConflictingProjectConfigFilesError(repoRoot);
  }
  return hasLegacyConfig ? legacyPath : byspacePath;
}

export function statPaseoConfigPath(repoRoot: string): PaseoConfigRevision | null {
  const configPath = resolvePaseoConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  const stats = statSync(configPath);
  return {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
}

export function readPaseoConfigJson(repoRoot: string): unknown {
  const configPath = resolvePaseoConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  return JSON.parse(readFileSync(configPath, "utf8"));
}

export function readPaseoConfigForEdit(repoRoot: string): ReadPaseoConfigForEditResult {
  try {
    const json = readPaseoConfigJson(repoRoot);
    if (json === null) {
      return { ok: true, config: null, revision: null };
    }
    return {
      ok: true,
      config: PaseoConfigRawSchema.parse(json),
      revision: statPaseoConfigPath(repoRoot),
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "invalid_project_config",
        ...(error instanceof ConflictingProjectConfigFilesError
          ? { reason: "conflicting_files" as const }
          : {}),
      },
    };
  }
}

export function writePaseoConfigForEdit(
  input: WritePaseoConfigForEditInput,
): WritePaseoConfigForEditResult {
  const parsed = PaseoConfigRawSchema.safeParse(input.config);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_project_config" } };
  }

  let tempPath: string | null = null;
  try {
    const configPath = resolvePaseoConfigPath(input.repoRoot);
    tempPath = join(input.repoRoot, `.${basename(configPath)}.${process.pid}.${randomUUID()}.tmp`);
    writeFileSync(tempPath, `${JSON.stringify(parsed.data, null, 2)}\n`);
    const currentRevision = statPaseoConfigPath(input.repoRoot);
    if (!paseoConfigRevisionsEqual(currentRevision, input.expectedRevision)) {
      removeTempPaseoConfig(tempPath);
      return {
        ok: false,
        error: { code: "stale_project_config", currentRevision },
      };
    }

    renameSync(tempPath, configPath);
    const revision = statPaseoConfigPath(input.repoRoot);
    if (!revision) {
      return { ok: false, error: { code: "write_failed" } };
    }
    return { ok: true, config: parsed.data, revision };
  } catch (error) {
    if (tempPath) removeTempPaseoConfig(tempPath);
    if (error instanceof ConflictingProjectConfigFilesError) {
      return {
        ok: false,
        error: { code: "invalid_project_config", reason: "conflicting_files" },
      };
    }
    return { ok: false, error: { code: "write_failed" } };
  }
}

function paseoConfigRevisionsEqual(
  left: PaseoConfigRevision | null,
  right: PaseoConfigRevision | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.mtimeMs === right.mtimeMs && left.size === right.size;
}

function removeTempPaseoConfig(tempPath: string): void {
  try {
    rmSync(tempPath, { force: true });
  } catch {
    // Best-effort cleanup only; callers need the original write outcome.
  }
}
