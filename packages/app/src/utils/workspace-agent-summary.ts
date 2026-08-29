import type { Agent } from "@/stores/session-store";
import { deriveSidebarStateBucket, type SidebarStateBucket } from "@/utils/sidebar-agent-state";

export interface WorkspaceAgentStatus {
  agentId: string;
  title: string | null;
  parentAgentId: string | null;
  depth: number;
  status: SidebarStateBucket;
  statusEnteredAt: Date;
  lastActivityAt: Date;
}

export interface WorkspaceAgentSummary {
  agents: WorkspaceAgentStatus[];
  status: SidebarStateBucket;
  statusEnteredAt: Date;
  needsAttentionCount: number;
  workingCount: number;
  oldestAttentionAt: Date | null;
  latestActivityAt: Date;
}

const STATUS_PRIORITY: Record<SidebarStateBucket, number> = {
  needs_input: 0,
  failed: 1,
  attention: 2,
  running: 3,
  done: 4,
};

export function isAgentStatusNeedingAttention(status: SidebarStateBucket): boolean {
  return status === "needs_input" || status === "failed" || status === "attention";
}

export function buildWorkspaceAgentSummaryIndex(
  agents: ReadonlyMap<string, Agent>,
  previous?: ReadonlyMap<string, WorkspaceAgentSummary>,
): Map<string, WorkspaceAgentSummary> {
  const previousAgentStatuses = new Map<string, WorkspaceAgentStatus>();
  for (const summary of previous?.values() ?? []) {
    for (const agent of summary.agents) {
      previousAgentStatuses.set(agent.agentId, agent);
    }
  }

  const agentsByWorkspace = new Map<string, WorkspaceAgentStatus[]>();
  for (const agent of agents.values()) {
    if (agent.archivedAt || !agent.workspaceId) continue;

    const workspaceAgents = agentsByWorkspace.get(agent.workspaceId) ?? [];
    workspaceAgents.push(toWorkspaceAgentStatus(agent, previousAgentStatuses.get(agent.id)));
    agentsByWorkspace.set(agent.workspaceId, workspaceAgents);
  }

  const summaries = new Map<string, WorkspaceAgentSummary>();
  for (const [workspaceId, workspaceAgents] of agentsByWorkspace) {
    const summary = summarizeWorkspaceAgents(workspaceAgents);
    const previousSummary = previous?.get(workspaceId);
    summaries.set(
      workspaceId,
      previousSummary && areWorkspaceAgentSummariesEqual(previousSummary, summary)
        ? previousSummary
        : summary,
    );
  }

  if (previous && areWorkspaceAgentSummaryIndexesEqual(previous, summaries)) {
    return previous instanceof Map ? previous : new Map(previous);
  }
  return summaries;
}

function toWorkspaceAgentStatus(
  agent: Agent,
  previous: WorkspaceAgentStatus | undefined,
): WorkspaceAgentStatus {
  const status = deriveSidebarStateBucket({
    status: agent.status,
    pendingPermissionCount: agent.pendingPermissions.length,
    requiresAttention: agent.requiresAttention,
    attentionReason: agent.attentionReason,
  });
  return {
    agentId: agent.id,
    title: agent.title?.trim() || null,
    parentAgentId: agent.parentAgentId,
    depth: 0,
    status,
    statusEnteredAt:
      previous?.status === status
        ? previous.statusEnteredAt
        : (agent.attentionTimestamp ?? agent.updatedAt),
    lastActivityAt: agent.lastActivityAt,
  };
}

function summarizeWorkspaceAgents(agents: WorkspaceAgentStatus[]): WorkspaceAgentSummary {
  const agentsInTreeOrder = orderWorkspaceAgents(agents);
  const needsAttentionAgents = agentsInTreeOrder.filter((agent) =>
    isAgentStatusNeedingAttention(agent.status),
  );
  const status = agentsInTreeOrder.reduce(
    (highest, agent) =>
      STATUS_PRIORITY[agent.status] < STATUS_PRIORITY[highest] ? agent.status : highest,
    "done" as SidebarStateBucket,
  );
  const statusAgents = agentsInTreeOrder.filter((agent) => agent.status === status);
  return {
    agents: agentsInTreeOrder,
    status,
    statusEnteredAt: earliestDate(statusAgents.map((agent) => agent.statusEnteredAt)),
    needsAttentionCount: needsAttentionAgents.length,
    workingCount: agentsInTreeOrder.filter((agent) => agent.status === "running").length,
    oldestAttentionAt:
      needsAttentionAgents.length > 0
        ? earliestDate(needsAttentionAgents.map((agent) => agent.statusEnteredAt))
        : null,
    latestActivityAt: latestDate(agentsInTreeOrder.map((agent) => agent.lastActivityAt)),
  };
}

