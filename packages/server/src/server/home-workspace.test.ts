import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import pino from "pino";

import {
  ensureHomeWorkspace,
  ensureHomeWorkspaceUnlessDisabled,
  HOME_WORKSPACE_LABEL,
  HOME_WORKSPACE_TITLE,
} from "./home-workspace.js";
import { FileBackedProjectRegistry, FileBackedWorkspaceRegistry } from "./workspace-registry.js";
import type { PersistedWorkspaceRecord } from "./workspace-registry.js";

const logger = pino({ level: "silent" });

function createRegistries(workdir: string) {
  const workspaceRegistry = new FileBackedWorkspaceRegistry(
    join(workdir, "workspaces.json"),
    logger,
  );
  const projectRegistry = new FileBackedProjectRegistry(join(workdir, "projects.json"), logger);
  return { workspaceRegistry, projectRegistry };
}

function createStubProvisioning(
  workspaceRegistry: InstanceType<typeof FileBackedWorkspaceRegistry>,
  projectRegistry: InstanceType<typeof FileBackedProjectRegistry>,
) {
  let callCount = 0;
  let lastCwd: string | null = null;
  let lastTitle: string | null | undefined;

  return {
    get callCount() {
      return callCount;
    },
    get lastCwd() {
      return lastCwd;
    },
    get lastTitle() {
      return lastTitle;
    },
    async createWorkspaceForDirectory(
      cwd: string,
      title?: string | null,
    ): Promise<PersistedWorkspaceRecord> {
      callCount++;
      lastCwd = cwd;
      lastTitle = title;
      const now = new Date().toISOString();
      const projectId = "prj_home";
      await projectRegistry.upsert({
        projectId,
        rootPath: cwd,
        kind: "non_git" as const,
        displayName: ".byspace",
        projectKey: "home",
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      });
      const workspace: PersistedWorkspaceRecord = {
        workspaceId: "wks_home",
        projectId,
        cwd,
        kind: "directory" as const,
        displayName: ".byspace",
        title: title ?? null,
        branch: null,
        worktreeRoot: null,
        baseBranch: null,
        isBySpaceOwnedWorktree: false,
        mainRepoRoot: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        autoArchivedChangeRequestUrl: null,
        pinnedAt: null,
        labels: [],
      };
      await workspaceRegistry.upsert(workspace);
      return workspace;
    },
  };
}

