/** Formats a version string with a `v` prefix (web-only helper). */
export function formatVersionWithPrefix(version: string | null | undefined): string {
  if (!version) return "—";
  return version.startsWith("v") ? version : `v${version}`;
}
