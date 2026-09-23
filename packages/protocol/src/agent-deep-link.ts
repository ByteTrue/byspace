export interface AgentDeepLinkTarget {
  serverId: string;
  agentId: string;
}

function normalizeSegment(value: string): string {
  return value.trim();
}

function normalizeAgentDeepLinkTarget(target: AgentDeepLinkTarget): AgentDeepLinkTarget {
  const serverId = normalizeSegment(target.serverId);
  const agentId = normalizeSegment(target.agentId);
  if (!serverId || !agentId) {
    throw new Error("Agent deep links require a server ID and agent ID.");
  }
  return { serverId, agentId };
}

export function buildAgentDeepLinkRoute(
  target: AgentDeepLinkTarget,
): `/h/${string}/agent/${string}` {
  const { serverId, agentId } = normalizeAgentDeepLinkTarget(target);
  return `/h/${encodeURIComponent(serverId)}/agent/${encodeURIComponent(agentId)}`;
}
