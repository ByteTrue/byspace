import { afterEach, describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@bytetrue/byspace-client/internal/daemon-client";
import { useSessionStore } from "@/stores/session-store";
import { DirectoryRefreshSupersededError, DirectorySync } from "./index";

class FakeDirectoryClient {
  fetchAgentsCalls = 0;
  fetchWorkspacesCalls = 0;
  listProjectsCalls = 0;
  workspaceUpdateHandler: ((message: unknown) => void) | null = null;
  listProjectsPromise: Promise<{ projects: never[] }> = Promise.resolve({ projects: [] });

  on(event: string, handler: (message: unknown) => void): () => void {
    if (event === "workspace_update") this.workspaceUpdateHandler = handler;
    return () => undefined;
  }

  async fetchAgents(): Promise<Awaited<ReturnType<DaemonClient["fetchAgents"]>>> {
    this.fetchAgentsCalls += 1;
    return {
      requestId: "agents",
      entries: [],
      pageInfo: { hasMore: false, nextCursor: null, prevCursor: null },
    };
  }

  async fetchWorkspaces(): Promise<Awaited<ReturnType<DaemonClient["fetchWorkspaces"]>>> {
    this.fetchWorkspacesCalls += 1;
    return {
      requestId: "workspaces",
      entries: [],
      emptyProjects: [],
      pageInfo: { hasMore: false, nextCursor: null, prevCursor: null },
    };
  }

  async listProjects(): Promise<{ projects: never[] }> {
    this.listProjectsCalls += 1;
    return this.listProjectsPromise;
  }

  emitWorkspaceUpdate(payload: Record<string, unknown>): void {
    this.workspaceUpdateHandler?.({ type: "workspace_update", payload });
  }
}

const serverIds = new Set<string>();

function createDirectory(serverId: string): {
  client: FakeDirectoryClient;
  directory: DirectorySync;
} {
  serverIds.add(serverId);
  const client = new FakeDirectoryClient();
  const directory = new DirectorySync(serverId, {
    drainQueuedAgentMessage: () => undefined,
    markAgentLoading: () => undefined,
    markAgentReady: () => undefined,
    markAgentError: () => undefined,
  });
  directory.connectionChanged({
    client: client as unknown as DaemonClient,
    status: "online",
    source: { clientGeneration: 1, connectionEpoch: 1 },
  });
  return { client, directory };
}

afterEach(() => {
  for (const serverId of serverIds) useSessionStore.getState().clearSession(serverId);
  serverIds.clear();
});

describe("DirectorySync session readiness", () => {
  it("waits for workspace capability metadata before choosing the workspace protocol", async () => {
    const serverId = "workspace-metadata";
    const { client, directory } = createDirectory(serverId);

    const refresh = directory.refreshWorkspaces({ subscribe: true });
    await Promise.resolve();
    expect(client.fetchWorkspacesCalls).toBe(0);

    const store = useSessionStore.getState();
    store.initializeSession(serverId, client as unknown as DaemonClient, 1);
    await Promise.resolve();
    expect(client.fetchWorkspacesCalls).toBe(0);

    store.updateSessionServerInfo(serverId, {
      serverId,
      hostname: null,
      version: "test",
      features: { workspaceMultiplicity: true },
    });
    await refresh;

    expect(client.fetchWorkspacesCalls).toBe(1);
    expect(useSessionStore.getState().sessions[serverId]?.hasHydratedWorkspaces).toBe(true);
    directory.dispose();
  });

  it("reconciles a live project created while the authoritative project list is in flight", async () => {
    const serverId = "project-list-live-create";
    const { client, directory } = createDirectory(serverId);
    let resolveProjects!: (value: { projects: never[] }) => void;
    client.listProjectsPromise = new Promise((resolve) => {
      resolveProjects = resolve;
    });

    const store = useSessionStore.getState();
    store.initializeSession(serverId, client as unknown as DaemonClient, 1);
    store.updateSessionServerInfo(serverId, {
      serverId,
      hostname: null,
      version: "test",
      features: { workspaceMultiplicity: true, projectList: true },
    });

    const refresh = directory.refreshWorkspaces({ subscribe: true });
    await vi.waitFor(() => expect(client.listProjectsCalls).toBe(1));
    client.emitWorkspaceUpdate({
      kind: "upsert",
      workspace: {
        id: "wks_live",
        projectId: "prj_live",
        projectDisplayName: "acme/live",
        projectCustomName: null,
        projectRootPath: "/repo/live",
        workspaceDirectory: "/repo/live",
        projectKind: "git",
        workspaceKind: "local_checkout",
        name: "main",
        status: "done",
        statusEnteredAt: null,
        activityAt: null,
        archivingAt: null,
        diffStat: null,
        scripts: [],
        project: {
          projectKey: "remote:https://github.com/acme/live",
          projectName: "acme/live",
          checkout: {
            cwd: "/repo/live",
            isGit: true,
            currentBranch: "main",
            remoteUrl: "https://github.com/acme/live.git",
            worktreeRoot: "/repo/live",
            isBySpaceOwnedWorktree: false,
            mainRepoRoot: null,
          },
        },
      },
    });
    resolveProjects({ projects: [] });
    await refresh;

    expect(useSessionStore.getState().sessions[serverId]?.projects.get("prj_live")).toMatchObject({
      projectId: "prj_live",
      projectKey: "remote:https://github.com/acme/live",
    });
    client.emitWorkspaceUpdate({ kind: "remove", id: "wks_live", removedProjectId: "prj_live" });
    expect(useSessionStore.getState().sessions[serverId]?.projects.has("prj_live")).toBe(false);
    directory.dispose();
  });

  it("rejects a session wait on disconnect so the reconnect can refresh", async () => {
    const serverId = "session-wait-reconnect";
    const { client, directory } = createDirectory(serverId);
    const staleRefresh = directory.refreshAgents();
    await Promise.resolve();

    directory.connectionChanged({
      client: null,
      status: "offline",
      source: { clientGeneration: 1, connectionEpoch: 1 },
    });
    await expect(staleRefresh).rejects.toBeInstanceOf(DirectoryRefreshSupersededError);

    directory.connectionChanged({
      client: client as unknown as DaemonClient,
      status: "online",
      source: { clientGeneration: 1, connectionEpoch: 2 },
    });
    const currentRefresh = directory.refreshAgents();
    useSessionStore.getState().initializeSession(serverId, client as unknown as DaemonClient, 1);
    await currentRefresh;

    expect(client.fetchAgentsCalls).toBe(1);
    directory.dispose();
  });
});
