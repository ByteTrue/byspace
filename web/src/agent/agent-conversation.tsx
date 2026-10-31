import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useVisibleAgentTimeline } from "@/timeline/use-visible-agent-timeline";
import type { StreamItem } from "@/types/stream";
import { StreamItemView } from "~/agent/stream-item";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "~/components/ui/message-scroller";
import { Spinner } from "~/components/ui/spinner";

const EMPTY: StreamItem[] = [];

export function AgentConversation({ serverId, agentId }: { serverId: string; agentId: string }) {
  // Tells the daemon this agent is on screen, so its timeline is subscribed and caught up.
  useVisibleAgentTimeline({ serverId, agentId });
  const tail = useSessionStore(
    (state) => state.sessions[serverId]?.agentStreamTail.get(agentId) ?? EMPTY,
  );
  const head = useSessionStore(
    (state) => state.sessions[serverId]?.agentStreamHead.get(agentId) ?? EMPTY,
  );
  const cwd = useSessionStore((state) => state.sessions[serverId]?.agents.get(agentId)?.cwd);
  const items = useMemo(() => (head.length > 0 ? [...tail, ...head] : tail), [tail, head]);

  const viewedTimelineSync = useSessionStore(
    (state) => state.sessions[serverId]?.viewedTimelineSync ?? null,
  );
  const subscribe = useCallback(
    (listener: () => void) => viewedTimelineSync?.subscribe(listener) ?? (() => {}),
    [viewedTimelineSync],
  );
  const readStatus = useCallback(
    () => viewedTimelineSync?.getAgentTimelineStatus(agentId) ?? "ready",
    [agentId, viewedTimelineSync],
  );
  const status = useSyncExternalStore(subscribe, readStatus, readStatus);

  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {status === "ready" ? "No messages yet." : <Spinner />}
      </div>
    );
  }

  return (
    <MessageScrollerProvider key={agentId} autoScroll defaultScrollPosition="end">
      <MessageScroller className="flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent className="mx-auto w-full max-w-[820px] gap-4 px-4 pt-6 pb-4">
            {items.map((item) => (
              <MessageScrollerItem
                key={item.id}
                messageId={item.id}
                scrollAnchor={item.kind === "user_message"}
              >
                <StreamItemView item={item} cwd={cwd} />
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
