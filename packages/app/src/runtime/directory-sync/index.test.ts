import { afterEach, describe, expect, it } from "vitest";
import type {
  DaemonClient,
  FetchAgentsEntry,
} from "@bytetrue/byspace-client/internal/daemon-client";
import type {
  AgentSnapshotPayload,
  SessionOutboundMessage,
} from "@bytetrue/byspace-protocol/messages";
import { normalizeProjectDescriptor, useSessionStore } from "@/stores/session-store";
import { DirectoryRefreshSupersededError, DirectorySync } from "./index";

class FakeDirectoryClient {
  fetchAgentsCalls = 0;
  lastAgentOptions: unknown;
  fetchWorkspacesCalls = 0;
  fetchAgentsEntries: FetchAgentsEntry[] = [];
  readonly timelineRequests: Array<{
    resolve(page: Awaited<ReturnType<DaemonClient["fetchAgentTimeline"]>>): void;
  }> = [];
  listProjectsCalls = 0;
  lastProjectOptions: unknown;
  projectResult: Awaited<ReturnType<DaemonClient["listProjects"]>> | null = null;
  private pendingWorkspaceFetch: Promise<
    Awaited<ReturnType<DaemonClient["fetchWorkspaces"]>>
  > | null = null;
  private readonly handlers = new Map<
    SessionOutboundMessage["type"],
    Set<(message: SessionOutboundMessage) => void>
  >();

  on<TType extends SessionOutboundMessage["type"]>(
    type: TType,
    handler: (message: Extract<SessionOutboundMessage, { type: TType }>) => void,
  ): () => void {
    const handlers = this.handlers.get(type) ?? new Set();
    const registered = handler as unknown as (message: SessionOutboundMessage) => void;
    handlers.add(registered);
    this.handlers.set(type, handlers);
    return () => handlers.delete(registered);
  }

  emit<TType extends SessionOutboundMessage["type"]>(
    message: Extract<SessionOutboundMessage, { type: TType }>,
  ): void {
    for (const handler of this.handlers.get(message.type) ?? []) handler(message);
  }

  holdWorkspaceFetch(): (result: Awaited<ReturnType<DaemonClient["fetchWorkspaces"]>>) => void {
    let complete!: (result: Awaited<ReturnType<DaemonClient["fetchWorkspaces"]>>) => void;
    this.pendingWorkspaceFetch = new Promise((resolve) => {
      complete = resolve;
    });
    return complete;
  }

  getLastServerInfoMessage(): null {
    return null;
  }

  async setAgentTimelineSubscription(): Promise<void> {}

  async fetchAgents(options?: unknown): Promise<Awaited<ReturnType<DaemonClient["fetchAgents"]>>> {
    this.fetchAgentsCalls += 1;
    this.lastAgentOptions = options;
    return {
      requestId: "agents",
      entries: this.fetchAgentsEntries,
      pageInfo: { hasMore: false, nextCursor: null, prevCursor: null },
    };
  }

  fetchAgentTimeline(): Promise<Awaited<ReturnType<DaemonClient["fetchAgentTimeline"]>>> {
    return new Promise((resolve) => this.timelineRequests.push({ resolve }));
  }

  async fetchWorkspaces(): Promise<Awaited<ReturnType<DaemonClient["fetchWorkspaces"]>>> {
    this.fetchWorkspacesCalls += 1;
    if (this.pendingWorkspaceFetch) {
      const pending = this.pendingWorkspaceFetch;
      this.pendingWorkspaceFetch = null;
      return pending;
    }
    return {
      requestId: "workspaces",
      entries: [],
      emptyProjects: [],
      pageInfo: { hasMore: false, nextCursor: null, prevCursor: null },
    };
  }

