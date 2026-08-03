import { useLayoutEffect } from "react";
import type { ViewedTimelineUiBridge } from "./viewed-timeline-sync";

export function useViewedTimelineSource(
  sync: ViewedTimelineUiBridge | null,
  sourceId: string | null | undefined,
  agentIds: string[],
): void {
  useLayoutEffect(() => {
    if (!sourceId || !sync) return;
    // Layout cleanup precedes replacement setup, so a same-key source cannot erase its remount.
    sync.replaceVisibleAgentIds(sourceId, agentIds);
    return () => sync.replaceVisibleAgentIds(sourceId, []);
  }, [agentIds, sourceId, sync]);
}
