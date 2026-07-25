import os from "node:os";
import path from "node:path";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";

import { afterEach, beforeEach, expect, test } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { createNoopWorkspaceGitService } from "../../test-utils/workspace-git-service-stub.js";
import {
  FileBackedProjectRegistry,
  FileBackedWorkspaceRegistry,
  type PersistedProjectRecord,
} from "../../workspace-registry.js";
import type { CreateBySpaceWorktreeWorkflowResult } from "../../worktree-session.js";
import { WorkspaceLifecycleCoordinator } from "../../workspace-lifecycle-coordinator.js";
import {
  createWorkspaceProvisioningService,
  type WorkspaceProvisioningService,
} from "./workspace-provisioning-service.js";

// Real file-backed registries + a fake git-service port (the only dependency that
// shells out to git in production). No module mocks — the service is exercised
// through the same interface its callers in session.ts use.

const logger = createTestLogger();
const ARCHIVED_AT = "2026-01-01T00:00:00.000Z";
const directorySymlinkType = process.platform === "win32" ? "junction" : "dir";

let tmpDir: string;
let gitRoots: Set<string>;
let workspaceRegistry: FileBackedWorkspaceRegistry;
let projectRegistry: FileBackedProjectRegistry;
let provisioning: WorkspaceProvisioningService;

class FailingWorkspaceRegistry extends FileBackedWorkspaceRegistry {
  failNextUpsert = false;
  readonly events: string[] = [];

  override async upsert(
    record: Parameters<FileBackedWorkspaceRegistry["upsert"]>[0],
    context?: Parameters<FileBackedWorkspaceRegistry["upsert"]>[1],
  ): Promise<void> {
    if (this.failNextUpsert) {
      this.failNextUpsert = false;
      this.events.push("workspace:persist-failed");
      throw new Error("workspace registry write failed");
    }
    await super.upsert(record, context);
  }
}

function gitService() {
  return createNoopWorkspaceGitService({
    peekSnapshot: () => null,
    getCheckout: async (cwd: string) => {
      let worktreeRoot: string | null = null;
      for (const root of gitRoots) {
        if (
          (cwd === root || cwd.startsWith(`${root}${path.sep}`)) &&
          root.length > (worktreeRoot?.length ?? -1)
        ) {
          worktreeRoot = root;
        }
      }
      return {
        cwd,
        isGit: worktreeRoot !== null,
        currentBranch: worktreeRoot ? "main" : null,
        remoteUrl: null,
        worktreeRoot,
        isBySpaceOwnedWorktree: false,
        mainRepoRoot: null,
      };
    },
  });
}

beforeEach(async () => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "workspace-provisioning-"));
  gitRoots = new Set();
  workspaceRegistry = new FileBackedWorkspaceRegistry(
    path.join(tmpDir, "projects", "workspaces.json"),
    logger,
  );
  projectRegistry = new FileBackedProjectRegistry(
    path.join(tmpDir, "projects", "projects.json"),
    logger,
  );
  await workspaceRegistry.initialize();
  await projectRegistry.initialize();
  provisioning = createWorkspaceProvisioningService({
    workspaceRegistry,
    projectRegistry,
    workspaceGitService: gitService(),
    isDirectory: async () => true,
    logger,
  });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

test("fresh git repo creates a workspace at the canonical worktree root", async () => {
  const repo = path.join(tmpDir, "repo");
  gitRoots.add(repo);

  const workspace = await provisioning.findOrCreateWorkspaceForDirectory(repo);

  expect(workspace.cwd).toBe(repo);
  expect(await workspaceRegistry.list()).toHaveLength(1);
  expect(await projectRegistry.list()).toHaveLength(1);
});

test("fresh non-git directory creates a directory workspace at the exact path", async () => {
  const dir = path.join(tmpDir, "plain");

  const workspace = await provisioning.findOrCreateWorkspaceForDirectory(dir);

  expect(workspace.cwd).toBe(dir);
});

test("re-opening an active workspace by exact path returns the same record without duplicating", async () => {
  const repo = path.join(tmpDir, "repo");
  gitRoots.add(repo);

  const first = await provisioning.findOrCreateWorkspaceForDirectory(repo);
  const second = await provisioning.findOrCreateWorkspaceForDirectory(repo);

  expect(second.workspaceId).toBe(first.workspaceId);
  expect(await workspaceRegistry.list()).toHaveLength(1);
});

test("re-opening an archived workspace by its exact path unarchives it and keeps the id", async () => {
  const repo = path.join(tmpDir, "repo");
  gitRoots.add(repo);
  const created = await provisioning.findOrCreateWorkspaceForDirectory(repo);
  await workspaceRegistry.archive(created.workspaceId, ARCHIVED_AT);

  const reopened = await provisioning.findOrCreateWorkspaceForDirectory(repo);

  expect(reopened.workspaceId).toBe(created.workspaceId);
  expect(reopened.archivedAt).toBeNull();
});

