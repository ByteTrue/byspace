import { describe, expect, it } from "vitest";

import { foldSubagentObservations } from "../../provider-subagents/observation.js";
import { ProviderSubagentStore } from "../../provider-subagents/store.js";
import {
  isPiSubagentToolName,
  mapPiSubagentStatus,
  observePiSubagentExit,
  observePiSubagentLaunch,
  replayPiSubagentSessionPointers,
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
    // Live-process replay keeps the running tail as-is; the post-restart replay closes
    // it as canceled (issue 078). The sweep applies regardless of which origin reported
    // the running state.
    expect(replayPiSubagentObservations(messages)).toEqual([
      { kind: "status", id: "sub_9", status: "running" },
    ]);
    expect(replayPiSubagentObservations(messages, { closeRunningAsCanceled: true })).toEqual([
      { kind: "status", id: "sub_9", status: "running" },
      { kind: "status", id: "sub_9", status: "canceled" },
    ]);
  });

  it("closes a transcript that ends on a running child with canceled when asked (issue 078)", () => {
    const messages: PiAgentMessage[] = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "t1", name: "subagent", arguments: { task: "x" } }],
      },
      {
        role: "toolResult",
        toolCallId: "t1",
        toolName: "subagent",
        content: "started",
        details: { id: "sub_z", status: "running" },
      },
    ];
    expect(replayPiSubagentObservations(messages, { closeRunningAsCanceled: true })).toEqual([
      { kind: "declared", id: "sub_z", toolCallId: "t1", description: "x" },
      { kind: "status", id: "sub_z", status: "canceled" },
    ]);
  });

  it("names a codemode-nested child from its own task record", () => {
    // pi persists a codemode script's nested subagent call only as arguments on the parent's
    // result — the launch result is never written — so the exit record is the only origin
    // that names the child. Without this the row replays with no title and no task text.
    const messages: PiAgentMessage[] = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "c1", name: "codemode", arguments: { code: "…" } }],
      },
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "codemode",
        content: "ok",
        details: {
          calls: [{ id: "c1/1", name: "subagent", args: '{"agent":"reviewer","task":"x"}' }],
        },
      },
      {
        role: "custom",
        customType: "subagent-exit",
        content: "done",
        details: {
          id: "sub_nested",
          agent: "reviewer",
          description: "reviewer: 你是对抗性审查者",
          status: "succeeded",
          sessionId: "sub_child",
          cwd: "/tmp/w",
          sessionFile: "/logs/sub_child.jsonl",
        },
      },
    ];

    expect(replayPiSubagentObservations(messages)).toEqual([
      {
        kind: "declared",
        id: "sub_nested",
        title: "reviewer",
        description: "reviewer: 你是对抗性审查者",
      },
      { kind: "status", id: "sub_nested", status: "completed" },
    ]);
    // The same record is the child's only session pointer, so its tab can still rebuild.
    expect(replayPiSubagentSessionPointers(messages)).toEqual(
      new Map([
        [
          "sub_nested",
          { sessionId: "sub_child", cwd: "/tmp/w", sessionFile: "/logs/sub_child.jsonl" },
        ],
      ]),
    );
  });

  it("names every child of a batched exit message and absorbs each pointer", () => {
    // The extension batches exits when several children finish together. Each entry is its own
    // child, so both the naming and the pointer absorption have to walk the array — not treat it
    // as one record.
    const messages: PiAgentMessage[] = [
      {
        role: "custom",
        customType: "subagent-exit",
        content: "done",
        details: [
          {
            id: "sub_batch_a",
            agent: "explore",
            description: "explore: first",
            status: "succeeded",
            sessionId: "child_a",
            cwd: "/tmp/a",
            sessionFile: "/logs/child_a.jsonl",
          },
          {
            id: "sub_batch_b",
            agent: "reviewer",
            description: "reviewer: second",
            status: "paused",
            sessionId: "child_b",
            cwd: "/tmp/b",
            sessionFile: "/logs/child_b.jsonl",
          },
          "junk",
        ],
      },
    ];

    expect(replayPiSubagentObservations(messages)).toEqual([
      { kind: "declared", id: "sub_batch_a", title: "explore", description: "explore: first" },
      { kind: "status", id: "sub_batch_a", status: "completed" },
      { kind: "declared", id: "sub_batch_b", title: "reviewer", description: "reviewer: second" },
      { kind: "status", id: "sub_batch_b", status: "canceled" },
    ]);
    expect(replayPiSubagentSessionPointers(messages)).toEqual(
      new Map([
        [
          "sub_batch_a",
          { sessionId: "child_a", cwd: "/tmp/a", sessionFile: "/logs/child_a.jsonl" },
        ],
        [
          "sub_batch_b",
          { sessionId: "child_b", cwd: "/tmp/b", sessionFile: "/logs/child_b.jsonl" },
        ],
      ]),
    );
  });

  it("names a child whose launch record states no name at all", () => {
    // The legacy `subagent` argument shape is `{ tasks: [...] }` — no `agent`, no `task` — and
    // its result details carry no description either, so the launch declares an id with nothing
    // in it. That anonymous declaration must not claim the id, or the exit record's name can
    // never land and the row replays as a spinner labelled "Loading..." — the bug in issue 084.
    const messages: PiAgentMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "t1",
            name: "subagent",
            arguments: { tasks: [{ task: "a" }, { task: "b" }], async: false },
          },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "t1",
        toolName: "subagent",
        content: "started",
        details: { id: "sub_legacy", status: "running", count: 4 },
      },
      {
        role: "custom",
        customType: "subagent-exit",
        content: "done",
        details: {
          id: "sub_legacy",
          agent: "scout",
          description: "4 tasks (parallel)",
          status: "succeeded",
        },
      },
    ];

    expect(replayPiSubagentObservations(messages)).toEqual([
      { kind: "declared", id: "sub_legacy", toolCallId: "t1" },
      {
        kind: "declared",
        id: "sub_legacy",
        title: "scout",
        description: "4 tasks (parallel)",
      },
      { kind: "status", id: "sub_legacy", status: "completed" },
    ]);
  });

  it("names a child from its record for every origin, once", () => {
    // subagent_status results carry the same record fields; whichever origin arrives first
    // names the row, and a later one must not push a second declaration.
    const messages: PiAgentMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "t1", name: "subagent_status", arguments: { id: "sub_s" } },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "t1",
        toolName: "subagent_status",
        content: "status",
        details: {
          id: "sub_s",
          agent: "explore",
          description: "explore: trace it",
          status: "running",
        },
      },
      {
        role: "custom",
        customType: "subagent-exit",
        content: "done",
        details: {
          id: "sub_s",
          agent: "explore",
          description: "explore: trace it",
          status: "succeeded",
        },
      },
    ];

    expect(replayPiSubagentObservations(messages)).toEqual([
      { kind: "declared", id: "sub_s", title: "explore", description: "explore: trace it" },
      { kind: "status", id: "sub_s", status: "running" },
      { kind: "status", id: "sub_s", status: "completed" },
    ]);
  });

  it("keeps the launch record's full task over a record's one-liner", () => {
    const messages: PiAgentMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "t1",
            name: "subagent",
            arguments: { task: "the full task text", agent: "explore" },
          },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "t1",
        toolName: "subagent",
        content: "started",
        details: { id: "sub_launch", status: "running" },
      },
      {
        role: "custom",
        customType: "subagent-exit",
        content: "done",
        details: {
          id: "sub_launch",
          agent: "explore",
          description: "explore: the full ta…",
          status: "succeeded",
        },
      },
    ];

    expect(replayPiSubagentObservations(messages)).toEqual([
      {
        kind: "declared",
        id: "sub_launch",
        toolCallId: "t1",
        title: "explore",
        description: "the full task text",
      },
      { kind: "status", id: "sub_launch", status: "completed" },
    ]);
  });

  it("extracts child session pointers from launch and record results (issue 078)", () => {
    const messages: PiAgentMessage[] = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "t1", name: "subagent", arguments: { task: "x" } }],
      },
      {
        role: "toolResult",
        toolCallId: "t1",
        toolName: "subagent",
        content: "started",
        details: { id: "sub_p", status: "running", sessionId: "sub_s1", cwd: "/tmp/w" },
      },
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "t2", name: "subagent_status", arguments: { id: "sub_p" } },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "t2",
        toolName: "subagent_status",
        content: "status",
        details: { id: "sub_p", status: "succeeded", sessionFile: "/logs/sub_s1.jsonl" },
      },
    ];
    expect(replayPiSubagentSessionPointers(messages)).toEqual(
      new Map([
        ["sub_p", { sessionId: "sub_s1", cwd: "/tmp/w", sessionFile: "/logs/sub_s1.jsonl" }],
      ]),
    );
  });

  it("returns no pointer for transcripts that predate session pointers", () => {
    const messages: PiAgentMessage[] = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "t1", name: "subagent", arguments: { task: "x" } }],
      },
      {
        role: "toolResult",
        toolCallId: "t1",
        toolName: "subagent",
        content: "started",
        details: { id: "sub_old", status: "running" },
      },
    ];
    expect(replayPiSubagentSessionPointers(messages)).toEqual(new Map());
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
