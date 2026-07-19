import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  BySpaceConfigRawSchema,
  type BySpaceConfigRaw,
  type BySpaceConfigRevision,
  type ProjectConfigRpcError,
} from "@bytetrue/byspace-protocol/byspace-config-schema";
export {
  BySpaceConfigRevisionSchema,
  ProjectConfigRpcErrorSchema,
  type BySpaceConfigRevision,
  type ProjectConfigRpcError,
} from "@bytetrue/byspace-protocol/byspace-config-schema";

export const BYSPACE_CONFIG_FILE_NAME = "byspace.json";

export type ReadBySpaceConfigForEditResult =
  | { ok: true; config: BySpaceConfigRaw | null; revision: BySpaceConfigRevision | null }
  | { ok: false; error: ProjectConfigRpcError };

export type WriteBySpaceConfigForEditResult =
  | { ok: true; config: BySpaceConfigRaw; revision: BySpaceConfigRevision }
  | { ok: false; error: ProjectConfigRpcError };

export interface WriteBySpaceConfigForEditInput {
  repoRoot: string;
  config: BySpaceConfigRaw;
  expectedRevision: BySpaceConfigRevision | null;
}

export function resolveBySpaceConfigPath(repoRoot: string): string {
  return join(repoRoot, BYSPACE_CONFIG_FILE_NAME);
}

export function statBySpaceConfigPath(repoRoot: string): BySpaceConfigRevision | null {
  const configPath = resolveBySpaceConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  const stats = statSync(configPath);
  return {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
}

export function readBySpaceConfigJson(repoRoot: string): unknown {
  const configPath = resolveBySpaceConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  return JSON.parse(readFileSync(configPath, "utf8"));
}

export function readBySpaceConfigForEdit(repoRoot: string): ReadBySpaceConfigForEditResult {
  try {
    const json = readBySpaceConfigJson(repoRoot);
    if (json === null) {
      return { ok: true, config: null, revision: null };
    }
    return {
      ok: true,
      config: BySpaceConfigRawSchema.parse(json),
      revision: statBySpaceConfigPath(repoRoot),
    };
  } catch {
    return {
      ok: false,
      error: { code: "invalid_project_config" },
    };
  }
}

export function writeBySpaceConfigForEdit(
  input: WriteBySpaceConfigForEditInput,
): WriteBySpaceConfigForEditResult {
  const parsed = BySpaceConfigRawSchema.safeParse(input.config);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_project_config" } };
  }

  const configPath = resolveBySpaceConfigPath(input.repoRoot);
  const tempPath = join(
    input.repoRoot,
    `.${BYSPACE_CONFIG_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    writeFileSync(tempPath, `${JSON.stringify(parsed.data, null, 2)}\n`);
    const currentRevision = statBySpaceConfigPath(input.repoRoot);
    if (!byspaceConfigRevisionsEqual(currentRevision, input.expectedRevision)) {
      removeTempBySpaceConfig(tempPath);
      return {
        ok: false,
        error: { code: "stale_project_config", currentRevision },
      };
    }

    renameSync(tempPath, configPath);
    const revision = statBySpaceConfigPath(input.repoRoot);
    if (!revision) {
      return { ok: false, error: { code: "write_failed" } };
    }
    return { ok: true, config: parsed.data, revision };
  } catch {
    removeTempBySpaceConfig(tempPath);
    return { ok: false, error: { code: "write_failed" } };
  }
}

function byspaceConfigRevisionsEqual(
  left: BySpaceConfigRevision | null,
  right: BySpaceConfigRevision | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.mtimeMs === right.mtimeMs && left.size === right.size;
}

function removeTempBySpaceConfig(tempPath: string): void {
  try {
    rmSync(tempPath, { force: true });
  } catch {
    // Best-effort cleanup only; callers need the original write outcome.
  }
}