test("opening a subpath of an archived git workspace mints a fresh workspace at the exact subpath", async () => {
  const repo = path.join(tmpDir, "repo");
  gitRoots.add(repo);
  const canonical = await provisioning.findOrCreateWorkspaceForDirectory(repo);
  await workspaceRegistry.archive(canonical.workspaceId, ARCHIVED_AT);
  const sub = path.join(repo, "packages", "app");

  const fresh = await provisioning.findOrCreateWorkspaceForDirectory(sub);

  expect(fresh.cwd).toBe(sub);
  expect(fresh.workspaceId).not.toBe(canonical.workspaceId);
  expect((await workspaceRegistry.get(canonical.workspaceId))?.archivedAt).toBe(ARCHIVED_AT);
});

test("ensureWorkspaceRecordUnarchived clears archivedAt on the workspace and its project", async () => {
  const repo = path.join(tmpDir, "repo");
  gitRoots.add(repo);
  const created = await provisioning.findOrCreateWorkspaceForDirectory(repo);
  await projectRegistry.archive(created.projectId, ARCHIVED_AT);

  const unarchived = await provisioning.ensureWorkspaceRecordUnarchived({
    ...created,
    archivedAt: ARCHIVED_AT,
  });

  expect(unarchived.archivedAt).toBeNull();
  expect((await workspaceRegistry.get(created.workspaceId))?.archivedAt).toBeNull();
  expect((await projectRegistry.get(created.projectId))?.archivedAt).toBeNull();
});

test("restores the prior project record when workspace unarchive persistence fails", async () => {
  const repo = path.join(tmpDir, "repo");
  gitRoots.add(repo);
  const failingWorkspaceRegistry = new FailingWorkspaceRegistry(
    path.join(tmpDir, "projects", "failing-workspaces.json"),
    logger,
  );
  await failingWorkspaceRegistry.initialize();
  const failingProvisioning = createWorkspaceProvisioningService({
    workspaceRegistry: failingWorkspaceRegistry,
    projectRegistry,
    workspaceGitService: gitService(),
    isDirectory: async () => true,
    logger,
  });
  const created = await failingProvisioning.createWorkspaceForDirectory(repo);
  await projectRegistry.archive(created.projectId, ARCHIVED_AT);
  await failingWorkspaceRegistry.archive(created.workspaceId, ARCHIVED_AT);
  const priorProject = await projectRegistry.get(created.projectId);
  projectRegistry.subscribeToMutations?.((mutation) => {
    failingWorkspaceRegistry.events.push(
      `project:${mutation.project?.archivedAt ? "archived" : "active"}`,
    );
  });
  failingWorkspaceRegistry.failNextUpsert = true;

  await expect(
    failingProvisioning.ensureWorkspaceRecordUnarchived({
      ...created,
      archivedAt: ARCHIVED_AT,
    }),
  ).rejects.toThrow("workspace registry write failed");

  expect(failingWorkspaceRegistry.events).toEqual([
    "project:active",
    "workspace:persist-failed",
    "project:archived",
  ]);
  expect(await projectRegistry.get(created.projectId)).toEqual(priorProject);
  expect((await failingWorkspaceRegistry.get(created.workspaceId))?.archivedAt).toBe(ARCHIVED_AT);
});

test("resolveOrCreateWorkspaceIdForCreateAgent returns a created worktree's id without touching the registry", async () => {
  // The branch only reads workspace.workspaceId off the worktree result.
  const createdWorktree = {
    workspace: { workspaceId: "ws-from-worktree" },
  } as unknown as CreateBySpaceWorktreeWorkflowResult;

  const id = await provisioning.resolveOrCreateWorkspaceIdForCreateAgent({
    createdWorktree,
    cwd: path.join(tmpDir, "x"),
    initialTitle: null,
  });

  expect(id).toBe("ws-from-worktree");
  expect(await workspaceRegistry.list()).toHaveLength(0);
});

test("resolveOrCreateWorkspaceIdForCreateAgent honors an explicitly requested workspace id", async () => {
  const id = await provisioning.resolveOrCreateWorkspaceIdForCreateAgent({
    createdWorktree: null,
    requestedWorkspaceId: "ws-requested",
    cwd: path.join(tmpDir, "x"),
    initialTitle: null,
  });

  expect(id).toBe("ws-requested");
  expect(await workspaceRegistry.list()).toHaveLength(0);
});

