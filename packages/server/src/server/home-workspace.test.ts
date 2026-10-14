import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import pino from "pino";

import {
  ensureHomeWorkspace,
  ensureHomeWorkspaceUnlessDisabled,
  HOME_PROJECT_NAME,
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

  it("names the containing project after the product, not the directory", async () => {
    // The containing project is what a directory workspace without a projectId
    // materializes; its derived name is the directory basename, which reads as a
    // project the user added themselves.
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

    const [project] = await projectRegistry.list();
    expect(project.customName).toBe(HOME_PROJECT_NAME);
  });

  it("re-titles a Home the daemon named before, and leaves a user rename alone", async () => {
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
    const createdAt = (await workspaceRegistry.list())[0].createdAt;

    // A previous release published "Home"; that title is the daemon's, not the
    // user's, so the next boot may replace it.
    await workspaceRegistry.upsert({
      ...(await workspaceRegistry.list())[0],
      title: "Home",
      createdAt,
      labels: [HOME_WORKSPACE_LABEL],
    });
    await ensureHomeWorkspace({
      byspaceHome: homeDir,
      workspaceRegistry,
      projectRegistry,
      provisioning,
      logger,
    });
    expect((await workspaceRegistry.list())[0].title).toBe(HOME_WORKSPACE_TITLE);

    // A title the user chose is theirs; renaming it back would be a takeover.
    await workspaceRegistry.upsert({
      ...(await workspaceRegistry.list())[0],
      title: "My assistant",
    });
    await projectRegistry.upsert({
      ...(await projectRegistry.list())[0],
      customName: "My project",
    });
    await ensureHomeWorkspace({
      byspaceHome: homeDir,
      workspaceRegistry,
      projectRegistry,
      provisioning,
      logger,
    });

    const record = (await workspaceRegistry.list()).find(
      (workspace) => workspace.workspaceId === first!.workspaceId,
    );
    expect(record!.title).toBe("My assistant");
    expect((await projectRegistry.list())[0].customName).toBe("My project");
  });

  it("leaves a project the user already uses alone", async () => {
    // A directory workspace without a projectId reuses any active project rooted
    // at the same path (getOrCreateActiveByRoot), so a user who added the BySpace
    // home directory as a project themselves shares the row Home lands in.
    // Naming that row would rename their project.
    const workdir = mkdtempSync(join(tmpdir(), "home-ws-"));
    const { workspaceRegistry, projectRegistry } = createRegistries(workdir);
    const homeDir = join(workdir, ".byspace");
    const now = new Date().toISOString();
    await projectRegistry.upsert({
      projectId: "prj_user",
      rootPath: homeDir,
      kind: "non_git",
      displayName: "byspace-home",
      projectKey: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });
    await workspaceRegistry.upsert({
      workspaceId: "wks_user",
      projectId: "prj_user",
      cwd: homeDir,
      kind: "directory",
      displayName: ".byspace",
      title: "My notes",
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

    await ensureHomeWorkspace({
      byspaceHome: homeDir,
      workspaceRegistry,
      projectRegistry,
      provisioning: {
        async createWorkspaceForDirectory(cwd, title) {
          // Reuses the project already rooted here, as provisioning does.
          const workspace = {
            workspaceId: "wks_home",
            projectId: "prj_user",
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
            labels: [] as string[],
          };
          await workspaceRegistry.upsert(workspace);
          return workspace;
        },
      },
      logger,
    });

    const projects = await projectRegistry.list();
    expect(projects).toHaveLength(1);
    expect(projects[0].customName).toBeNull();
  });

  it("keeps a user's project rename across boots", async () => {
    // The project row is shared with the plain project-rename UI, so a name the
    // user typed must survive every later boot untouched.
    const workdir = mkdtempSync(join(tmpdir(), "home-ws-"));
    const { workspaceRegistry, projectRegistry } = createRegistries(workdir);
    const provisioning = createStubProvisioning(workspaceRegistry, projectRegistry);
    const homeDir = join(workdir, ".byspace");
    await ensureHomeWorkspace({
      byspaceHome: homeDir,
      workspaceRegistry,
      projectRegistry,
      provisioning,
      logger,
    });

    await projectRegistry.upsert({
      ...(await projectRegistry.list())[0],
      customName: "My workspace folder",
    });
    await ensureHomeWorkspace({
      byspaceHome: homeDir,
      workspaceRegistry,
      projectRegistry,
      provisioning,
      logger,
    });

    expect((await projectRegistry.list())[0].customName).toBe("My workspace folder");
  });

  it("leaves an archived Home and its name alone", async () => {
    // Archiving is a user decision, not a stale record: resurrecting the Home
    // (or re-branding it) would overrule it.
    const workdir = mkdtempSync(join(tmpdir(), "home-ws-"));
    const { workspaceRegistry, projectRegistry } = createRegistries(workdir);
    const provisioning = createStubProvisioning(workspaceRegistry, projectRegistry);
    const homeDir = join(workdir, ".byspace");
    await ensureHomeWorkspace({
      byspaceHome: homeDir,
      workspaceRegistry,
      projectRegistry,
      provisioning,
      logger,
    });

    const archivedAt = new Date().toISOString();
    const record = (await workspaceRegistry.list())[0];
    await workspaceRegistry.upsert({
      ...record,
      title: "My archive",
      archivedAt,
      updatedAt: archivedAt,
    });
    await ensureHomeWorkspace({
      byspaceHome: homeDir,
      workspaceRegistry,
      projectRegistry,
      provisioning,
      logger,
    });

    const after = (await workspaceRegistry.list()).find(
      (workspace) => workspace.workspaceId === record.workspaceId,
    );
    expect(after?.title).toBe("My archive");
    expect(provisioning.callCount).toBe(1);
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

  it("does not rewrite the presentation records when they are already current", async () => {
    // Every mutation notifies listeners and bumps updatedAt; re-writing the same
    // values on every boot would churn the sidebar's update stream for nothing.
    const workdir = mkdtempSync(join(tmpdir(), "home-ws-"));
    const { workspaceRegistry, projectRegistry } = createRegistries(workdir);
    const provisioning = createStubProvisioning(workspaceRegistry, projectRegistry);
    const homeDir = join(workdir, ".byspace");
    await ensureHomeWorkspace({
      byspaceHome: homeDir,
      workspaceRegistry,
      projectRegistry,
      provisioning,
      logger,
    });
    // Every upsert notifies listeners, so count them: updatedAt passed through
    // from the existing record and would stay equal even on a redundant write.
    let workspaceWrites = 0;
    let projectWrites = 0;
    workspaceRegistry.subscribeToMutations(() => {
      workspaceWrites++;
    });
    projectRegistry.subscribeToMutations(() => {
      projectWrites++;
    });

    await ensureHomeWorkspace({
      byspaceHome: homeDir,
      workspaceRegistry,
      projectRegistry,
      provisioning,
      logger,
    });

    expect({ workspaceWrites, projectWrites }).toEqual({ workspaceWrites: 0, projectWrites: 0 });
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
