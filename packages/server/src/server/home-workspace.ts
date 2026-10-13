import path from "node:path";

import type { Logger } from "pino";

import type { WorkspaceRegistry, ProjectRegistry } from "./workspace-registry.js";

/** Display title of the daemon-owned home workspace. */
export const HOME_WORKSPACE_TITLE = "Home";

/**
 * Reserved workspace label marking the daemon-owned Home workspace. The app
 * matches Chief to the Home workspace by this label instead of guessing from
 * titles or paths (user renames and custom BYSPACE_HOME would both defeat a
 * title/path heuristic). Reserved `byspace.*` labels are stripped from
 * user-initiated workspace.create payloads.
 */
export const HOME_WORKSPACE_LABEL = "byspace.home-workspace";

export interface EnsureHomeWorkspaceResult {
  workspaceId: string;
  created: boolean;
}

interface EnsureHomeWorkspaceDeps {
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
}

/**
 * Ensure the daemon-owned "Home" workspace exists. It is a plain directory
 * workspace rooted at the BySpace home directory, created through the same
 * provisioning path as a user's workspace.create without a projectId — which
 * materializes a containing project for `~/.byspace`. Idempotent: matches by
 * the reserved label, including archived workspaces (an archived Home is left
 * alone; resurrecting it is a user action, not bootstrap's).
 *
 * The label, not the cwd, is the identity. A workspace the user opened on the
 * BySpace home directory is theirs: claiming it by path would relabel it as Home
 * and hand Chief a session inside a workspace the user owns. With no labeled
 * Home present the daemon creates its own, and the user's record is left alone.
 *
 * The workspace hosts the built-in Chief agent so a fresh daemon has somewhere
 * for a first conversation before any project exists
 * (byissue/epics/005-o-chief-floating-assistant).
 */
export async function ensureHomeWorkspace(
  deps: EnsureHomeWorkspaceDeps,
): Promise<EnsureHomeWorkspaceResult | null> {
  const homeCwd = path.resolve(deps.byspaceHome);
  const existing = (await deps.workspaceRegistry.list()).find((workspace) =>
    workspace.labels?.includes(HOME_WORKSPACE_LABEL),
  );
  if (existing) {
    return { workspaceId: existing.workspaceId, created: false };
  }
  try {
    const workspace = await deps.provisioning.createWorkspaceForDirectory(
      homeCwd,
      HOME_WORKSPACE_TITLE,
    );
    await ensureHomeWorkspaceLabel(deps, workspace.workspaceId);
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

/**
 * Same as ensureHomeWorkspace but reads the test-harness kill switch first:
 * BYSPACE_DISABLE_HOME_WORKSPACE=1 (set by server vitest setup and e2e
 * daemon helpers) skips creation so specs keep assuming exact workspace
 * counts and Windows teardown avoids EBUSY on the watched home dir.
 */
export async function ensureHomeWorkspaceUnlessDisabled(
  deps: EnsureHomeWorkspaceDeps,
): Promise<EnsureHomeWorkspaceResult | null> {
  if (process.env.BYSPACE_DISABLE_HOME_WORKSPACE === "1") return null;
  return ensureHomeWorkspace(deps);
}

/**
 * Stamp the reserved Home label on the workspace the daemon just created.
 * Best-effort: a labeling failure never blocks boot.
 */
async function ensureHomeWorkspaceLabel(
  deps: EnsureHomeWorkspaceDeps,
  workspaceId: string,
): Promise<void> {
  const record = (await deps.workspaceRegistry.list()).find((w) => w.workspaceId === workspaceId);
  if (!record) return;
  try {
    await deps.workspaceRegistry.upsert({
      ...record,
      labels: [...new Set([...(record.labels ?? []), HOME_WORKSPACE_LABEL])],
    });
  } catch (error) {
    deps.logger.warn({ err: error, workspaceId }, "Failed to backfill home workspace label");
  }
}