test("resolveOrCreateWorkspaceIdForCreateAgent creates a titled workspace when nothing is provided", async () => {
  const dir = path.join(tmpDir, "plain");

  const id = await provisioning.resolveOrCreateWorkspaceIdForCreateAgent({
    createdWorktree: null,
    cwd: dir,
    initialTitle: "My Title",
  });

  const created = await workspaceRegistry.get(id);
  expect(created?.cwd).toBe(dir);
  expect(created?.title).toBe("My Title");
});

test("createWorkspaceForDirectory always mints a fresh workspace even when one already occupies the cwd", async () => {
  const repo = path.join(tmpDir, "repo");
  gitRoots.add(repo);

  const first = await provisioning.createWorkspaceForDirectory(repo);
  const second = await provisioning.createWorkspaceForDirectory(repo);

  expect(second.workspaceId).not.toBe(first.workspaceId);
  expect(await workspaceRegistry.list()).toHaveLength(2);
});

test("nested selected roots receive independent opaque project identities", async () => {
  const repo = path.join(tmpDir, "repo");
  const nested = path.join(repo, "packages", "app");
  gitRoots.add(repo);

  const outerProject = await provisioning.findOrCreateProjectForDirectory(repo);
  const nestedProject = await provisioning.findOrCreateProjectForDirectory(nested);

  expect(outerProject.projectId).toMatch(/^prj_[0-9a-f]{16}$/);
  expect(nestedProject.projectId).toMatch(/^prj_[0-9a-f]{16}$/);
  expect(nestedProject.projectId).not.toBe(outerProject.projectId);
  expect(await projectRegistry.list()).toHaveLength(2);
});

test("concurrent registration of the same selected root creates one project", async () => {
  const repo = path.join(tmpDir, "repo");
  gitRoots.add(repo);

  const [left, right] = await Promise.all([
    provisioning.findOrCreateProjectForDirectory(repo),
    provisioning.findOrCreateProjectForDirectory(path.join(repo, ".")),
  ]);

  expect(left.projectId).toMatch(/^prj_[0-9a-f]{16}$/);
  expect(right.projectId).toBe(left.projectId);
  expect(await projectRegistry.list()).toHaveLength(1);
});

test("runInImportWorkspace uses an active requested workspace without creating another", async () => {
  const cwd = path.join(tmpDir, "requested");
  mkdirSync(cwd);
  const workspace = await provisioning.createWorkspaceForDirectory(cwd);

  const result = await provisioning.runInImportWorkspace(
    { cwd, requestedWorkspaceId: workspace.workspaceId },
    async (target) => target.workspaceId,
  );

  expect(result).toEqual({ value: workspace.workspaceId, createdWorkspace: null });
  expect(await workspaceRegistry.list()).toEqual([workspace]);
});

test.each(["missing", "archived"] as const)(
  "runInImportWorkspace rejects a %s requested workspace before importing",
  async (state) => {
    const cwd = path.join(tmpDir, "unavailable-workspace");
    mkdirSync(cwd);
    const workspace = await provisioning.createWorkspaceForDirectory(cwd);
    if (state === "archived") {
      await workspaceRegistry.archive(workspace.workspaceId, ARCHIVED_AT);
    } else {
      await workspaceRegistry.remove(workspace.workspaceId);
    }
    let imported = false;

    await expect(
      provisioning.runInImportWorkspace(
        { cwd, requestedWorkspaceId: workspace.workspaceId },
        async () => {
          imported = true;
        },
      ),
    ).rejects.toThrow(`Workspace not found: ${workspace.workspaceId}`);
    expect(imported).toBe(false);
  },
);

test.each(["missing", "archived"] as const)(
  "runInImportWorkspace rejects a requested workspace whose project is %s before importing",
  async (state) => {
    const cwd = path.join(tmpDir, "unavailable-project");
    mkdirSync(cwd);
    const workspace = await provisioning.createWorkspaceForDirectory(cwd);
    if (state === "archived") {
      await projectRegistry.archive(workspace.projectId, ARCHIVED_AT);
    } else {
      await projectRegistry.remove(workspace.projectId);
    }
    let imported = false;

    await expect(
      provisioning.runInImportWorkspace(
        { cwd, requestedWorkspaceId: workspace.workspaceId },
        async () => {
          imported = true;
        },
      ),
    ).rejects.toThrow(`Project not found: ${workspace.projectId}`);
    expect(imported).toBe(false);
  },
);

test("runInImportWorkspace accepts a filesystem-equivalent requested cwd", async () => {
  const cwd = path.join(tmpDir, "real-directory");
  const alias = path.join(tmpDir, "directory-alias");
  mkdirSync(cwd);
  symlinkSync(cwd, alias, directorySymlinkType);
  const workspace = await provisioning.createWorkspaceForDirectory(cwd);

  const result = await provisioning.runInImportWorkspace(
    { cwd: alias, requestedWorkspaceId: workspace.workspaceId },
    async (target) => target.workspaceId,
  );

  expect(result.value).toBe(workspace.workspaceId);
});

