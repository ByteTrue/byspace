import { useEffect, useMemo } from "react";
import { usePendingArchiveAgentIds } from "@/hooks/use-archive-agent";
import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useSessionStore, type Agent } from "@/stores/session-store";
import {
  refreshProviderSubagents,
  useProviderSubagentStore,
  type ProviderSubagentState,
} from "./provider-store";
import type { ProviderSubagentDescriptorPayload } from "@bytetrue/protocol/messages";

export interface BySpaceSubagentRow {
  kind: "byspace";
  id: Agent["id"];
  provider: Agent["provider"];
  title: Agent["title"];
  /** Managed agents have a real title, so the union's task line is always absent for them. */
  description: null;
  subtitle: null;
  status: Agent["status"];
  turn: Agent["turn"];
  requiresAttention: Agent["requiresAttention"];
  createdAt: Agent["createdAt"];
}

export interface ProviderSubagentRow {
  kind: "provider";
  id: string;
  parentAgentId: string;
  provider: ProviderSubagentDescriptorPayload["provider"];
  // `title` is the subagent type ("Explore", "general-purpose") and repeats across a fan-out;
  // `description` is the task it was given. Both are carried so presentation can choose which
  // one names the row — collapsing them here is what makes every row read alike.
  title: string | null;
  description: string | null;
  /** Compact provider-owned context. The app displays it without interpreting its contents. */
  subtitle: string | null;
  status: ProviderSubagentDescriptorPayload["status"];
  requiresAttention: boolean;
  createdAt: Date;
}

export type SubagentRow = BySpaceSubagentRow | ProviderSubagentRow;

const EMPTY_SUBAGENTS_BY_CALL_ID = new Map<string, ProviderSubagentDescriptorPayload>();

type SessionStoreSnapshot = ReturnType<typeof useSessionStore.getState>;
type ProviderSubagentStoreSnapshot = ReturnType<typeof useProviderSubagentStore.getState>;

interface SelectSubagentsParams {
  serverId: string;
  parentAgentId: string;
  /** Select children of this provider subagent instead of children of the managed agent. */
  providerParentSubagentId?: string;
}

const EMPTY_SUBAGENT_ROWS: SubagentRow[] = [];
const EMPTY_PROVIDER_SUBAGENT_ROWS: ProviderSubagentRow[] = [];

function toSubagentRow(agent: Agent): SubagentRow {
  return {
    kind: "byspace",
    id: agent.id,
    provider: agent.provider,
    title: agent.title,
    description: null,
    subtitle: null,
    status: agent.status,
    turn: agent.turn,
    requiresAttention: agent.requiresAttention,
    createdAt: agent.createdAt,
  };
}

export function selectSubagentsForParent(
  state: SessionStoreSnapshot,
  params: SelectSubagentsParams,
  pendingArchiveIds: ReadonlySet<string>,
): SubagentRow[] {
  const agents = state.sessions[params.serverId]?.agents;
  if (!agents || agents.size === 0) {
    return EMPTY_SUBAGENT_ROWS;
  }

  const rows: SubagentRow[] = [];
  for (const agent of agents.values()) {
    if (
      agent.archivedAt ||
      pendingArchiveIds.has(agent.id) ||
      agent.parentAgentId !== params.parentAgentId
    ) {
      continue;
    }
    rows.push(toSubagentRow(agent));
  }

  if (rows.length === 0) {
    return EMPTY_SUBAGENT_ROWS;
  }

  rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  return rows;
}