describe("ensureHomeWorkspace", () => {
  it("creates a directory workspace rooted at byspaceHome on first boot", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "home-ws-"));
    const { workspaceRegistry, projectRegistry } = createRegistries(workdir);
    const provisioning = createStubProvisioning(workspaceRegistry, projectRegistry);
    const homeDir = join(workdir, ".byspace");

    const result = await ensureHomeWorkspace({
      byspaceHome: homeDir,
      workspaceRegistry,
      projectRegistry,
      provisioning,
      logger,
    });

    expect(result).not.toBeNull();
    expect(result!.created).toBe(true);
    expect(provisioning.callCount).toBe(1);
    expect(provisioning.lastCwd).toBe(homeDir);
    expect(provisioning.lastTitle).toBe(HOME_WORKSPACE_TITLE);

    const workspaces = await workspaceRegistry.list();
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].title).toBe(HOME_WORKSPACE_TITLE);
  });

  it("is idempotent: second boot reuses the labeled Home", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "home-ws-"));
    const { workspaceRegistry, projectRegistry } = createRegistries(workdir);
    const provisioning = createStubProvisioning(workspaceRegistry, projectRegistry);
    const homeDir = join(workdir, ".byspace");

    const first = await ensureHomeWorkspace({
      byspaceHome: homeDir,
      workspaceRegistry,
      projectRegistry,
      provisioning,
      logger,
    });
    const second = await ensureHomeWorkspace({
      byspaceHome: homeDir,
      workspaceRegistry,
      projectRegistry,
      provisioning,
      logger,
    });

    expect(second!.workspaceId).toBe(first!.workspaceId);
    expect(second!.created).toBe(false);
    expect(provisioning.callCount).toBe(1); // no duplicate creation
    expect(await workspaceRegistry.list()).toHaveLength(1);
  });

  it("stamps the reserved home-workspace label on creation", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "home-ws-"));
    const { workspaceRegistry, projectRegistry } = createRegistries(workdir);
    const provisioning = createStubProvisioning(workspaceRegistry, projectRegistry);

    await ensureHomeWorkspace({
      byspaceHome: join(workdir, ".byspace"),
      workspaceRegistry,
      projectRegistry,
      provisioning,
      logger,
    });

    const [workspace] = await workspaceRegistry.list();
    expect(workspace.labels).toContain(HOME_WORKSPACE_LABEL);
  });

  it("creates its own Home instead of claiming an unlabeled workspace on the same path", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "home-ws-"));
    const { workspaceRegistry, projectRegistry } = createRegistries(workdir);
    const provisioning = createStubProvisioning(workspaceRegistry, projectRegistry);
    const homeDir = join(workdir, ".byspace");
    const now = new Date().toISOString();
    // A workspace the user opened on the BySpace home directory: same cwd as
    // Home, but not the daemon's. The path alone must not claim it.
    await projectRegistry.upsert({
      projectId: "prj_user",
      rootPath: homeDir,
      kind: "non_git",
      displayName: "user",
      projectKey: "user",
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });
    await workspaceRegistry.upsert({
      workspaceId: "wks_user",
      projectId: "prj_user",
      cwd: homeDir,
      kind: "directory",
      displayName: "my byspace dir",
      title: "My byspace dir",
      branch: null,
      worktreeRoot: null,
      baseBranch: null,
      isBySpaceOwnedWorktree: false,
      mainRepoRoot: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      autoArchivedChangeRequestUrl: null,
      pinnedAt: null,
      labels: [],
    });

    const result = await ensureHomeWorkspace({
      byspaceHome: homeDir,
      workspaceRegistry,
      projectRegistry,
      provisioning,
      logger,
    });

    expect(result!.created).toBe(true);
    expect(result!.workspaceId).not.toBe("wks_user");
    const userRecord = (await workspaceRegistry.list()).find((w) => w.workspaceId === "wks_user");
    expect(userRecord!.labels).toEqual([]);
    expect(userRecord!.title).toBe("My byspace dir");
  });

  it("does not adopt a user workspace that happens to carry the Home title", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "home-ws-"));
    const { workspaceRegistry, projectRegistry } = createRegistries(workdir);
    const provisioning = createStubProvisioning(workspaceRegistry, projectRegistry);
    const homeDir = join(workdir, ".byspace");
    const now = new Date().toISOString();
    await projectRegistry.upsert({
      projectId: "prj_titled",
      rootPath: homeDir,
      kind: "non_git",
      displayName: "titled",
      projectKey: "titled",
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });
    await workspaceRegistry.upsert({
      workspaceId: "wks_titled",
      projectId: "prj_titled",
      cwd: homeDir,
      kind: "directory",
      displayName: "titled",
      title: HOME_WORKSPACE_TITLE,
      branch: null,
      worktreeRoot: null,
      baseBranch: null,
      isBySpaceOwnedWorktree: false,
      mainRepoRoot: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      autoArchivedChangeRequestUrl: null,
      pinnedAt: null,
      labels: [],
    });

    const result = await ensureHomeWorkspace({
      byspaceHome: homeDir,
      workspaceRegistry,
      projectRegistry,
      provisioning,
      logger,
    });

    expect(result!.workspaceId).not.toBe("wks_titled");
    const userRecord = (await workspaceRegistry.list()).find((w) => w.workspaceId === "wks_titled");
    expect(userRecord!.labels).toEqual([]);
  });

  it("ensureHomeWorkspaceUnlessDisabled skips creation under the kill switch", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "home-ws-"));
    const { workspaceRegistry, projectRegistry } = createRegistries(workdir);
    const provisioning = createStubProvisioning(workspaceRegistry, projectRegistry);
    const previous = process.env.BYSPACE_DISABLE_HOME_WORKSPACE;
    process.env.BYSPACE_DISABLE_HOME_WORKSPACE = "1";
    try {
      const result = await ensureHomeWorkspaceUnlessDisabled({
        byspaceHome: join(workdir, ".byspace"),
        workspaceRegistry,
        projectRegistry,
        provisioning,
        logger,
      });
      expect(result).toBeNull();
      expect(provisioning.callCount).toBe(0);
      expect(await workspaceRegistry.list()).toHaveLength(0);
    } finally {
      if (previous === undefined) {
        delete process.env.BYSPACE_DISABLE_HOME_WORKSPACE;
      } else {
        process.env.BYSPACE_DISABLE_HOME_WORKSPACE = previous;
      }
    }
  });

  it("returns null instead of throwing when provisioning fails", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "home-ws-"));
    const { workspaceRegistry, projectRegistry } = createRegistries(workdir);

    const result = await ensureHomeWorkspace({
      byspaceHome: join(workdir, ".byspace"),
      workspaceRegistry,
      projectRegistry,
      provisioning: {
        async createWorkspaceForDirectory() {
          throw new Error("disk full");
        },
      },
      logger,
    });

    expect(result).toBeNull();
  });
});
