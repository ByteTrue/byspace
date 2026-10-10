import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import pino from "pino";

import { ensureHomeWorkspace, HOME_WORKSPACE_TITLE } from "./home-workspace.js";
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

  it("is idempotent: second boot reuses the existing workspace", async () => {
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
