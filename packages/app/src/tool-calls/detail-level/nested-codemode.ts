import type { AgentToolCallItem, StreamItem, ToolCallItem } from "@/types/stream";
import { agentToolCallItemId, isAgentToolCallItem } from "@/types/stream";

import { createRun, describeToolCall } from "./grouping";
import {
  buildOverviewGroup,
  type OverviewSummary,
  type OverviewToolCallGroup,
} from "./overview/model";

// Pi codemode runs nested tool calls that pi reports as their own tool_execution_* events
// (ids look like "<rootCallId>/<n>"), but those events never persist into the transcript —
// on reload only the parent codemode row replays, with a nestedCalls summary in its metadata.
// Lift the child rows out of the stream and index them by parent row: the parent renders as
// itself, with the counts as its badge summary, and the children render on an indent rail
// underneath. Replayed parents carry no children, so their metadata summary is the only trace.
export interface NestedCodemodeProjection {
  tail: StreamItem[];
  head: StreamItem[] | null;
  groupsByParentItemId: Map<string, OverviewToolCallGroup>;
}

function nestedParentToolCallId(item: ToolCallItem): string | null {
  if (!isAgentToolCallItem(item)) {
    return null;
  }
  const parent = item.payload.data.metadata?.parentToolCallId;
  return typeof parent === "string" && parent.length > 0 ? parent : null;
}

function isRunningCall(item: ToolCallItem): boolean {
  const status = describeToolCall(item).status;
  return status === "running" || status === "executing";
}

function readNestedSummary(metadata: Record<string, unknown> | undefined): OverviewSummary | null {
  const raw = metadata?.nestedSummary;
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const readCount = (key: string): number => {
    const value = record[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };
  const summary: OverviewSummary = {
    editedFileCount: readCount("editedFileCount"),
    commandCount: readCount("commandCount"),
    readFileCount: readCount("readFileCount"),
    searchCount: readCount("searchCount"),
    otherToolCount: readCount("otherToolCount"),
    byspaceCallCount: readCount("byspaceCallCount"),
  };
  const total =
    summary.editedFileCount +
    summary.commandCount +
    summary.readFileCount +
    summary.searchCount +
    summary.otherToolCount +
    summary.byspaceCallCount;
  return total > 0 ? summary : null;
}

// Key the run by the parent row (with a prefix) so the expanded state never collides with an
// overview group that may also host the same parent codemode call. The summary/loading state
// only counts the children so the parent call is not counted twice.
function buildNestedGroup(
  parent: ToolCallItem,
  children: ToolCallItem[],
  groupsByParentItemId: Map<string, OverviewToolCallGroup>,
): void {
  const childRun = createRun(children, true);
  const base = buildOverviewGroup(childRun);
  groupsByParentItemId.set(parent.id, {
    ...base,
    isLoading: base.isLoading || isRunningCall(parent),
    run: {
      id: `nested:${parent.id}`,
      calls: [parent, ...children],
      latest: parent,
      isSealed: true,
    },
  });
}

// Replay fallback: the child rows never persisted, so the parent row carries a nestedSummary
// in its metadata to restore the collapsed badge after a reload.
function buildReplayedGroup(
  parent: AgentToolCallItem,
  groupsByParentItemId: Map<string, OverviewToolCallGroup>,
): void {
  const summary = readNestedSummary(parent.payload.data.metadata);
  if (!summary) {
    return;
  }
  groupsByParentItemId.set(parent.id, {
    mode: "overview",
    isLoading: isRunningCall(parent),
    run: {
      id: `nested:${parent.id}`,
      calls: [parent],
      latest: parent,
      isSealed: true,
    },
    summary,
  });
}

// Projects the nested rows out of the stream and indexes one group per parent codemode row.
// Orphaned children (parent not in tail/head — transient states) stay in place so the rows
// are never silently dropped.
export function projectNestedCodemodeCalls(input: {
  tail: StreamItem[];
  head?: StreamItem[] | null;
}): NestedCodemodeProjection {
  const { tail, head } = input;

  const parentById = new Map<string, AgentToolCallItem>();
  const childEntries: Array<{ item: ToolCallItem; parentCallId: string }> = [];
  const scanItem = (item: StreamItem): void => {
    if (item.kind !== "tool_call") {
      return;
    }
    if (isAgentToolCallItem(item)) {
      parentById.set(item.id, item);
    }
    const parentCallId = nestedParentToolCallId(item);
    if (parentCallId) {
      childEntries.push({ item, parentCallId });
    }
  };
  for (const item of tail) {
    scanItem(item);
  }
  if (head) {
    for (const item of head) {
      scanItem(item);
    }
  }

  const absorbedIds = new Set<string>();
  const childrenByParentItemId = new Map<string, ToolCallItem[]>();
  for (const { item, parentCallId } of childEntries) {
    const parentItemId = agentToolCallItemId({
      callId: parentCallId,
      turnId: isAgentToolCallItem(item) ? item.turnId : undefined,
    });
    if (!parentById.has(parentItemId)) {
      continue;
    }
    absorbedIds.add(item.id);
    let children = childrenByParentItemId.get(parentItemId);
    if (!children) {
      children = [];
      childrenByParentItemId.set(parentItemId, children);
    }
    children.push(item);
  }

  const groupsByParentItemId = new Map<string, OverviewToolCallGroup>();
  for (const [parentItemId, children] of childrenByParentItemId) {
    const parent = parentById.get(parentItemId);
    if (parent) {
      buildNestedGroup(parent, children, groupsByParentItemId);
    }
  }
  for (const parent of parentById.values()) {
    if (childrenByParentItemId.has(parent.id) || absorbedIds.has(parent.id)) {
      // Real children or the row is itself a nested call folded into a grandparent group
      // (codemode inside codemode): it renders as a plain row when that group expands.
      continue;
    }
    if (parent.payload.data.metadata?.nestedSummary !== undefined) {
      buildReplayedGroup(parent, groupsByParentItemId);
    }
  }

  if (absorbedIds.size === 0) {
    return { tail, head: head ?? null, groupsByParentItemId };
  }

  return {
    tail: tail.filter((item) => !absorbedIds.has(item.id)),
    head: head ? head.filter((item) => !absorbedIds.has(item.id)) : null,
    groupsByParentItemId,
  };
}
