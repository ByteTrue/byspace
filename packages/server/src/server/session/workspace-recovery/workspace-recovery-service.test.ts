import { describe, expect, test } from "vitest";
import {
  createPersistedProjectRecord,
  createPersistedWorkspaceRecord,
  type PersistedProjectRecord,
  type PersistedWorkspaceRecord,
} from "../../workspace-registry.js";
import { WorkspaceLifecycleCoordinator } from "../../workspace-lifecycle-coordinator.js";
import { createWorkspaceRecoveryService } from "./workspace-recovery-service.js";

const NOW = "2026-07-11T10:12:30.752Z";

function createProject(): PersistedProjectRecord {
  return createPersistedProjectRecord({
    projectId: "/repo",
    rootPath: "/repo",
    kind: "git",
    displayName: "repo",
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function createWorkspace(
  overrides: Partial<PersistedWorkspaceRecord> = {},
): PersistedWorkspaceRecord {
  return createPersistedWorkspaceRecord({
    workspaceId: "wks_15a1b5630ebaab33",
    projectId: "/repo",
    cwd: "/worktrees/trigger-1525443412986298439",
    kind: "worktree",
    displayName: "diagnose-repro-tdd",
    title: "Codex TDD reproduction",
    branch: "diagnose-repro-tdd",
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: NOW,
    ...overrides,
  });
}

function createHarness(input?: {
  workspace?: PersistedWorkspaceRecord | null;
  project?: PersistedProjectRecord | null;
  directories?: string[];
  recreate?: (workspace: PersistedWorkspaceRecord) => Promise<void>;
  rollback?: (workspace: PersistedWorkspaceRecord) => Promise<void>;
  unarchive?: (workspace: PersistedWorkspaceRecord) => Promise<void>;
  lifecycleCoordinator?: WorkspaceLifecycleCoordinator;
}) {
  const workspace = input?.workspace === undefined ? createWorkspace() : input.workspace;
  const project = input?.project === undefined ? createProject() : input.project;
  const directories = new Set(input?.directories ?? ["/repo"]);
  const unarchived: string[] = [];
  const recreated: string[] = [];
  const rolledBack: string[] = [];
  const service = createWorkspaceRecoveryService({
    byspaceHome: "/byspace-home",
    getWorkspace: async (workspaceId) =>
      workspace?.workspaceId === workspaceId ? workspace : null,
    getProject: async (projectId) => (project?.projectId === projectId ? project : null),
    isDirectory: async (path) => directories.has(path),
    recreateWorktree: async (record) => {
      recreated.push(record.workspaceId);
      await input?.recreate?.(record);
      return {
        rollback: async (cause) => {
          rolledBack.push(record.workspaceId);
          await input?.rollback?.(record);
          throw cause;
        },
      };
    },
    unarchiveWorkspace: async (record) => {
      await input?.unarchive?.(record);
      unarchived.push(record.workspaceId);
    },
    lifecycleCoordinator: input?.lifecycleCoordinator,
  });
  return { service, recreated, rolledBack, unarchived };
}

describe("workspace recovery", () => {
  test("authoritatively describes the archived missing worktree from the failed cloud run", async () => {
    const { service, recreated, unarchived } = createHarness();

    await expect(service.inspect("wks_15a1b5630ebaab33")).resolves.toEqual({
      kind: "recoverable",
      workspaceId: "wks_15a1b5630ebaab33",
      workspaceName: "Codex TDD reproduction",
      action: "restore",
      branch: "diagnose-repro-tdd",
    });
    expect(recreated).toEqual([]);
    expect(unarchived).toEqual([]);
  });

  test("describes an archived workspace whose directory remains as unarchivable", async () => {
    const workspace = createWorkspace({ kind: "directory", branch: null });
    const { service } = createHarness({
      workspace,
      directories: ["/repo", workspace.cwd],
    });

    await expect(service.inspect(workspace.workspaceId)).resolves.toMatchObject({
      kind: "recoverable",
      action: "unarchive",
    });
  });

  test("does not offer recovery for a missing non-worktree directory", async () => {
    const workspace = createWorkspace({ kind: "directory", branch: null });
    const { service } = createHarness({ workspace });

    await expect(service.inspect(workspace.workspaceId)).resolves.toEqual({
      kind: "unavailable",
      workspaceId: workspace.workspaceId,
      reason: "workspace_directory_missing",
      message: "The archived workspace directory no longer exists and cannot be recreated.",
    });
  });

  test("keeps the workspace archived when recreation fails so restore can be retried", async () => {
    let attempts = 0;
    const { service, recreated, unarchived } = createHarness({
      recreate: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("git branch diagnose-repro-tdd is unavailable");
        }
      },
    });

    await expect(service.restore("wks_15a1b5630ebaab33")).rejects.toThrow(
      "git branch diagnose-repro-tdd is unavailable",
    );
    expect(unarchived).toEqual([]);

    await expect(service.restore("wks_15a1b5630ebaab33")).resolves.toEqual({
      workspaceId: "wks_15a1b5630ebaab33",
      action: "restore",
    });
    expect(recreated).toEqual(["wks_15a1b5630ebaab33", "wks_15a1b5630ebaab33"]);
    expect(unarchived).toEqual(["wks_15a1b5630ebaab33"]);
  });

  test("rolls back a recreated worktree when the registry update fails", async () => {
    let recreatedDirectoryExists = false;
    const { service, rolledBack, unarchived } = createHarness({
      recreate: async () => {
        recreatedDirectoryExists = true;
      },
      rollback: async () => {
        recreatedDirectoryExists = false;
      },
      unarchive: async () => {
        throw new Error("workspace registry write failed");
      },
    });

    await expect(service.restore("wks_15a1b5630ebaab33")).rejects.toThrow(
      "workspace registry write failed",
    );

    expect(recreatedDirectoryExists).toBe(false);
    expect(rolledBack).toEqual(["wks_15a1b5630ebaab33"]);
    expect(unarchived).toEqual([]);
  });

  test("holds the lifecycle barrier from recreation through registry update", async () => {
    const coordinator = new WorkspaceLifecycleCoordinator();
    let project: PersistedProjectRecord | null = createProject();
    let workspace: PersistedWorkspaceRecord | null = createWorkspace();
    let recreatedDirectoryExists = false;
    const events: string[] = [];
    let signalRecreated!: () => void;
    const recreated = new Promise<void>((resolve) => {
      signalRecreated = resolve;
    });
    let releaseRecreation!: () => void;
    const recreationGate = new Promise<void>((resolve) => {
      releaseRecreation = resolve;
    });
    const service = createWorkspaceRecoveryService({
      byspaceHome: "/byspace-home",
      getWorkspace: async (workspaceId) =>
        workspace?.workspaceId === workspaceId ? workspace : null,
      getProject: async (projectId) => (project?.projectId === projectId ? project : null),
      isDirectory: async (target) => target === "/repo",
      lifecycleCoordinator: coordinator,
      recreateWorktree: async () => {
        events.push("recreate");
        recreatedDirectoryExists = true;
        signalRecreated();
        await recreationGate;
        return {
          rollback: async (cause) => {
            recreatedDirectoryExists = false;
            throw cause;
          },
        };
      },
      unarchiveWorkspace: async (record) => {
        events.push("unarchive");
        workspace = { ...record, archivedAt: null };
      },
    });

    const recovery = service.restore("wks_15a1b5630ebaab33");
    await recreated;
    const removal = coordinator.runExclusive(async () => {
      events.push("remove");
      if (workspace && !workspace.archivedAt) recreatedDirectoryExists = false;
      workspace = null;
      project = null;
    });
    await Promise.resolve();

    expect(events).toEqual(["recreate"]);
    expect(project).not.toBeNull();

    releaseRecreation();
    await Promise.all([recovery, removal]);

    expect(events).toEqual(["recreate", "unarchive", "remove"]);
    expect(project).toBeNull();
    expect(workspace).toBeNull();
    expect(recreatedDirectoryExists).toBe(false);
  });
});