test("runInImportWorkspace rejects a requested workspace with a different cwd", async () => {
  const cwd = path.join(tmpDir, "workspace-directory");
  const otherCwd = path.join(tmpDir, "other-directory");
  mkdirSync(cwd);
  mkdirSync(otherCwd);
  const workspace = await provisioning.createWorkspaceForDirectory(cwd);
  let imported = false;

  await expect(
    provisioning.runInImportWorkspace(
      { cwd: otherCwd, requestedWorkspaceId: workspace.workspaceId },
      async () => {
        imported = true;
      },
    ),
  ).rejects.toThrow(`Import cwd does not match workspace: ${workspace.workspaceId}`);
  expect(imported).toBe(false);
});

test("runInImportWorkspace creates one fresh workspace for an untargeted import", async () => {
  const cwd = path.join(tmpDir, "fresh-import");
  mkdirSync(cwd);

  const result = await provisioning.runInImportWorkspace(
    { cwd },
    async (workspace) => workspace.workspaceId,
  );

  expect(result.value).toBe(result.createdWorkspace?.workspaceId);
  expect(await workspaceRegistry.list()).toEqual([result.createdWorkspace]);
});

test.each(["missing", "archived"] as const)(
  "runInImportWorkspace restores the exact %s project state when an untargeted import fails",
  async (state) => {
    const cwd = path.join(tmpDir, `failed-import-${state}`);
    mkdirSync(cwd);
    let previousProject: PersistedProjectRecord | null = null;
    if (state === "archived") {
      const project = await provisioning.findOrCreateProjectForDirectory(cwd);
      await projectRegistry.archive(project.projectId, ARCHIVED_AT);
      previousProject = await projectRegistry.get(project.projectId);
    }

    await expect(
      provisioning.runInImportWorkspace({ cwd }, async () => {
        throw new Error("provider session is unavailable");
      }),
    ).rejects.toThrow("provider session is unavailable");

    expect(await workspaceRegistry.list()).toEqual([]);
    expect(await projectRegistry.list()).toEqual(previousProject ? [previousProject] : []);
  },
);

for (const target of ["requested", "untargeted"] as const) {
  test(`runInImportWorkspace keeps a ${target} import callback inside the archive barrier`, async () => {
    const cwd = path.join(tmpDir, `${target}-import-archive-race`);
    mkdirSync(cwd);
    const lifecycle = new WorkspaceLifecycleCoordinator();
    const raceProvisioning = createWorkspaceProvisioningService({
      workspaceRegistry,
      projectRegistry,
      workspaceGitService: gitService(),
      isDirectory: async () => true,
      logger,
      lifecycleCoordinator: lifecycle,
    });
    const requestedWorkspace =
      target === "requested" ? await raceProvisioning.createWorkspaceForDirectory(cwd) : null;
    let targetWorkspaceId: string | null = null;
    let signalImportEntered!: () => void;
    const importEntered = new Promise<void>((resolve) => {
      signalImportEntered = resolve;
    });
    let releaseImport!: () => void;
    const importGate = new Promise<void>((resolve) => {
      releaseImport = resolve;
    });
    const liveAgentWorkspaceIds: string[] = [];

    const importOperation = raceProvisioning.runInImportWorkspace(
      {
        cwd,
        ...(requestedWorkspace ? { requestedWorkspaceId: requestedWorkspace.workspaceId } : {}),
      },
      async (workspace) => {
        targetWorkspaceId = workspace.workspaceId;
        signalImportEntered();
        await importGate;
        liveAgentWorkspaceIds.push(workspace.workspaceId);
        return workspace.workspaceId;
      },
    );
    await importEntered;

    let archiveCompleted = false;
    const archiveOperation = lifecycle.runExclusive(async () => {
      const workspaceId = targetWorkspaceId;
      if (!workspaceId) throw new Error("Import did not resolve a workspace");
      liveAgentWorkspaceIds.splice(
        0,
        liveAgentWorkspaceIds.length,
        ...liveAgentWorkspaceIds.filter((candidate) => candidate !== workspaceId),
      );
      await workspaceRegistry.archive(workspaceId, ARCHIVED_AT);
      archiveCompleted = true;
    });
    await Promise.resolve();
    expect(archiveCompleted).toBe(false);

    releaseImport();
    const [result] = await Promise.all([importOperation, archiveOperation]);
    const workspaceId = result.value;
    expect(workspaceId).toBe(targetWorkspaceId);
    expect((await workspaceRegistry.get(workspaceId))?.archivedAt).toBe(ARCHIVED_AT);
    expect(liveAgentWorkspaceIds).toEqual([]);
  });
}
