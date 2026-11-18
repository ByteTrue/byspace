// web/package.json: scripts/sync-workspace-versions.mjs keeps every workspace at the release version.
import appPackage from "../../../package.json";

function toVersionOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed;
}

export function resolveAppVersion(): string | null {
  return toVersionOrNull(appPackage?.version);
}
