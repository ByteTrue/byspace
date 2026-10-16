import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { describe, expect, it } from "vitest";
import pino from "pino";

import {
  ensureHomeWorkspace,
  ensureHomeWorkspaceUnlessDisabled,
  HOME_PROJECT_NAME,
  HOME_WORKSPACE_LABEL,
  HOME_WORKSPACE_TITLE,
  resolveHomeWorkspaceCwd,
} from "./home-workspace.js";
import { FileBackedProjectRegistry, FileBackedWorkspaceRegistry } from "./workspace-registry.js";
import { deriveProjectKey } from "./project-key.js";
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
        displayName: basename(cwd),
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
        displayName: basename(cwd),
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
  it("creates a directory workspace in the home's chief directory on first boot", async () => {
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
    // The daemon's state root, not the state root itself: a Home rooted at
    // `~/.byspace` puts config.json, agents/ and every worktree in the agent's
    // working set.
    expect(provisioning.lastCwd).toBe(resolveHomeWorkspaceCwd(homeDir));
    expect(provisioning.lastTitle).toBe(HOME_WORKSPACE_TITLE);
    expect(existsSync(provisioning.lastCwd)).toBe(true);

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
    const homeCwd = resolveHomeWorkspaceCwd(homeDir);
    const now = new Date().toISOString();
    await projectRegistry.upsert({
      projectId: "prj_user",
      rootPath: homeCwd,
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
      cwd: homeCwd,
      kind: "directory",
      displayName: "my byspace dir",
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
            displayName: basename(cwd),
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

  it("moves a Home an earlier release rooted at the BySpace home itself", async () => {
    // Every release before the chief/ subdirectory put Home's cwd at the state
    // root — the daemon's own config, agent records, projects and worktrees.
    // The label is the daemon's, so the record is the daemon's to move, and it
    // keeps its uuid: the agents stamped with it belong to the workspace by id.
    const workdir = mkdtempSync(join(tmpdir(), "home-ws-"));
    const { workspaceRegistry, projectRegistry } = createRegistries(workdir);
    const provisioning = createStubProvisioning(workspaceRegistry, projectRegistry);
    const homeDir = join(workdir, ".byspace");
    const homeCwd = resolveHomeWorkspaceCwd(homeDir);
    const now = new Date().toISOString();
    await projectRegistry.upsert({
      projectId: "prj_old",
      rootPath: homeDir,
      kind: "non_git",
      displayName: ".byspace",
      projectKey: `host:srv:${homeDir}`,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });
    await workspaceRegistry.upsert({
      workspaceId: "wks_old",
      projectId: "prj_old",
      cwd: homeDir,
      kind: "directory",
      displayName: ".byspace",
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
      labels: [HOME_WORKSPACE_LABEL],
    });

    const result = await ensureHomeWorkspace({
      byspaceHome: homeDir,
      serverId: "srv_test",
      workspaceRegistry,
      projectRegistry,
      provisioning,
      logger,
    });

    // In place, not a new record: a fresh uuid would orphan the sessions that
    // were stamped with the old one.
    expect(provisioning.callCount).toBe(0);
    expect(result!.workspaceId).toBe("wks_old");
    expect(result!.created).toBe(false);
    const records = await workspaceRegistry.list();
    expect(records).toHaveLength(1);
    expect(records[0].cwd).toBe(homeCwd);
    expect(records[0].projectId).toBe("prj_old");
    expect(records[0].labels).toContain(HOME_WORKSPACE_LABEL);

    // The project row's root is the directory Home runs in; left at the state
    // root it would be watched and offered for the wrong directory.
    const projects = await projectRegistry.list();
    expect(projects).toHaveLength(1);
    expect(projects[0].rootPath).toBe(homeCwd);
    expect(projects[0].displayName).toBe("chief");
    expect(projects[0].projectKey).not.toBe(`host:srv:${homeDir}`);
    expect(projects[0].projectKey).toBe(
      deriveProjectKey({
        rootPath: homeCwd,
        remoteUrl: null,
        worktreeRoot: null,
        mainRepoRoot: null,
        serverId: "srv_test",
      }),
    );
    expect(projects[0].customName).toBe(HOME_PROJECT_NAME);
  });

  it("leaves a shared project rooted where the user put it when Home moves", async () => {
    // The user added the BySpace home as a project themselves, so the row is
    // shared: moving its root would drag their other workspaces with it.
    const workdir = mkdtempSync(join(tmpdir(), "home-ws-"));
    const { workspaceRegistry, projectRegistry } = createRegistries(workdir);
    const provisioning = createStubProvisioning(workspaceRegistry, projectRegistry);
    const homeDir = join(workdir, ".byspace");
    const now = new Date().toISOString();
    await projectRegistry.upsert({
      projectId: "prj_shared",
      rootPath: homeDir,
      kind: "non_git",
      displayName: ".byspace",
      projectKey: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });
    const base = {
      projectId: "prj_shared",
      kind: "directory" as const,
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
    };
    await workspaceRegistry.upsert({
      ...base,
      workspaceId: "wks_old",
      cwd: homeDir,
      displayName: ".byspace",
      title: HOME_WORKSPACE_TITLE,
      labels: [HOME_WORKSPACE_LABEL],
    });
    await workspaceRegistry.upsert({
      ...base,
      workspaceId: "wks_user",
      cwd: join(homeDir, "notes"),
      displayName: "notes",
      title: "My notes",
      labels: [],
    });

    const result = await ensureHomeWorkspace({
      byspaceHome: homeDir,
      workspaceRegistry,
      projectRegistry,
      provisioning,

      logger,
    });

    expect(result!.workspaceId).toBe("wks_old");
    const record = await workspaceRegistry.get("wks_old");
    expect(record!.cwd).toBe(resolveHomeWorkspaceCwd(homeDir));
    expect((await projectRegistry.list())[0].rootPath).toBe(homeDir);
  });

  it("leaves a Home cwd the user chose alone", async () => {
    // cwd is only the daemon's to change while it is one the daemon published.
    // A record the user re-pointed at their own directory keeps it.
    const workdir = mkdtempSync(join(tmpdir(), "home-ws-"));
    const { workspaceRegistry, projectRegistry } = createRegistries(workdir);
    const provisioning = createStubProvisioning(workspaceRegistry, projectRegistry);
    const homeDir = join(workdir, ".byspace");
    const userCwd = join(workdir, "my-notes");
    const now = new Date().toISOString();
    await projectRegistry.upsert({
      projectId: "prj_user",
      rootPath: userCwd,
      kind: "non_git",
      displayName: "my-notes",
      projectKey: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });
    await workspaceRegistry.upsert({
      workspaceId: "wks_user",
      projectId: "prj_user",
      cwd: userCwd,
      kind: "directory",
      displayName: "my-notes",
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
      labels: [HOME_WORKSPACE_LABEL],
    });

    const result = await ensureHomeWorkspace({
      byspaceHome: homeDir,
      workspaceRegistry,
      projectRegistry,
      provisioning,
      logger,
    });

    expect(provisioning.callCount).toBe(0);
    expect(result!.workspaceId).toBe("wks_user");
    expect(result!.created).toBe(false);
    const records = await workspaceRegistry.list();
    expect(records).toHaveLength(1);
    expect(records[0].cwd).toBe(userCwd);
    expect((await projectRegistry.list())[0].rootPath).toBe(userCwd);
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
    const homeCwd = resolveHomeWorkspaceCwd(homeDir);
    const now = new Date().toISOString();
    // A workspace the user opened on the path Home uses: same cwd as Home, but
    // not the daemon's. The path alone must not claim it, and must not be moved.
    await projectRegistry.upsert({
      projectId: "prj_user",
      rootPath: homeCwd,
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
      cwd: homeCwd,
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
    const homeCwd = resolveHomeWorkspaceCwd(homeDir);
    const now = new Date().toISOString();
    await projectRegistry.upsert({
      projectId: "prj_titled",
      rootPath: homeCwd,
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
      cwd: homeCwd,
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
