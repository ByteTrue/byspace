import { useEffect } from "react";
import { useSessionStore } from "@/stores/session-store";

/**
 * Publish an agent as on screen to the viewed-timeline owner.
 *
 * Selective daemons subscribe to and catch up only the agents a surface said it
 * shows, and until this hook the workspace screen was the sole publisher
 * (packages/app/src/screens/workspace/workspace-screen.tsx). An agent rendered
 * anywhere else stayed undesired — no subscription, no authoritative catch-up —
 * and `useAgentScreenStateMachine` holds its first-paint gate until that
 * catch-up lands (packages/app/src/hooks/use-agent-screen-state-machine.ts,
 * `shouldBlockInitialAuthoritativeReadyState`). The Chief floating window hit
 * exactly that: an endless spinner on a cold timeline while the same agent
 * rendered fine on its full page.
 *
 * Registration is keyed by source and the owner unions sources, so this composes
 * with the workspace screen instead of competing with it. The registration is
 * released on unmount or when the agent changes: a closed window owes nothing.
 */
export function useVisibleAgentTimeline(input: { serverId: string; agentId: string | null }): void {
  const { serverId, agentId } = input;
  const viewedTimelineSync = useSessionStore(
    (state) => state.sessions[serverId]?.viewedTimelineSync ?? null,
  );
  const sourceId = `visible-agent:${serverId}:${agentId ?? "none"}`;
  useEffect(() => {
    if (!viewedTimelineSync || !agentId) return;
    viewedTimelineSync.replaceVisibleAgentIds(sourceId, [agentId]);
    return () => viewedTimelineSync.replaceVisibleAgentIds(sourceId, []);
  }, [viewedTimelineSync, sourceId, agentId]);
}