export function selectProviderSubagentsForParent(
  state: ProviderSubagentStoreSnapshot,
  params: SelectSubagentsParams,
  supported: boolean,
  nestingSupported = false,
): ProviderSubagentRow[] {
  if (!supported) return EMPTY_PROVIDER_SUBAGENT_ROWS;
  if (params.providerParentSubagentId && !nestingSupported) return EMPTY_PROVIDER_SUBAGENT_ROWS;
  const rows: ProviderSubagentRow[] = [];
  const prefix = `${params.serverId}\0${params.parentAgentId}\0`;
  for (const [key, subagent] of state.descriptors) {
    if (!key.startsWith(prefix) || state.hiddenFromTrack.has(key)) continue;
    if (
      nestingSupported &&
      (subagent.parentSubagentId ?? null) !== (params.providerParentSubagentId ?? null)
    ) {
      continue;
    }
    rows.push({
      kind: "provider",
      id: subagent.id,
      parentAgentId: subagent.parentAgentId,
      provider: subagent.provider,
      title: subagent.title,
      description: subagent.description,
      subtitle: subagent.subtitle ?? null,
      status: subagent.status,
      requiresAttention: subagent.status === "failed",
      createdAt: new Date(subagent.createdAt),
    });
  }
  rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  return rows;
}

/**
 * Descriptors for one parent agent indexed by their launch tool call id — the join key between a
 * timeline tool row (`AgentToolCallItem.payload.data.callId`) and its live subagent state.
 */
export function selectProviderSubagentsByToolCallId(
  state: ProviderSubagentState,
  serverId: string,
  parentAgentId: string,
): Map<string, ProviderSubagentDescriptorPayload> {
  const prefix = `${serverId}\0${parentAgentId}\0`;
  const byCallId = new Map<string, ProviderSubagentDescriptorPayload>();
  for (const [key, subagent] of state.descriptors) {
    if (!key.startsWith(prefix) || !subagent.toolCallId) {
      continue;
    }
    byCallId.set(subagent.toolCallId, subagent);
  }
  return byCallId;
}

/** Same-size, same-member map: descriptor objects are stable references from the store. */
function mapsShallowEqual(
  left: Map<string, ProviderSubagentDescriptorPayload>,
  right: Map<string, ProviderSubagentDescriptorPayload>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false;
  }
  return true;
}

/**
 * Live provider-subagent descriptors for one parent agent, keyed by the call id of the tool row
 * that launched them. Timeline rows look their descriptor up here to render inline status; an
 * empty map (feature off, no reports) leaves rows untouched. The selector allocates a fresh map
 * per call, so equality is shallow — otherwise any provider-subagent event anywhere re-renders
 * every subscribed stream.
 */
export function useProviderSubagentsByToolCallId(params: {
  serverId: string;
  parentAgentId: string;
}): Map<string, ProviderSubagentDescriptorPayload> {
  const supported = useSessionStore(
    (state) => state.sessions[params.serverId]?.serverInfo?.features?.providerSubagents === true,
  );
  return useStoreWithEqualityFn(
    useProviderSubagentStore,
    (state) =>
      supported
        ? selectProviderSubagentsByToolCallId(state, params.serverId, params.parentAgentId)
        : EMPTY_SUBAGENTS_BY_CALL_ID,
    mapsShallowEqual,
  );
}

export function useSubagentsForParent(params: SelectSubagentsParams): SubagentRow[] {
  const pendingArchiveIds = usePendingArchiveAgentIds(params.serverId);
  const byspaceRows = useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectSubagentsForParent(state, params, pendingArchiveIds),
    equal,
  );
  const supported = useSessionStore(
    (state) => state.sessions[params.serverId]?.serverInfo?.features?.providerSubagents === true,
  );
  const nestingSupported = useSessionStore(
    (state) =>
      state.sessions[params.serverId]?.serverInfo?.features?.providerSubagentNesting === true,
  );
  const providerRows = useStoreWithEqualityFn(
    useProviderSubagentStore,
    (state) => selectProviderSubagentsForParent(state, params, supported, nestingSupported),
    equal,
  );
  const client = useSessionStore((state) => state.sessions[params.serverId]?.client ?? null);

  useEffect(() => {
    if (!client || !supported) return;
    void refreshProviderSubagents(client, params.serverId, params.parentAgentId).catch(
      () => undefined,
    );
  }, [client, params.parentAgentId, params.serverId, supported]);

  return useMemo(() => {
    if (params.providerParentSubagentId) return providerRows;
    if (providerRows.length === 0) return byspaceRows;
    const rows = [...byspaceRows, ...providerRows];
    rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    return rows;
  }, [params.providerParentSubagentId, byspaceRows, providerRows]);
}
