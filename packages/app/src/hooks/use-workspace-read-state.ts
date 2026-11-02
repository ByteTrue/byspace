import { useCallback, useMemo } from "react";
import { i18n } from "@/i18n/i18next";
import { useHostFeature } from "@/runtime/host-features";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { type Agent, useSessionStore } from "@/stores/session-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { markWorkspaceUnread } from "@/workspace/mark-unread";

export interface WorkspaceReadStateController {
  hasClearableAttention: boolean;
  canMarkUnread: boolean;
  clearAttention: () => Promise<void>;
  markUnread: () => Promise<void>;
}

/**
 * Whether the daemon has an agent to mark in this workspace: an active root agent (no parent in
 * the same workspace) that finished its turn, holds no attention and waits on no permission.
 * Mirrors firstMarkableAgent and canMarkUnread in internal/server/agent_attention.go. A workspace
 * with no such agent still reports "done" (it is the bucket of a workspace with no agents), and
 * offering the action there only produced the daemon's error.
 */
export function workspaceHasMarkableAgent(
  agents: ReadonlyMap<string, Agent> | undefined,
  workspaceId: string,
): boolean {
  if (!agents) {
    return false;
  }
  for (const agent of agents.values()) {
    if (agent.workspaceId !== workspaceId || agent.archivedAt) {
      continue;
    }
    const parent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
    if (
      agent.parentAgentId &&
      (!parent || parent.archivedAt || parent.workspaceId === workspaceId)
    ) {
      continue;
    }
    if (agent.status !== "idle" && agent.status !== "closed") {
      continue;
    }
    if (agent.requiresAttention || agent.pendingPermissions.length > 0) {
      continue;
    }
    return true;
  }
  return false;
}

export function useWorkspaceReadState({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}): WorkspaceReadStateController {
  const status = useWorkspaceFields(serverId, workspaceId, (workspace) => workspace.status);
  const supportsMarkUnread = useHostFeature(serverId, "workspaceMarkUnread");
  const hasClearableAttention = status === "attention" || status === "failed";
  const offersMarkUnread = supportsMarkUnread && status === "done";
  const hasMarkableAgent = useSessionStore(
    (state) =>
      offersMarkUnread && workspaceHasMarkableAgent(state.sessions[serverId]?.agents, workspaceId),
  );
  const canMarkUnread = offersMarkUnread && hasMarkableAgent;

  const clearAttention = useCallback(async () => {
    if (!hasClearableAttention) {
      return;
    }
    const client = getHostRuntimeStore().getClient(serverId);
    if (!client) {
      throw new Error(i18n.t("workspace.terminal.hostDisconnected"));
    }
    await client.clearWorkspaceAttention(workspaceId);
  }, [hasClearableAttention, serverId, workspaceId]);

  const markUnread = useCallback(async () => {
    if (!canMarkUnread) {
      return;
    }
    await markWorkspaceUnread(serverId, workspaceId);
  }, [canMarkUnread, serverId, workspaceId]);

  return useMemo(
    () => ({ hasClearableAttention, canMarkUnread, clearAttention, markUnread }),
    [canMarkUnread, clearAttention, hasClearableAttention, markUnread],
  );
}
