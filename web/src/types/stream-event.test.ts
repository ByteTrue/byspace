import { describe, expect, it } from "vitest";
import type { AgentStreamEventPayload } from "@bytetrue/protocol/messages";
import type { ThoughtItem } from "@/types/stream";
import { applyStreamEvent, replaceWithCanonicalStream } from "@/types/stream";

const baseTimestamp = new Date(0);

const assistantChunk = (
  text: string,
  messageId?: string,
): Extract<AgentStreamEventPayload, { type: "timeline" }> => ({
  type: "timeline",
  provider: "codex",
  item: {
    type: "assistant_message",
    text,
    ...(messageId ? { messageId } : {}),
  },
});

const toolCallEvent = (): AgentStreamEventPayload => ({
  type: "timeline",
  provider: "codex",
  item: {
    type: "tool_call",
    callId: "head-tail-tool-call",
    name: "run",
    status: "running",
    detail: {
      type: "unknown",
      input: { command: "echo hi" },
      output: null,
    },
    error: null,
  },
});

const completionEvent = (): AgentStreamEventPayload => ({
  type: "turn_completed",
  provider: "codex",
});

const permissionEvent = (): AgentStreamEventPayload => ({
  type: "permission_requested",
  provider: "codex",
  request: {
    id: "perm-1",
    provider: "codex",
    name: "test",
    kind: "tool",
  },
});

const reasoningChunk = (text: string): AgentStreamEventPayload => ({
  type: "timeline",
  provider: "claude",
  item: {
    type: "reasoning",
    text,
  },
});

