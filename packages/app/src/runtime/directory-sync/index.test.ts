import { afterEach, describe, expect, it } from "vitest";
import type {
  DaemonClient,
  FetchAgentsEntry,
} from "@bytetrue/byspace-client/internal/daemon-client";
import type { AgentSnapshotPayload } from "@bytetrue/byspace-protocol/messages";
import { useSessionStore } from "@/stores/session-store";
import { DirectoryRefreshSupersededError, DirectorySync } from "./index";

type TimelinePage = Awaited<ReturnType<DaemonClient["fetchAgentTimeline"]>>;

function agent(title: string): AgentSnapshotPayload {
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

function agentEntry(value: AgentSnapshotPayload): FetchAgentsEntry {
  return {
    agent: value,
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

class FakeDirectoryClient {
  fetchAgentsCalls = 0;
  fetchWorkspacesCalls = 0;
  agentEntries: FetchAgentsEntry[] = [];
  timelinePage: Promise<TimelinePage> = Promise.resolve({ hasNewer: false } as TimelinePage);

  on(): () => void {
    return () => undefined;
  }

  async fetchAgents(): Promise<Awaited<ReturnType<DaemonClient["fetchAgents"]>>> {
    this.fetchAgentsCalls += 1;
    return {
      requestId: "agents",
      entries: this.agentEntries,
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

  async fetchAgentTimeline(): Promise<TimelinePage> {
    return this.timelinePage;
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

describe("DirectorySync timeline source ordering", () => {
  it("ignores a timeline page completed by a superseded connection source", async () => {
    const serverId = "timeline-source-change";
    const { client, directory } = createDirectory(serverId);
    client.agentEntries = [agentEntry(agent("directory"))];
    useSessionStore.getState().initializeSession(serverId, client as unknown as DaemonClient, 1);
    await directory.refreshAgents();

    let resolveTimeline: (page: TimelinePage) => void = () => {};
    client.timelinePage = new Promise<TimelinePage>((resolve) => {
      resolveTimeline = resolve;
    });
    const pending = directory.fetchTimeline("agent", {
      direction: "tail",
      limit: 100,
      projection: "projected",
    });

    directory.connectionChanged({
      client: client as unknown as DaemonClient,
      status: "online",
      source: { clientGeneration: 1, connectionEpoch: 2 },
    });
    resolveTimeline({ agent: agent("stale"), hasNewer: false } as TimelinePage);
    await pending;

    expect(useSessionStore.getState().sessions[serverId]?.agents.get("agent")?.title).toBe(
      "directory",
    );
    directory.dispose();
  });
});
