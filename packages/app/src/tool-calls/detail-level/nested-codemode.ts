import type { AgentToolCallItem, StreamItem, ToolCallItem } from "@/types/stream";
import { agentToolCallItemId, isAgentToolCallItem } from "@/types/stream";
import { createRun, describeToolCall } from "./grouping";
import {
  buildOverviewGroup,
  type OverviewSummary,
  type OverviewToolCallGroup,
} from "./overview/model";

// Pi codemode runs nested tool calls that pi reports as their own tool_execution_* events (their
// ids look like "<rootCallId>/<n>"), and the daemon tags every one of them with the parent row it
// belongs to. The rows reach the app like any other tool call, so this projection lifts them out
// of the stream and files them under that parent: the parent stays one row whose badge counts what
// the script ran, and the children render on an indent rail under it. A row that arrives without
// its children — a transcript recorded before pi reported them — carries a nestedSummary in its
// metadata, and the badge falls back to it.
export interface NestedCodemodeProjection {
  tail: StreamItem[];
  head: StreamItem[] | null;
  groupsByParentItemId: Map<string, OverviewToolCallGroup>;
}

interface NestedScan {
  parentsById: Map<string, AgentToolCallItem>;
  parentsByCallId: Map<string, AgentToolCallItem[]>;
  childEntries: Array<{ item: ToolCallItem; parentCallId: string }>;
}

// Scanning is keyed on the array identity: a live-head flush that only touches a later item reuses
// the scan of the long retained tail instead of walking every row again.
const scanCache = new WeakMap<StreamItem[], NestedScan>();