describe("applyStreamEvent", () => {
  it("applies an authoritative canonical text replacement", () => {
    const initial = applyStreamEvent({
      tail: [],
      head: [],
      event: assistantChunk("wrong", "message-1"),
      timestamp: baseTimestamp,
    });
    const result = applyStreamEvent({
      tail: initial.tail,
      head: initial.head,
      event: { ...assistantChunk("canonical", "message-1"), replace: true },
      timestamp: baseTimestamp,
    });
    expect(result.head).toHaveLength(1);
    expect(result.head[0]).toMatchObject({ kind: "assistant_message", text: "canonical" });
  });

  it("replaces Markdown-split tail blocks without duplicating the canonical message", () => {
    const result = applyStreamEvent({
      tail: [
        {
          id: "part-1",
          kind: "assistant_message",
          messageId: "message-1",
          text: "first",
          timestamp: baseTimestamp,
        },
        {
          id: "part-2",
          kind: "assistant_message",
          messageId: "message-1",
          text: "second",
          timestamp: baseTimestamp,
        },
      ],
      head: [],
      event: { ...assistantChunk("first second", "message-1"), replace: true },
      timestamp: baseTimestamp,
    });
    expect(result.tail).toHaveLength(0);
    expect(result.head).toHaveLength(1);
    expect(result.head[0]).toMatchObject({ kind: "assistant_message", text: "first second" });
  });

  it("does not duplicate a cursorless live assistant already present in canonical history", () => {
    const canonical = {
      id: "canonical-root",
      kind: "assistant_message" as const,
      messageId: "message-root",
      text: "ROOT_DONE",
      timestamp: baseTimestamp,
      timelineCursor: { epoch: "epoch-1", seq: 10 },
    };
    const live = {
      id: "live-root",
      kind: "assistant_message" as const,
      messageId: "message-root",
      text: "ROOT_DONE",
      timestamp: baseTimestamp,
    };
    const trailingTool = {
      id: "trailing-tool",
      kind: "tool_call" as const,
      timestamp: baseTimestamp,
      timelineCursor: { epoch: "epoch-1", seq: 11 },
      payload: {
        source: "agent" as const,
        data: {
          provider: "claude" as const,
          callId: "call-after",
          name: "notification",
          status: "completed" as const,
          error: null,
          detail: { type: "unknown" as const, input: null, output: null },
        },
      },
    };
    const result = replaceWithCanonicalStream({
      previousTail: [canonical],
      previousHead: [live],
      canonical: [canonical, trailingTool],
      sendingClientMessageIds: [],
      canonicalCoverage: { epoch: "epoch-1", endSeq: 11 },
      preserveContinuity: true,
    });
    expect(
      [...result.tail, ...result.head].filter((item) => item.kind === "assistant_message"),
    ).toHaveLength(1);
    expect(result.head).toHaveLength(0);
    expect(result.tail.at(-1)).toMatchObject({ kind: "tool_call", id: "trailing-tool" });

    const continued = replaceWithCanonicalStream({
      previousTail: [canonical],
      previousHead: [{ ...live, text: "ROOT_DONE with a newer suffix" }],
      canonical: [canonical, trailingTool],
      sendingClientMessageIds: [],
      canonicalCoverage: { epoch: "epoch-1", endSeq: 11 },
      preserveContinuity: true,
    });
    expect(continued.head).toHaveLength(1);
    expect(continued.head[0]).toMatchObject({
      kind: "assistant_message",
      text: "ROOT_DONE with a newer suffix",
    });
    expect(continued.tail.filter((item) => item.kind === "assistant_message")).toHaveLength(0);
  });

  it("buffers reasoning chunks in head", () => {
    const result = applyStreamEvent({
      tail: [],
      head: [],
      event: reasoningChunk("Let me think..."),
      timestamp: baseTimestamp,
    });

    expect(result.tail).toHaveLength(0);
    expect(result.head).toHaveLength(1);
    expect(result.head[0].kind).toBe("thought");
    expect((result.head[0] as ThoughtItem).text).toBe("Let me think...");
    expect((result.head[0] as ThoughtItem).status).toBe("loading");
  });

  it("accumulates reasoning chunks in head", () => {
    let result = applyStreamEvent({
      tail: [],
      head: [],
      event: reasoningChunk("Let me "),
      timestamp: baseTimestamp,
    });
    result = applyStreamEvent({
      tail: result.tail,
      head: result.head,
      event: reasoningChunk("think..."),
      timestamp: baseTimestamp,
    });

    expect(result.tail).toHaveLength(0);
    expect(result.head).toHaveLength(1);
    expect((result.head[0] as ThoughtItem).text).toBe("Let me think...");
  });

  it("flushes reasoning to tail when tool call arrives", () => {
    let result = applyStreamEvent({
      tail: [],
      head: [],
      event: reasoningChunk("Thinking..."),
      timestamp: baseTimestamp,
    });
    result = applyStreamEvent({
      tail: result.tail,
      head: result.head,
      event: toolCallEvent(),
      timestamp: baseTimestamp,
    });

    expect(result.head).toHaveLength(0);
    expect(result.tail).toHaveLength(2);
    expect(result.tail[0].kind).toBe("thought");
    expect((result.tail[0] as ThoughtItem).status).toBe("ready");
    expect(result.tail[1].kind).toBe("tool_call");
  });

  it("flushes head on turn completion", () => {
    let result = applyStreamEvent({
      tail: [],
      head: [],
      event: assistantChunk("Hello"),
      timestamp: baseTimestamp,
    });
    result = applyStreamEvent({
      tail: result.tail,
      head: result.head,
      event: completionEvent(),
      timestamp: baseTimestamp,
    });

    expect(result.head).toHaveLength(0);
    expect(result.tail).toHaveLength(1);
    expect(result.tail[0].kind).toBe("assistant_message");
  });

  it("does not continue a tail assistant message when the incoming message id differs", () => {
    const result = applyStreamEvent({
      tail: [
        {
          kind: "assistant_message",
          id: "msg-first",
          messageId: "msg-first",
          text: "First answer.",
          timestamp: baseTimestamp,
        },
      ],
      head: [],
      event: assistantChunk("Second answer.", "msg-second"),
      timestamp: baseTimestamp,
    });

    expect(result.tail).toHaveLength(1);
    expect(result.head).toHaveLength(1);
    expect(result.tail[0].kind).toBe("assistant_message");
    expect(result.head[0].kind).toBe("assistant_message");
    if (
      result.tail[0].kind === "assistant_message" &&
      result.head[0].kind === "assistant_message"
    ) {
      expect(result.tail[0].text).toBe("First answer.");
      expect(result.head[0].text).toBe("Second answer.");
      expect(result.head[0].messageId).toBe("msg-second");
    }
  });

  it("flushes reasoning when assistant message starts", () => {
    let result = applyStreamEvent({
      tail: [],
      head: [],
      event: reasoningChunk("Thinking..."),
      timestamp: baseTimestamp,
    });
    result = applyStreamEvent({
      tail: result.tail,
      head: result.head,
      event: assistantChunk("Here's my answer"),
      timestamp: baseTimestamp,
    });

    expect(result.tail).toHaveLength(1);
    expect(result.tail[0].kind).toBe("thought");
    expect((result.tail[0] as ThoughtItem).status).toBe("ready");
    expect(result.head).toHaveLength(1);
    expect(result.head[0].kind).toBe("assistant_message");
  });

  it("keeps references stable for no-op events", () => {
    const tail: ReturnType<typeof applyStreamEvent>["tail"] = [];
    const head: ReturnType<typeof applyStreamEvent>["head"] = [];

    const result = applyStreamEvent({
      tail,
      head,
      event: permissionEvent(),
      timestamp: baseTimestamp,
    });

    expect(result.tail).toBe(tail);
    expect(result.head).toBe(head);
    expect(result.changedTail).toBe(false);
    expect(result.changedHead).toBe(false);
  });
});
