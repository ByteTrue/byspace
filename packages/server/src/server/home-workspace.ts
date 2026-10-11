import path from "node:path";

import type { Logger } from "pino";

import type { WorkspaceRegistry, ProjectRegistry } from "./workspace-registry.js";

/** Display title of the daemon-owned home workspace. */
export const HOME_WORKSPACE_TITLE = "Home";

export interface EnsureHomeWorkspaceResult {
  workspaceId: string;
  created: boolean;
}

/**
 * Ensure the daemon-owned "Home" workspace exists. It is a plain directory
 * workspace rooted at the BySpace home directory, created through the same
 * provisioning path as a user's workspace.create without a projectId — which
 * materializes a containing project for `~/.byspace`. Idempotent: matches by
 * resolved cwd, including archived workspaces (an archived Home is left alone;
 * resurrecting it is a user action, not bootstrap's).
 *
 * The workspace hosts the built-in Chief agent so a fresh daemon has somewhere
 * for a first conversation before any project exists
 * (byissue/epics/005-o-chief-floating-assistant).
 */
/**
 * Same as ensureHomeWorkspace but reads the test-harness kill switch first:
 * BYSPACE_DISABLE_HOME_WORKSPACE=1 (set by server vitest setup and e2e
 * daemon helpers) skips creation so specs keep assuming exact workspace
 * counts and Windows teardown avoids EBUSY on the watched home dir.
 */
export async function ensureHomeWorkspaceUnlessDisabled(deps: {
  byspaceHome: string;
  workspaceRegistry: WorkspaceRegistry;
  projectRegistry: ProjectRegistry;
  provisioning: {
    createWorkspaceForDirectory(
      cwd: string,
      title?: string | null,
      projectId?: string,
    ): Promise<{ workspaceId: string }>;
  };
  logger: Logger;
}): Promise<EnsureHomeWorkspaceResult | null> {
  if (process.env.BYSPACE_DISABLE_HOME_WORKSPACE === "1") return null;
  return ensureHomeWorkspace(deps);
}

export async function ensureHomeWorkspace(deps: {
  byspaceHome: string;
  workspaceRegistry: WorkspaceRegistry;
  projectRegistry: ProjectRegistry;
  provisioning: {
    createWorkspaceForDirectory(
      cwd: string,
      title?: string | null,
      projectId?: string,
    ): Promise<{ workspaceId: string }>;
  };
  logger: Logger;
}): Promise<EnsureHomeWorkspaceResult | null> {
  const homeCwd = path.resolve(deps.byspaceHome);
  const existing = (await deps.workspaceRegistry.list()).find(
    (workspace) => path.resolve(workspace.cwd) === homeCwd,
  );
  if (existing) {
    return { workspaceId: existing.workspaceId, created: false };
  }
  try {
    const workspace = await deps.provisioning.createWorkspaceForDirectory(
      homeCwd,
      HOME_WORKSPACE_TITLE,
    );
    deps.logger.info(
      { workspaceId: workspace.workspaceId, cwd: homeCwd },
      "Home workspace ensured",
    );
    return { workspaceId: workspace.workspaceId, created: true };
  } catch (error) {
    // Home is a convenience, not a boot blocker: a fresh daemon without a
    // writable home dir must still start.
    deps.logger.warn({ err: error, cwd: homeCwd }, "Failed to ensure home workspace");
    return null;
  }
}
