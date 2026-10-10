import { describe, expect, it } from "vitest";

import { foldSubagentObservations } from "../../provider-subagents/observation.js";
import { ProviderSubagentStore } from "../../provider-subagents/store.js";
import {
  isPiSubagentToolName,
  mapPiSubagentStatus,
  observePiSubagentExit,
  observePiSubagentLaunch,
  observePiSubagentRecord,
  replayPiSubagentObservations,
} from "./agent-subagents.js";
import type { PiAgentMessage } from "./rpc-types.js";

describe("isPiSubagentToolName", () => {
  it("accepts the three extension tools", () => {
    expect(isPiSubagentToolName("subagent")).toBe(true);
    expect(isPiSubagentToolName("subagent_status")).toBe(true);
    expect(isPiSubagentToolName("subagent_stop")).toBe(true);
    expect(isPiSubagentToolName("bash")).toBe(false);
    expect(isPiSubagentToolName("subagent_foo")).toBe(false);
  });
});

describe("mapPiSubagentStatus", () => {
  it("maps extension statuses onto descriptor statuses", () => {
    expect(mapPiSubagentStatus("running")).toBe("running");
    expect(mapPiSubagentStatus("pending")).toBe("running");
    expect(mapPiSubagentStatus("paused")).toBe("canceled");
    expect(mapPiSubagentStatus("succeeded")).toBe("completed");
    expect(mapPiSubagentStatus("failed")).toBe("failed");
    expect(mapPiSubagentStatus("cancelled")).toBe("canceled");
  });

  it("reads unknown statuses as absent so the stored status is preserved", () => {
    expect(mapPiSubagentStatus("mystery")).toBeUndefined();
    expect(mapPiSubagentStatus(undefined)).toBeUndefined();
  });
});

describe("observePiSubagentLaunch", () => {
  it("declares a running child from the launch tool result", () => {
    const observation = observePiSubagentLaunch({
      toolCallId: "toolu_1",
      args: { task: "review the diff", agent: "explore" },
      details: { id: "sub_abc123", status: "running" },
    });
    expect(observation).toEqual({
      kind: "declared",
      id: "sub_abc123",
      toolCallId: "toolu_1",
      title: "explore",
      description: "review the diff",
    });
  });

  it("falls back to the record description when args carry none", () => {
    const observation = observePiSubagentLaunch({
      toolCallId: "t",
      args: {},
      details: { id: "sub_1", description: "described elsewhere" },
    });
    expect(observation).toMatchObject({ description: "described elsewhere" });
  });

  it("reads malformed details as no observation", () => {
    expect(observePiSubagentLaunch({ toolCallId: "t", args: {}, details: null })).toBeNull();
    expect(observePiSubagentLaunch({ toolCallId: "t", args: {}, details: "nope" })).toBeNull();
    expect(
      observePiSubagentLaunch({ toolCallId: "t", args: {}, details: { status: "running" } }),
    ).toBeNull();
  });
});

describe("observePiSubagentRecord", () => {
  it("maps a full task record onto a status observation", () => {
    const details = {
      id: "sub_abc123",
      parentSessionId: "parent",
      description: "review the diff",
      agent: "explore",
      status: "succeeded",
      output: "done",
      startedAt: 1,
      finishedAt: 2,
    };
    expect(observePiSubagentRecord(details)).toEqual({
      kind: "status",
      id: "sub_abc123",
      status: "completed",
    });
  });

  it("skips records whose status is unknown", () => {
    expect(observePiSubagentRecord({ id: "sub_1" })).toBeNull();
  });
});

describe("observePiSubagentExit", () => {
  it("reads one record", () => {
    expect(observePiSubagentExit({ id: "sub_1", status: "failed" })).toEqual([
      { kind: "status", id: "sub_1", status: "failed" },
    ]);
  });

  it("reads a batched array and skips malformed entries", () => {
    expect(
      observePiSubagentExit([{ id: "sub_1", status: "succeeded" }, "junk", { nope: 1 }]),
    ).toEqual([{ kind: "status", id: "sub_1", status: "completed" }]);
  });
});

describe("observePiSubagentRecord (HTTP report records)", () => {
  it("accepts a full report record with a known status", () => {
    expect(
      observePiSubagentRecord({
        id: "sub_abc123",
        status: "succeeded",
        sessionId: "child-session",
        cwd: "/repo",
      }),
    ).toEqual({ kind: "status", id: "sub_abc123", status: "completed" });
  });

  it("rejects unknown statuses and malformed records", () => {
    expect(observePiSubagentRecord({ id: "sub_1", status: "weird" })).toBeNull();
    expect(observePiSubagentRecord({ id: "sub_1" })).toBeNull();
    expect(observePiSubagentRecord(null)).toBeNull();
    expect(observePiSubagentRecord("junk")).toBeNull();
  });
});

describe("replayPiSubagentObservations", () => {
  it("derives declared and status observations from a transcript", () => {
    const messages: PiAgentMessage[] = [
      { role: "user", content: "review it" },
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "toolu_1",
            name: "subagent",
            arguments: { task: "review the diff", agent: "explore" },
          },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "toolu_1",
        toolName: "subagent",
        content: [{ type: "text", text: "Subagent started (ID: sub_abc123)." }],
        details: { id: "sub_abc123", status: "running" },
      },
      {
        role: "custom",
        customType: "subagent-exit",
        content: "done",
        details: { id: "sub_abc123", status: "succeeded", output: "LGTM" },
      },
    ];
    expect(replayPiSubagentObservations(messages)).toEqual([
      {
        kind: "declared",
        id: "sub_abc123",
        toolCallId: "toolu_1",
        title: "explore",
        description: "review the diff",
      },
      { kind: "status", id: "sub_abc123", status: "completed" },
    ]);
  });

  it("ignores other tools and other custom messages", () => {
    const messages: PiAgentMessage[] = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } }],
      },
      {
        role: "toolResult",
        toolCallId: "t1",
        toolName: "bash",
        content: "ok",
        details: { id: "sub_1", status: "succeeded" },
      },
      { role: "custom", customType: "other", content: "x", details: { id: "sub_1" } },
    ];
    expect(replayPiSubagentObservations(messages)).toEqual([]);
  });

  it("pairs tool calls with results across messages and drops unmatched ones", () => {
    const messages: PiAgentMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "t1", name: "subagent_status", arguments: { id: "sub_9" } },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "t1",
        toolName: "subagent_status",
        content: "status",
        details: { id: "sub_9", status: "running" },
      },
    ];
    expect(replayPiSubagentObservations(messages)).toEqual([
      { kind: "status", id: "sub_9", status: "running" },
    ]);
  });
});

describe("folded observations drive the shared store", () => {
  it("sticky-merges a launch and a later exit into one descriptor", () => {
    const store = new ProviderSubagentStore();
    const launchObservation = observePiSubagentLaunch({
      toolCallId: "toolu_1",
      args: { task: "review the diff", agent: "explore" },
      details: { id: "sub_abc123", status: "running" },
    });
    expect(launchObservation).not.toBeNull();
    const launch = foldSubagentObservations([launchObservation])[0];
    store.apply("agent_1", "pi", launch);
    const exit = foldSubagentObservations(
      observePiSubagentExit({ id: "sub_abc123", status: "succeeded" }),
    )[0];
    const event = store.apply("agent_1", "pi", exit);
    expect(event.type === "upsert" && event.subagent).toMatchObject({
      id: "sub_abc123",
      provider: "pi",
      title: "explore",
      description: "review the diff",
      status: "completed",
      toolCallId: "toolu_1",
    });
  });
});