function orderWorkspaceAgents(agents: WorkspaceAgentStatus[]): WorkspaceAgentStatus[] {
  const byId = new Map(agents.map((agent) => [agent.agentId, agent]));
  const childrenByParent = new Map<string, WorkspaceAgentStatus[]>();
  const roots: WorkspaceAgentStatus[] = [];

  for (const agent of agents) {
    if (!agent.parentAgentId || !byId.has(agent.parentAgentId)) {
      roots.push({ ...agent, parentAgentId: null });
      continue;
    }
    const children = childrenByParent.get(agent.parentAgentId) ?? [];
    children.push(agent);
    childrenByParent.set(agent.parentAgentId, children);
  }

  function agentGroupPriority(status: SidebarStateBucket): number {
    if (isAgentStatusNeedingAttention(status)) return 0;
    return status === "running" ? 1 : 2;
  }

  const subtreePriority = new Map<string, number>();
  function resolveSubtreePriority(agent: WorkspaceAgentStatus, visiting: Set<string>): number {
    const cached = subtreePriority.get(agent.agentId);
    if (cached !== undefined) return cached;
    if (visiting.has(agent.agentId)) return agentGroupPriority(agent.status);

    visiting.add(agent.agentId);
    let priority = agentGroupPriority(agent.status);
    for (const child of childrenByParent.get(agent.agentId) ?? []) {
      priority = Math.min(priority, resolveSubtreePriority(child, visiting));
    }
    visiting.delete(agent.agentId);
    subtreePriority.set(agent.agentId, priority);
    return priority;
  }

  function compareAgents(left: WorkspaceAgentStatus, right: WorkspaceAgentStatus): number {
    const priorityDifference =
      resolveSubtreePriority(left, new Set()) - resolveSubtreePriority(right, new Set());
    if (priorityDifference !== 0) return priorityDifference;
    const activityDifference = right.lastActivityAt.getTime() - left.lastActivityAt.getTime();
    if (activityDifference !== 0) return activityDifference;
    return left.agentId.localeCompare(right.agentId);
  }

  const ordered: WorkspaceAgentStatus[] = [];
  const visited = new Set<string>();
  function appendTree(agent: WorkspaceAgentStatus, depth: number): void {
    if (visited.has(agent.agentId)) return;
    visited.add(agent.agentId);
    ordered.push({ ...agent, depth });
    const children = (childrenByParent.get(agent.agentId) ?? []).slice().sort(compareAgents);
    for (const child of children) appendTree(child, depth + 1);
  }

  for (const root of roots.slice().sort(compareAgents)) appendTree(root, 0);
  for (const agent of agents.slice().sort(compareAgents)) appendTree(agent, 0);
  return ordered;
}

function earliestDate(dates: Date[]): Date {
  return dates.reduce((earliest, date) => (date < earliest ? date : earliest));
}

function latestDate(dates: Date[]): Date {
  return dates.reduce((latest, date) => (date > latest ? date : latest));
}

function areWorkspaceAgentSummariesEqual(
  left: WorkspaceAgentSummary,
  right: WorkspaceAgentSummary,
): boolean {
  if (
    left.status !== right.status ||
    left.statusEnteredAt.getTime() !== right.statusEnteredAt.getTime() ||
    left.needsAttentionCount !== right.needsAttentionCount ||
    left.workingCount !== right.workingCount ||
    left.oldestAttentionAt?.getTime() !== right.oldestAttentionAt?.getTime() ||
    left.latestActivityAt.getTime() !== right.latestActivityAt.getTime() ||
    left.agents.length !== right.agents.length
  ) {
    return false;
  }
  return left.agents.every((agent, index) => {
    const other = right.agents[index];
    return Boolean(
      other &&
      agent.agentId === other.agentId &&
      agent.title === other.title &&
      agent.parentAgentId === other.parentAgentId &&
      agent.depth === other.depth &&
      agent.status === other.status &&
      agent.statusEnteredAt.getTime() === other.statusEnteredAt.getTime() &&
      agent.lastActivityAt.getTime() === other.lastActivityAt.getTime(),
    );
  });
}

function areWorkspaceAgentSummaryIndexesEqual(
  left: ReadonlyMap<string, WorkspaceAgentSummary>,
  right: ReadonlyMap<string, WorkspaceAgentSummary>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [workspaceId, summary] of right) {
    if (left.get(workspaceId) !== summary) return false;
  }
  return true;
}
