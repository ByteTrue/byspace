import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { createWebStreamStrategy } from "./strategy-web";

function createTimestamp(seed: number): Date {
  return new Date(`2026-01-01T00:00:0${seed}.000Z`);
}

function userMessage(id: string, text: string, seed: number): StreamItem {
  return {
    kind: "user_message",
    id,
    text,
    timestamp: createTimestamp(seed),
  };
}

function assistantMessage(id: string, text: string, seed: number): StreamItem {
  return {
    kind: "assistant_message",
    id,
    text,
    timestamp: createTimestamp(seed),
  };
}

function toolCall(id: string, seed: number): StreamItem {
  return {
    kind: "tool_call",
    id,
    timestamp: createTimestamp(seed),
    payload: {
      source: "orchestrator",
      data: {
        toolCallId: id,
        toolName: "Shell",
        arguments: "echo hi",
        result: null,
        status: "completed",
      },
    },
  };
}

describe("createWebStreamStrategy", () => {
  it("uses forward_stream on web", () => {
    const strategy = createWebStreamStrategy({
      isMobileBreakpoint: false,
    });

    expect(strategy.shouldUseVirtualizedList()).toBe(false);
    expect(strategy.getFlatListInverted()).toBe(false);
    expect(strategy.getOverlayScrollbarInverted()).toBe(false);
    expect(strategy.shouldAnchorBottomOnContentSizeChange()).toBe(true);
    expect(strategy.getBottomAnchorTransportBehavior()).toEqual({
      verificationDelayFrames: 0,
      verificationRetryMode: "rescroll",
    });
  });
});

describe("stream ordering", () => {
  const streamItems: StreamItem[] = [
    userMessage("u1", "user-1", 1),
    assistantMessage("a1", "assistant-1", 2),
    assistantMessage("a2", "assistant-2", 3),
  ];

  it("keeps forward_stream order unchanged for tail and head", () => {
    const strategy = createWebStreamStrategy({
      isMobileBreakpoint: false,
    });

    const tail = strategy.orderTail(streamItems);
    const head = strategy.orderHead(streamItems);

    expect(tail.map((item) => item.id)).toEqual(["u1", "a1", "a2"]);
    expect(head.map((item) => item.id)).toEqual(["u1", "a1", "a2"]);
  });
});

describe("neighbor and traversal semantics", () => {
  it("maps above/below indices", () => {
    const strategy = createWebStreamStrategy({
      isMobileBreakpoint: false,
    });

    expect(strategy.getNeighborIndex(3, "above")).toBe(2);
    expect(strategy.getNeighborIndex(3, "below")).toBe(4);
  });

  it("collects assistant response content with strategy traversal direction", () => {
    const chronological: StreamItem[] = [
      userMessage("u1", "user-1", 1),
      assistantMessage("a1", "assistant-1", 2),
      assistantMessage("a2", "assistant-2", 3),
      userMessage("u2", "user-2", 4),
    ];

    const forward = createWebStreamStrategy({
      isMobileBreakpoint: false,
    });
    const forwardStartIndex = chronological.findIndex((item) => item.id === "a2");
    expect(forward.collectAssistantResponseContent(chronological, forwardStartIndex)).toBe(
      "assistant-1\n\nassistant-2",
    );
  });

  it("collects copy content across adjacent turns without a visible prompt", () => {
    const chronological: StreamItem[] = [
      { ...assistantMessage("a1", "first turn", 1), turnId: "turn-1" },
      { ...toolCall("tool", 2), turnId: "turn-2" },
      { ...assistantMessage("a2", "second turn", 3), turnId: "turn-2" },
    ];
    const strategy = createWebStreamStrategy({ isMobileBreakpoint: false });

    expect(strategy.collectAssistantResponseContent(chronological, 2)).toBe(
      "first turn\n\nsecond turn",
    );
  });

  it("returns undefined neighbor when index would be out of bounds", () => {
    const forward = createWebStreamStrategy({
      isMobileBreakpoint: false,
    });
    const items: StreamItem[] = [userMessage("u1", "user-1", 1)];

    expect(forward.getNeighborItem(items, 0, "above")).toBeUndefined();
    expect(forward.getNeighborItem(items, 0, "below")).toBeUndefined();
  });
});

describe("scroll/bottom calculations", () => {
  it("computes near-bottom using forward_stream distance-from-bottom math", () => {
    const strategy = createWebStreamStrategy({
      isMobileBreakpoint: false,
    });

    expect(
      strategy.isNearBottom({
        offsetY: 680,
        viewportHeight: 300,
        contentHeight: 1000,
        threshold: 24,
      }),
    ).toBe(true);
    expect(
      strategy.isNearBottom({
        offsetY: 600,
        viewportHeight: 300,
        contentHeight: 1000,
        threshold: 24,
      }),
    ).toBe(false);
  });

  it("maps scroll-to-bottom to max offset for forward_stream", () => {
    const strategy = createWebStreamStrategy({
      isMobileBreakpoint: false,
    });

    expect(
      strategy.getBottomOffset({
        viewportHeight: 320,
        contentHeight: 1000,
      }),
    ).toBe(680);
  });
});

describe("edge slot semantics", () => {
  it("uses the footer slot", () => {
    const EdgeSlot = () => null;
    const strategy = createWebStreamStrategy({
      isMobileBreakpoint: false,
    });

    expect(strategy.getEdgeSlotProps(EdgeSlot, 4)).toEqual({
      ListFooterComponent: EdgeSlot,
      ListFooterComponentStyle: { marginTop: 4 },
    });
  });
});

describe("layout strategy edges", () => {
  const streamItems: StreamItem[] = [
    userMessage("u1", "user-1", 1),
    assistantMessage("a1", "assistant-1", 2),
  ];

  it("uses the newest history edge as the history/live boundary", () => {
    const strategy = createWebStreamStrategy({
      isMobileBreakpoint: false,
    });

    const history = strategy.orderTail(streamItems);

    expect(strategy.getHistoryLiveBoundaryIndex(history)).toBe(1);
  });

  it("uses the oldest live-head edge as the live-head/history boundary", () => {
    const strategy = createWebStreamStrategy({
      isMobileBreakpoint: false,
    });

    const liveHead = strategy.orderHead(streamItems);

    expect(strategy.getLiveHeadHistoryBoundaryIndex(liveHead)).toBe(0);
  });
});
