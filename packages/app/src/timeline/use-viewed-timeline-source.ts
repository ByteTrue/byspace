import { useLayoutEffect } from "react";
import type { ViewedTimelineUiBridge } from "./viewed-timeline-sync";

const sourceOwners = new WeakMap<ViewedTimelineUiBridge, Map<string, symbol>>();

export function useViewedTimelineSource(
  sync: ViewedTimelineUiBridge | null,
  sourceId: string | null | undefined,
  agentIds: string[],
): void {
  useLayoutEffect(() => {
    if (!sourceId || !sync) return;
    const owners = sourceOwners.get(sync) ?? new Map<string, symbol>();
    const owner = Symbol("viewed-timeline-source");
    owners.set(sourceId, owner);
    sourceOwners.set(sync, owners);
    sync.replaceVisibleAgentIds(sourceId, agentIds);
    return () => {
      queueMicrotask(() => {
        const currentOwners = sourceOwners.get(sync);
        if (currentOwners?.get(sourceId) !== owner) return;
        currentOwners.delete(sourceId);
        if (currentOwners.size === 0) sourceOwners.delete(sync);
        sync.replaceVisibleAgentIds(sourceId, []);
      });
    };
  }, [agentIds, sourceId, sync]);
}
