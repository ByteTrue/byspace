import { afterEach, describe, expect, it } from "vitest";
import type {
  DaemonClient,
  FetchAgentsEntry,
} from "@bytetrue/byspace-client/internal/daemon-client";
import type { AgentSnapshotPayload } from "@bytetrue/byspace-protocol/messages";
import { useSessionStore } from "@/stores/session-store";
import { DirectoryRefreshSupersededError, DirectorySync } from "./index";

class FakeDirectoryClient {
  fetchAgentsCalls = 0;
  fetchWorkspacesCalls = 0;
  fetchAgentsEntries: FetchAgentsEntry[] = [];
  readonly timelineRequests: Array<{
    resolve(page: Awaited<ReturnType<DaemonClient["fetchAgentTimeline"]>>): void;
  }> = [];

  on(): () => void {
    return () => undefined;
  }

  getLastServerInfoMessage(): null {
    return null;
  }

  async setAgentTimelineSubscription(): Promise<void> {}

  async fetchAgents(): Promise<Awaited<ReturnType<DaemonClient["fetchAgents"]>>> {
    this.fetchAgentsCalls += 1;
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
    return {
      requestId: "workspaces",
      entries: [],
      emptyProjects: [],
      pageInfo: { hasMore: false, nextCursor: null, prevCursor: null },
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
