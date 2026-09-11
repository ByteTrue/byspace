/** Desktop update channel shim (Electron retired, issue 025 A3). */
export function formatVersionWithPrefix(version: string | null | undefined): string {
  if (!version) return "—";
  return version.startsWith("v") ? version : `v${version}`;
}

export function isVersionMismatch(
  current: string | null | undefined,
  other: string | null | undefined,
): boolean {
  if (!current || !other) return false;
  return current !== other;
}
