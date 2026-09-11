/** Plugin registry shim (issue 025 C6): nothing is ever installed. */
export function useInstalledPlugins(): [] {
  return [];
}
export function getInstalledPlugins(): [] {
  return [];
}
