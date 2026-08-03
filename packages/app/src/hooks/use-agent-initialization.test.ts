import { afterEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/stores/session-store";
import { getInitKey, resolveInitDeferred } from "@/utils/agent-initialization";
import {
  createSetAgentInitializing,
  ensureAgentIsInitialized,
  refreshAgent,
} from "./use-agent-initialization";

const serverId = "server-1";
const agentId = "agent-1";

class FakeDaemonClient {
  readonly refreshedAgentIds: string[] = [];

  async refreshAgent(requestedAgentId: string): Promise<void> {
    this.refreshedAgentIds.push(requestedAgentId);
  }
}

class FakeTimelineRuntime {
  readonly ensured: Array<{ serverId: string; agentId: string }> = [];
  readonly refreshed: Array<{ serverId: string; agentId: string }> = [];

  async ensureAgentTimelineCurrent(requestedServerId: string, requestedAgentId: string) {
    this.ensured.push({ serverId: requestedServerId, agentId: requestedAgentId });
  }

  async refreshAgentTimeline(requestedServerId: string, requestedAgentId: string) {
    this.refreshed.push({ serverId: requestedServerId, agentId: requestedAgentId });
    return undefined as never;
  }
}

function bindSetAgentInitializing() {
  return createSetAgentInitializing(serverId, useSessionStore.getState().setInitializingAgents);
}

afterEach(() => {
  resolveInitDeferred(getInitKey(serverId, agentId));
  useSessionStore.setState({ sessions: {}, agentLastActivity: new Map() });
  vi.restoreAllMocks();
});

describe("ensureAgentIsInitialized", () => {
  it("delegates missing authoritative history to the host timeline owner", async () => {
    const client = new FakeDaemonClient();
    const runtime = new FakeTimelineRuntime();
    useSessionStore.getState().initializeSession(serverId, client as never);

    await ensureAgentIsInitialized({
      serverId,
      agentId,
      client: client as never,
      runtime,
      setAgentInitializing: bindSetAgentInitializing(),
    });

    expect(runtime.ensured).toEqual([{ serverId, agentId }]);
  });

  it("does nothing when authoritative history is already present", async () => {
    const client = new FakeDaemonClient();
    const runtime = new FakeTimelineRuntime();
    useSessionStore.getState().initializeSession(serverId, client as never);
    useSessionStore.getState().setAgentAuthoritativeHistoryApplied(serverId, agentId, true);

    await ensureAgentIsInitialized({
      serverId,
      agentId,
      client: client as never,
      runtime,
      setAgentInitializing: bindSetAgentInitializing(),
    });

    expect(runtime.ensured).toEqual([]);
  });

  it("rejects without a connected client", async () => {
    const runtime = new FakeTimelineRuntime();
    useSessionStore.getState().initializeSession(serverId, null);

    await expect(
      ensureAgentIsInitialized({
        serverId,
        agentId,
        client: null,
        runtime,
        setAgentInitializing: bindSetAgentInitializing(),
        hostDisconnectedMessage: "host offline",
      }),
    ).rejects.toThrow("host offline");
    expect(runtime.ensured).toEqual([]);
  });
});

describe("refreshAgent", () => {
  it("routes the post-refresh repair through the host timeline owner", async () => {
    const client = new FakeDaemonClient();
    const runtime = new FakeTimelineRuntime();
    useSessionStore.getState().initializeSession(serverId, client as never);

    await refreshAgent({
      serverId,
      agentId,
      client: client as never,
      runtime,
      setAgentInitializing: bindSetAgentInitializing(),
    });

    expect(client.refreshedAgentIds).toEqual([agentId]);
    expect(runtime.refreshed).toEqual([{ serverId, agentId }]);
  });
});
