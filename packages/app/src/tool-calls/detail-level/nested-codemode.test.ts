import { describe, expect, it } from "vitest";
import type { ToolCallDetail } from "@bytetrue/protocol/agent-types";
import { agentToolCallItemId, type ToolCallItem } from "@/types/stream";
import { projectNestedCodemodeCalls } from "./nested-codemode";

function toolCall(
  callId: string,
  detail: ToolCallDetail,
  options: {
    name?: string;
    status?: "running" | "completed" | "failed" | "canceled";
    turnId?: string;
    metadata?: Record<string, unknown>;
  } = {},
): ToolCallItem {
  return {
    kind: "tool_call",
    id: agentToolCallItemId({ callId, turnId: options.turnId }),
    ...(options.turnId ? { turnId: options.turnId } : {}),
    timestamp: new Date("2026-01-01T00:00:00.000Z"),
    payload: {
      source: "agent",
      data: {
        provider: "pi",
        callId,
        name: options.name ?? detail.type,
        status: options.status ?? "completed",
        error: null,
        detail,
        ...(options.metadata ? { metadata: options.metadata } : {}),
      },
    },
  };
}

function codemodeParent(
  status: "running" | "completed" = "completed",
  metadata?: Record<string, unknown>,
): ToolCallItem {
  return toolCall(
    "call-1",
    { type: "unknown", input: { code: "..." }, output: null },
    { name: "codemode", status, turnId: "turn-1", metadata },
  );
}

function nestedChild(callSuffix: string, name = "bash"): ToolCallItem {
  return toolCall(
    `call-1/${callSuffix}`,
    { type: "shell", command: `cmd ${callSuffix}` },
    { name, turnId: "turn-1", metadata: { parentToolCallId: "call-1" } },
  );
}

describe("nested codemode projection", () => {
  it("folds live nested rows into the parent codemode row and summarizes them", () => {
    const parent = codemodeParent();
    const child0 = nestedChild("0");
    const child1 = nestedChild("1");
    const tail = [parent, child0, child1];

    const projection = projectNestedCodemodeCalls({ tail });

    expect(projection.tail).toEqual([parent]);
    const group = projection.groupsByParentItemId.get(parent.id);
    expect(group).toBeDefined();
    expect(group?.run.id).toBe(`nested:${parent.id}`);
    expect(group?.run.calls.map((call) => call.id)).toEqual([parent.id, child0.id, child1.id]);
    expect(group?.run.latest).toBe(parent);
    expect(group?.summary).toEqual({
      editedFileCount: 0,
      commandCount: 2,
      readFileCount: 0,
      searchCount: 0,
      otherToolCount: 0,
      byspaceCallCount: 0,
    });
    expect(group?.isLoading).toBe(false);
  });

  it("marks the group loading while the parent codemode call is running", () => {
    const parent = codemodeParent("running");
    const tail = [parent, nestedChild("0", "read")];

    const projection = projectNestedCodemodeCalls({ tail });

    const group = projection.groupsByParentItemId.get(parent.id);
    expect(group?.isLoading).toBe(true);
  });

  it("keeps orphaned nested rows in place when the parent row is missing", () => {
    const child = nestedChild("0");
    const tail = [child];

    const projection = projectNestedCodemodeCalls({ tail });

    expect(projection.tail).toEqual([child]);
    expect(projection.groupsByParentItemId.size).toBe(0);
  });

  it("restores a collapsed group from the parent metadata on replay", () => {
    const parent = codemodeParent("completed", {
      nestedSummary: {
        editedFileCount: 1,
        commandCount: 2,
        readFileCount: 0,
        searchCount: 0,
        otherToolCount: 0,
        byspaceCallCount: 0,
      },
    });

    const projection = projectNestedCodemodeCalls({ tail: [parent] });

    expect(projection.tail).toEqual([parent]);
    const group = projection.groupsByParentItemId.get(parent.id);
    expect(group?.summary).toEqual({
      editedFileCount: 1,
      commandCount: 2,
      readFileCount: 0,
      searchCount: 0,
      otherToolCount: 0,
      byspaceCallCount: 0,
    });
    expect(group?.run.calls.map((call) => call.id)).toEqual([parent.id]);
    expect(group?.isLoading).toBe(false);
  });

  it("absorbs codemode-in-codemode children into the root group without extra groups", () => {
    const parent = codemodeParent();
    const nestedCodemode = toolCall(
      "call-1/0",
      { type: "unknown", input: { code: "..." }, output: null },
      {
        name: "codemode",
        turnId: "turn-1",
        metadata: {
          parentToolCallId: "call-1",
          nestedSummary: {
            editedFileCount: 0,
            commandCount: 1,
            readFileCount: 0,
            searchCount: 0,
            otherToolCount: 0,
            byspaceCallCount: 0,
          },
        },
      },
    );
    const grandchild = toolCall(
      "call-1/0/2",
      { type: "shell", command: "inner" },
      { name: "bash", turnId: "turn-1", metadata: { parentToolCallId: "call-1" } },
    );
    const tail = [parent, nestedCodemode, grandchild];

    const projection = projectNestedCodemodeCalls({ tail });

    expect(projection.tail).toEqual([parent]);
    expect(projection.groupsByParentItemId.size).toBe(1);
    const group = projection.groupsByParentItemId.get(parent.id);
    expect(group?.run.calls.map((call) => call.id)).toEqual([
      parent.id,
      nestedCodemode.id,
      grandchild.id,
    ]);
  });

  it("returns the same stream references when nothing is nested", () => {
    const tail = [toolCall("tool-1", { type: "shell", command: "one" })];

    const projection = projectNestedCodemodeCalls({ tail });

    expect(projection.tail).toBe(tail);
    expect(projection.head).toBeNull();
    expect(projection.groupsByParentItemId.size).toBe(0);
  });
});