function scanStreamItems(items: StreamItem[]): NestedScan {
  const cached = scanCache.get(items);
  if (cached) {
    return cached;
  }
  const parentsById = new Map<string, AgentToolCallItem>();
  const parentsByCallId = new Map<string, AgentToolCallItem[]>();
  const childEntries: Array<{ item: ToolCallItem; parentCallId: string }> = [];
  for (const item of items) {
    if (item.kind !== "tool_call") {
      continue;
    }
    if (isAgentToolCallItem(item)) {
      parentsById.set(item.id, item);
      const callId = item.payload.data.callId;
      const candidates = parentsByCallId.get(callId);
      if (candidates) {
        candidates.push(item);
      } else {
        parentsByCallId.set(callId, [item]);
      }
    }
    const parentCallId = nestedParentToolCallId(item);
    if (parentCallId) {
      childEntries.push({ item, parentCallId });
    }
  }
  const scan: NestedScan = { parentsById, parentsByCallId, childEntries };
  scanCache.set(items, scan);
  return scan;
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

function mergeScans(tailScan: NestedScan, headScan: NestedScan | null): NestedScan {
  if (!headScan) {
    return tailScan;
  }
  const parentsByCallId = new Map(tailScan.parentsByCallId);
  for (const [callId, items] of headScan.parentsByCallId) {
    const existing = parentsByCallId.get(callId);
    parentsByCallId.set(callId, existing ? [...existing, ...items] : items);
  }
  return {
    parentsById: new Map([...tailScan.parentsById, ...headScan.parentsById]),
    parentsByCallId,
    childEntries: [...tailScan.childEntries, ...headScan.childEntries],
  };
}

// The child and its parent are not always tagged with the same turn id (one of them may have none),
// so match on the call id first and use the turn only to pick between same-id rows.
function resolveParentItemId(
  item: ToolCallItem,
  parentCallId: string,
  parentsByCallId: Map<string, AgentToolCallItem[]>,
): string | null {
  const candidates = parentsByCallId.get(parentCallId);
  if (!candidates || candidates.length === 0) {
    return null;
  }
  const turnId = isAgentToolCallItem(item) ? item.turnId : undefined;
  const exact = candidates.find(
    (candidate) => candidate.id === agentToolCallItemId({ callId: parentCallId, turnId }),
  );
  if (exact) {
    return exact.id;
  }
  if (candidates.length === 1) {
    return candidates[0]?.id ?? null;
  }
  const sameTurn = candidates.find((candidate) => candidate.turnId === turnId);
  return (sameTurn ?? candidates[candidates.length - 1])?.id ?? null;
}

// A nested codemode call is itself a child. Its own children fold into the ancestor that stays in
// the stream, otherwise they would be lifted out along with the row that rendered them.
function resolveAncestorItemId(
  itemId: string,
  parentItemIdByChildItemId: Map<string, string>,
): string | null {
  let ancestorItemId = parentItemIdByChildItemId.get(itemId) ?? null;
  const visited = new Set<string>([itemId]);
  while (ancestorItemId && parentItemIdByChildItemId.has(ancestorItemId)) {
    if (visited.has(ancestorItemId)) {
      return null;
    }
    visited.add(ancestorItemId);
    ancestorItemId = parentItemIdByChildItemId.get(ancestorItemId) ?? null;
  }
  return ancestorItemId;
}

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readNestedSummary(metadata: Record<string, unknown> | undefined): OverviewSummary | null {
  const raw = metadata?.nestedSummary;
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const counts = raw as Record<string, unknown>;
  const summary: OverviewSummary = {
    editedFileCount: readCount(counts.editedFileCount),
    commandCount: readCount(counts.commandCount),
    readFileCount: readCount(counts.readFileCount),
    searchCount: readCount(counts.searchCount),
    otherToolCount: readCount(counts.otherToolCount),
    byspaceCallCount: readCount(counts.byspaceCallCount),
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

// The `nested:` prefix keeps these ids from colliding with the overview groups that key off
// run ids. The summary counts the children only; the parent is not an action of its own.
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

// Replay fallback: this row kept its badge text in metadata instead of its children.
function buildReplayedGroup(
  parent: AgentToolCallItem,
  groupsByParentItemId: Map<string, OverviewToolCallGroup>,
): void {
  const summary = readNestedSummary(parent.payload.data.metadata);
  if (!summary) {
    return;
  }
  const base = buildOverviewGroup(createRun([parent], true));
  groupsByParentItemId.set(parent.id, {
    ...base,
    summary,
    run: { ...base.run, id: `nested:${parent.id}` },
  });
}

export function projectNestedCodemodeCalls(input: {
  tail: StreamItem[];
  head?: StreamItem[] | null;
}): NestedCodemodeProjection {
  const { tail, head } = input;
  const scan = mergeScans(scanStreamItems(tail), head ? scanStreamItems(head) : null);
  const { parentsById, parentsByCallId, childEntries } = scan;
  const groupsByParentItemId = new Map<string, OverviewToolCallGroup>();

  const parentItemIdByChildItemId = new Map<string, string>();
  for (const { item, parentCallId } of childEntries) {
    const parentItemId = resolveParentItemId(item, parentCallId, parentsByCallId);
    if (parentItemId) {
      parentItemIdByChildItemId.set(item.id, parentItemId);
    }
  }

  const absorbedIds = new Set<string>();
  const childrenByParentItemId = new Map<string, ToolCallItem[]>();
  for (const { item } of childEntries) {
    const parentItemId = resolveAncestorItemId(item.id, parentItemIdByChildItemId);
    if (!parentItemId || !parentsById.has(parentItemId)) {
      continue;
    }
    absorbedIds.add(item.id);
    const children = childrenByParentItemId.get(parentItemId);
    if (children) {
      children.push(item);
    } else {
      childrenByParentItemId.set(parentItemId, [item]);
    }
  }

  for (const [parentItemId, children] of childrenByParentItemId) {
    const parent = parentsById.get(parentItemId);
    if (parent) {
      buildNestedGroup(parent, children, groupsByParentItemId);
    }
  }

  for (const parent of parentsById.values()) {
    if (childrenByParentItemId.has(parent.id) || absorbedIds.has(parent.id)) {
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
