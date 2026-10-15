// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@bytetrue/client/internal/daemon-client";
import { useSessionStore } from "@/stores/session-store";
import type { ViewedTimelineUiBridge } from "@/timeline/viewed-timeline-sync";
import { useVisibleAgentTimeline } from "./use-visible-agent-timeline";

const SERVER_ID = "chief-visible-timeline";

function createSync(): {
  sync: ViewedTimelineUiBridge;
  replaceVisibleAgentIds: ReturnType<typeof vi.fn>;
} {
  const replaceVisibleAgentIds = vi.fn();
  return {
    replaceVisibleAgentIds,
    sync: {
      replaceVisibleAgentIds,
      subscribe: () => () => {},
      getAgentTimelineStatus: () => "pending",
      getAgentTimelineError: () => null,
      retryVisibleAgentTimeline: () => {},
    },
  };
}

function seedSync(sync: ViewedTimelineUiBridge | null): void {
  useSessionStore.getState().initializeSession(SERVER_ID, {} as DaemonClient);
  useSessionStore.getState().setViewedTimelineSync(SERVER_ID, sync);
}

afterEach(() => {
  cleanup();
  useSessionStore.setState((state) => ({ ...state, sessions: {} }));
});

describe("useVisibleAgentTimeline", () => {
  it("publishes the agent while the surface is mounted and releases it on unmount", () => {
    const { sync, replaceVisibleAgentIds } = createSync();
    seedSync(sync);

    const { unmount } = renderHook(() =>
      useVisibleAgentTimeline({ serverId: SERVER_ID, agentId: "agent-1" }),
    );

    expect(replaceVisibleAgentIds).toHaveBeenCalledTimes(1);
    expect(replaceVisibleAgentIds.mock.calls[0]?.[1]).toEqual(["agent-1"]);

    unmount();

    expect(replaceVisibleAgentIds).toHaveBeenCalledTimes(2);
    expect(replaceVisibleAgentIds.mock.calls[1]?.[1]).toEqual([]);
  });

  it("waits for the owner instead of dropping the registration", () => {
    seedSync(null);
    const { replaceVisibleAgentIds, sync } = createSync();

    const { rerender } = renderHook(() =>
      useVisibleAgentTimeline({ serverId: SERVER_ID, agentId: "agent-1" }),
    );

    expect(replaceVisibleAgentIds).not.toHaveBeenCalled();

    useSessionStore.getState().setViewedTimelineSync(SERVER_ID, sync);
    rerender();

    expect(replaceVisibleAgentIds).toHaveBeenCalledTimes(1);
    expect(replaceVisibleAgentIds.mock.calls[0]?.[1]).toEqual(["agent-1"]);
  });

  it("registers nothing until the agent resolves", () => {
    const { sync, replaceVisibleAgentIds } = createSync();
    seedSync(sync);

    const { rerender } = renderHook(
      ({ agentId }: { agentId: string | null }) =>
        useVisibleAgentTimeline({ serverId: SERVER_ID, agentId }),
      { initialProps: { agentId: null as string | null } },
    );

    expect(replaceVisibleAgentIds).not.toHaveBeenCalled();

    rerender({ agentId: "agent-1" });

    expect(replaceVisibleAgentIds).toHaveBeenCalledTimes(1);
    expect(replaceVisibleAgentIds.mock.calls[0]?.[1]).toEqual(["agent-1"]);
  });
});
