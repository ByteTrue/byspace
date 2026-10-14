import path from "node:path";

import type { Logger } from "pino";

import type {
  PersistedWorkspaceRecord,
  ProjectRegistry,
  WorkspaceRegistry,
} from "./workspace-registry.js";

/**
 * Display title of the daemon-owned home workspace: the role that lives in it.
 * Kept in step with the built-in `chief` role (agent/agent-roles.ts) and the
 * app's `agentControls.role.chief` string — one name for one thing.
 */
export const HOME_WORKSPACE_TITLE = "Chief";

/**
 * Titles this daemon has published for the Home workspace. A record holding one
 * of them was named by the daemon, not by the user, so a later release may
 * rename it; anything else is a user rename and is left alone.
 */
const PREVIOUS_HOME_WORKSPACE_TITLES: ReadonlySet<string> = new Set(["Home"]);

/**
 * Names this daemon has published for the Home project before the current one,
 * with the same rule as PREVIOUS_HOME_WORKSPACE_TITLES: our own earlier name is
 * still ours to change, anything else is a user rename.
 *
 * Renaming the project means changing HOME_PROJECT_NAME and moving the old name
 * in here. Matching only "no customName yet" would rename the row once and then
 * read our own name as the user's, freezing it against every later release.
 */
const PREVIOUS_HOME_PROJECT_NAMES: ReadonlySet<string> = new Set<string>();

/**
 * Display name of the project that contains the Home workspace.
 *
 * Without it the sidebar shows the raw directory basename ("byspace" or
 * ".byspace" depending on the platform), which reads as a project the user must
 * have added. The project is incidental — it is what a directory workspace
 * without a projectId materializes — and naming it after the product says so.
 * Stored as a project customName, the same field the rename UI writes.
 */
export const HOME_PROJECT_NAME = "BySpace-WorkSpace";

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
    ): Promise<{
      workspaceId: string;
      projectId: string;
      title?: string | null;
      labels?: string[];
      archivedAt?: string | null;
    }>;
  };
  logger: Logger;
}

/**
 * Ensure the daemon-owned Home workspace exists — the workspace the built-in
 * assistant lives in. It is a plain directory workspace rooted at the BySpace
 * home directory, created through the same provisioning path as a user's
 * workspace.create without a projectId — which materializes a containing
 * project for `~/.byspace`. Idempotent: matches by
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
 *
 * Names are presentation, not identity: the title and the containing project's
 * name are re-applied on every boot, because releases change them. A record the
 * user renamed carries that rename and is never touched.
 */
export async function ensureHomeWorkspace(
  deps: EnsureHomeWorkspaceDeps,
): Promise<EnsureHomeWorkspaceResult | null> {
  const homeCwd = path.resolve(deps.byspaceHome);
  const existing = (await deps.workspaceRegistry.list()).find((workspace) =>
    workspace.labels?.includes(HOME_WORKSPACE_LABEL),
  );
  if (existing) {
    // Presentation is re-asserted on every boot, not only at creation, because
    // the names are the daemon's and releases change them. Records the user
    // renamed are recognized and left alone.
    await ensureHomePresentation(deps, existing);
    return { workspaceId: existing.workspaceId, created: false };
  }

  try {
    const workspace = await deps.provisioning.createWorkspaceForDirectory(
      homeCwd,
      HOME_WORKSPACE_TITLE,
    );
    await ensureHomePresentation(deps, workspace);
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
 * Bring the Home record's presentation up to date: the reserved label that
 * identifies it, the workspace title, and the containing project's name.
 * Best-effort — none of it is worth blocking boot over.
 *
 * Reads the record back before deciding: the caller's copy comes from an earlier
 * list, and a rename landing between the two must not be overwritten.
 */
async function ensureHomePresentation(
  deps: EnsureHomeWorkspaceDeps,
  workspace: { workspaceId: string },
): Promise<void> {
  try {
    const records = await deps.workspaceRegistry.list();
    const record = records.find((w) => w.workspaceId === workspace.workspaceId);
    if (!record) return;
    // An archived Home is a user decision, not a stale record: leave it, and its
    // name, untouched.
    if (record.archivedAt) return;
    await applyWorkspacePresentation(deps, record);
    await applyProjectName(deps, { record, records });
  } catch (error) {
    deps.logger.warn(
      { err: error, workspaceId: workspace.workspaceId },
      "Failed to load home workspace",
    );
  }
}

/** True when a title is this daemon's rather than a name the user chose. */
function isDaemonAuthoredTitle(title: string | null | undefined): boolean {
  return (
    title === null ||
    title === undefined ||
    title === HOME_WORKSPACE_TITLE ||
    PREVIOUS_HOME_WORKSPACE_TITLES.has(title)
  );
}

/** True when a project name is this daemon's rather than a name the user chose. */
function isDaemonAuthoredProjectName(customName: string | null | undefined): boolean {
  return (
    customName === null ||
    customName === undefined ||
    customName === HOME_PROJECT_NAME ||
    PREVIOUS_HOME_PROJECT_NAMES.has(customName)
  );
}

/** Stamp the reserved label and re-assert the title, without churning a record
 * that already carries both. */
async function applyWorkspacePresentation(
  deps: EnsureHomeWorkspaceDeps,
  record: PersistedWorkspaceRecord,
): Promise<void> {
  const labelMissing = record.labels?.includes(HOME_WORKSPACE_LABEL) !== true;
  const titleNeedsApply =
    isDaemonAuthoredTitle(record.title) && record.title !== HOME_WORKSPACE_TITLE;
  if (!labelMissing && !titleNeedsApply) return;

  try {
    await deps.workspaceRegistry.upsert({
      ...record,
      labels: [...new Set([...(record.labels ?? []), HOME_WORKSPACE_LABEL])],
      title: titleNeedsApply ? HOME_WORKSPACE_TITLE : record.title,
    });
  } catch (error) {
    deps.logger.warn(
      { err: error, workspaceId: record.workspaceId },
      "Failed to update home workspace record",
    );
  }
}

/**
 * Name the containing project after the product, unless the user named it or the
 * project is not Home's alone.
 *
 * A directory workspace without a projectId reuses any active project already
 * rooted at the same path, so a user who added the BySpace home directory as a
 * project themselves shares this row. Naming it would rename their project, so
 * take the project only when Home is its only workspace — which is what
 * provisioning leaves behind when the daemon created the project for Home.
 */
async function applyProjectName(
  deps: EnsureHomeWorkspaceDeps,
  input: { record: PersistedWorkspaceRecord; records: readonly PersistedWorkspaceRecord[] },
): Promise<void> {
  const { record, records } = input;
  const projectIsHomesAlone =
    records.filter((workspace) => workspace.projectId === record.projectId).length === 1;
  if (!projectIsHomesAlone) return;

  try {
    const project = await deps.projectRegistry.get(record.projectId);
    if (!project) return;
    if (!isDaemonAuthoredProjectName(project.customName)) return;
    if (project.customName === HOME_PROJECT_NAME) return;
    await deps.projectRegistry.upsert({
      ...project,
      customName: HOME_PROJECT_NAME,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    deps.logger.warn({ err: error, projectId: record.projectId }, "Failed to name home project");
  }
}
