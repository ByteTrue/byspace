import type { WorkspaceDescriptor } from "@/stores/session-store";

/** Reserved label the daemon stamps on its Home workspace. */
export const HOME_WORKSPACE_LABEL = "byspace.home-workspace";

/**
 * View key of the project that holds every host's Home workspace.
 *
 * Each daemon creates its own Home project and persists a host-scoped
 * `projectKey` for it (`host:<serverId>:<path>`), so by key alone the machines
 * never group. This reserved key is what the structure builder assigns instead:
 * it is what merges the placements into one sidebar row, and what every surface
 * that has to treat the Chief project specially matches on.
 *
 * It cannot collide with a real key: those are `remote:…` / `host:…` strings or
 * JSON placement keys, and a daemon-side project key never starts with `home:`.
 */
export const HOME_PROJECT_VIEW_KEY = "home:chief";

export const CHIEF_ROLE_NAME = "chief";

/**
 * The reserved label is the identity, and the only one. Matching titles or
 * paths would claim a workspace the user opened themselves — a "Chief" or
 * "Home" title, or any directory ending in .byspace — and treat it as the
 * daemon-managed Home workspace.
 */
export function isHomeWorkspace(
  workspace: { labels?: readonly string[] | null } | null | undefined,
): boolean {
  return workspace?.labels?.includes(HOME_WORKSPACE_LABEL) === true;
}

export function isHomeProjectViewKey(viewKey: string | null | undefined): boolean {
  return viewKey === HOME_PROJECT_VIEW_KEY;
}

/** The Home workspace of a session, if that host advertises one. */
export function findHomeWorkspace(
  workspaces: Iterable<WorkspaceDescriptor> | null | undefined,
): WorkspaceDescriptor | null {
  if (!workspaces) return null;
  for (const workspace of workspaces) {
    if (isHomeWorkspace(workspace)) return workspace;
  }
  return null;
}