  async listProjects(
    options?: unknown,
  ): Promise<Awaited<ReturnType<DaemonClient["listProjects"]>>> {
    this.listProjectsCalls += 1;
    this.lastProjectOptions = options;
    if (this.projectResult) return this.projectResult;
    return {
      requestId: "projects",
      projects: [
        {
          projectId: "project-1",
          projectKey: "remote:github.com/acme/app",
          projectDisplayName: "acme/app",
          projectRootPath: "/repo/app",
          projectKind: "git",
        },
      ],
    };
  }
}

function agentPayload(title: string): AgentSnapshotPayload {
  return {
    id: "agent",
    provider: "codex",
    cwd: "/repo",
    model: null,
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:01:00.000Z",
    lastUserMessageAt: null,
    status: "idle",
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title,
    labels: {},
  };
}

function agentEntry(agent: AgentSnapshotPayload): FetchAgentsEntry {
  return {
    agent,
    project: {
      projectKey: "/repo",
      projectName: "repo",
      checkout: {
        cwd: "/repo",
        isGit: false,
        currentBranch: null,
        remoteUrl: null,
        worktreeRoot: null,
        isBySpaceOwnedWorktree: false,
        mainRepoRoot: null,
      },
    },
  };
}

const serverIds = new Set<string>();

function createDirectory(serverId: string): {
  client: FakeDirectoryClient;
  directory: DirectorySync;
} {
  serverIds.add(serverId);
  const client = new FakeDirectoryClient();
  const directory = new DirectorySync(serverId, {
    onAgentStoppedRunning: () => undefined,
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
  it("uses the saved agent sequence while bounding the bootstrap page", async () => {
    const serverId = "agent-list-sequence-page";
    serverIds.add(serverId);
    const client = new FakeDirectoryClient();
    const directory = new DirectorySync(
      serverId,
      {
        onAgentStoppedRunning: () => undefined,
        markAgentLoading: () => undefined,
        markAgentReady: () => undefined,
        markAgentError: () => undefined,
      },
      {
        readDirectoryCheckpoint: () => ({ agents: { generation: "generation", afterSeq: 12 } }),
        writeDirectoryCheckpoint: () => undefined,
      },
    );
    directory.connectionChanged({
      client: client as unknown as DaemonClient,
      status: "online",
      source: { clientGeneration: 1, connectionEpoch: 1 },
    });
    const store = useSessionStore.getState();
    store.initializeSession(serverId, client as unknown as DaemonClient, 1);
    store.updateSessionServerInfo(serverId, {
      serverId,
      hostname: null,
      version: "test",
      features: { directorySync: true, workspaceMultiplicity: true },
    });

    await directory.refreshAgents({
      subscribe: { subscriptionId: `app:${serverId}` },
      page: { limit: 200 },
    });

    expect(client.lastAgentOptions).toEqual({
      scope: "active",
      sort: [{ key: "updated_at", direction: "desc" }],
      subscribe: { subscriptionId: `app:${serverId}` },
      page: { limit: 200 },
      sync: { generation: "generation", afterSeq: 12 },
    });
    directory.dispose();
  });

  it("merges project changes from the existing list RPC and advances its cursor", async () => {
    const serverId = "project-list-sequence";
    serverIds.add(serverId);
    const client = new FakeDirectoryClient();
    const writes: unknown[] = [];
    const directory = new DirectorySync(
      serverId,
      {
        onAgentStoppedRunning: () => undefined,
        markAgentLoading: () => undefined,
        markAgentReady: () => undefined,
        markAgentError: () => undefined,
      },
      {
        readDirectoryCheckpoint: () => ({ projects: { generation: "generation", afterSeq: 4 } }),
        writeDirectoryCheckpoint: (_serverId, checkpoint) => writes.push(checkpoint),
      },
    );
    directory.connectionChanged({
      client: client as unknown as DaemonClient,
      status: "online",
      source: { clientGeneration: 1, connectionEpoch: 1 },
    });
    const store = useSessionStore.getState();
    store.initializeSession(serverId, client as unknown as DaemonClient, 1);
    store.setProjects(serverId, [
      normalizeProjectDescriptor({
        projectId: "project-1",
        projectDisplayName: "Old name",
        projectRootPath: "/repo/one",
        projectKind: "git",
      }),
      normalizeProjectDescriptor({
        projectId: "project-2",
        projectDisplayName: "Removed",
        projectRootPath: "/repo/two",
        projectKind: "git",
      }),
    ]);
    store.updateSessionServerInfo(serverId, {
      serverId,
      hostname: null,
      version: "test",
      features: { workspaceMultiplicity: true, projectList: true, directorySync: true },
    });
    client.projectResult = {
      requestId: "projects",
      projects: [
        {
          projectId: "project-1",
          projectDisplayName: "New name",
          projectRootPath: "/repo/one",
          projectKind: "git",
          syncSeq: 5,
        },
      ],
      sync: {
        generation: "generation",
        headSeq: 6,
        mode: "changes",
        removals: [{ id: "project-2", seq: 6 }],
      },
    };

    await directory.refreshWorkspaces();

    expect(client.lastProjectOptions).toEqual({
      sync: { generation: "generation", afterSeq: 4 },
    });
    const projects = useSessionStore.getState().sessions[serverId]?.projects;
    expect(Array.from(projects?.keys() ?? [])).toEqual(["project-1"]);
    expect(projects?.get("project-1")?.projectDisplayName).toBe("New name");
    expect(writes).toContainEqual({ projects: { generation: "generation", afterSeq: 6 } });
    directory.dispose();
  });
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

  it("keeps the host-scoped timeline owner across connection replacement", () => {
    const serverId = "timeline-owner-lifetime";
    const { client, directory } = createDirectory(serverId);
    const bridge = directory.timelineUiBridge;

    directory.connectionChanged({
      client: null,
      status: "offline",
      source: { clientGeneration: 1, connectionEpoch: 1 },
    });
    directory.connectionChanged({
      client: client as unknown as DaemonClient,
      status: "online",
      source: { clientGeneration: 2, connectionEpoch: 2 },
    });

    expect(directory.timelineUiBridge).toBe(bridge);
    directory.dispose();
  });

  it("does not apply an agent snapshot from a replaced connection", async () => {
    const serverId = "timeline-old-source-agent";
    const { client, directory } = createDirectory(serverId);
    client.fetchAgentsEntries = [agentEntry(agentPayload("old connection"))];
    const store = useSessionStore.getState();
    store.initializeSession(serverId, client as unknown as DaemonClient, 1);
    await directory.refreshAgents();

    const staleFetch = directory.fetchTimeline("agent", {
      direction: "tail",
      limit: 40,
      projection: "projected",
    });
    const staleRequest = client.timelineRequests.shift();
    expect(staleRequest).toBeDefined();

    const currentClient = new FakeDirectoryClient();
    directory.connectionChanged({
      client: currentClient as unknown as DaemonClient,
      status: "online",
      source: { clientGeneration: 2, connectionEpoch: 2 },
    });
    store.setAgents(serverId, (agents) => {
      const next = new Map(agents);
      const current = next.get("agent");
      if (current) next.set("agent", { ...current, title: "new connection" });
      return next;
    });

    staleRequest?.resolve({
      requestId: "stale",
      agentId: "agent",
      agent: agentPayload("stale timeline response"),
      direction: "tail",
      projection: "projected",
      epoch: "epoch-a",
      reset: false,
      staleCursor: false,
      gap: false,
      window: { minSeq: 0, maxSeq: 0, nextSeq: 1 },
      startCursor: null,
      endCursor: null,
      hasOlder: false,
      hasNewer: false,
      entries: [],
      error: null,
    });
    await expect(staleFetch).rejects.toThrow("superseded");

    expect(useSessionStore.getState().sessions[serverId]?.agents.get("agent")?.title).toBe(
      "new connection",
    );
    directory.dispose();
  });

  it("fetches the project descriptor channel when the daemon advertises it", async () => {
    const serverId = "project-list";
    const { client, directory } = createDirectory(serverId);
    const store = useSessionStore.getState();
    store.initializeSession(serverId, client as unknown as DaemonClient, 1);
    store.updateSessionServerInfo(serverId, {
      serverId,
      hostname: null,
      version: "test",
      features: { workspaceMultiplicity: true, projectList: true },
    });

    await directory.refreshWorkspaces();

    expect(client.listProjectsCalls).toBe(1);
    expect(useSessionStore.getState().sessions[serverId]?.projects.get("project-1")).toMatchObject({
      projectId: "project-1",
      projectKey: "remote:github.com/acme/app",
    });
    directory.dispose();
  });

  it("buffers workspace and project updates in the same hydration transaction", async () => {
    const serverId = "workspace-project-transaction";
    const { client, directory } = createDirectory(serverId);
    const store = useSessionStore.getState();
    store.initializeSession(serverId, client as unknown as DaemonClient, 1);
    store.updateSessionServerInfo(serverId, {
      serverId,
      hostname: null,
      version: "test",
      features: { workspaceMultiplicity: true },
    });
    const completeFetch = client.holdWorkspaceFetch();

    const refresh = directory.refreshWorkspaces({ subscribe: true });
    await Promise.resolve();
    client.emit({
      type: "workspace_update",
      payload: {
        kind: "remove",
        id: "removed-workspace",
        emptyProject: {
          projectId: "workspace-project",
          projectDisplayName: "Project from workspace update",
          projectRootPath: "/repo/workspace-project",
          projectKind: "git",
        },
      },
    });
    client.emit({
      type: "project.update",
      payload: {
        kind: "upsert",
        project: {
          projectId: "snapshot-project",
          projectDisplayName: "Renamed during hydration",
          projectRootPath: "/moved/snapshot-project",
          projectKind: "directory",
        },
      },
    });
    completeFetch({
      requestId: "workspaces",
      entries: [],
      emptyProjects: [
        {
          projectId: "snapshot-project",
          projectDisplayName: "Stale snapshot project",
          projectRootPath: "/repo/snapshot-project",
          projectKind: "git",
        },
      ],
      pageInfo: { hasMore: false, nextCursor: null, prevCursor: null },
    });
    await refresh;

    const projects = useSessionStore.getState().sessions[serverId]?.projects;
    expect(Array.from(projects?.keys() ?? [])).toEqual(["snapshot-project", "workspace-project"]);
    expect(projects?.get("snapshot-project")).toMatchObject({
      projectDisplayName: "Renamed during hydration",
      projectRootPath: "/moved/snapshot-project",
      projectKind: "directory",
    });
    expect(projects?.get("workspace-project")).toMatchObject({
      projectDisplayName: "Project from workspace update",
    });
    directory.dispose();
  });

  it("buffers project updates from the online epoch before workspace hydration starts", async () => {
    const serverId = "project-before-workspace-hydration";
    const { client, directory } = createDirectory(serverId);
    const store = useSessionStore.getState();
    store.initializeSession(serverId, client as unknown as DaemonClient, 1);
    store.updateSessionServerInfo(serverId, {
      serverId,
      hostname: null,
      version: "test",
      features: { workspaceMultiplicity: true },
    });

    client.emit({
      type: "project.update",
      payload: {
        kind: "upsert",
        project: {
          projectId: "early-project",
          projectDisplayName: "Early project",
          projectRootPath: "/repo/early-project",
          projectKind: "git",
        },
      },
    });

    expect(useSessionStore.getState().sessions[serverId]?.hasHydratedWorkspaces).toBe(false);

    await directory.refreshWorkspaces({ subscribe: true });

    expect(useSessionStore.getState().sessions[serverId]?.hasHydratedWorkspaces).toBe(true);
    expect(
      useSessionStore.getState().sessions[serverId]?.projects.get("early-project"),
    ).toMatchObject({
      projectDisplayName: "Early project",
      projectRootPath: "/repo/early-project",
    });
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
