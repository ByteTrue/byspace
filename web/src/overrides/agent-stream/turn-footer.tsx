// Override of packages/app/src/agent-stream/turn-footer.tsx: the row after a turn — the working
// glyph and elapsed time while it runs, then copy, fork and the turn's duration.
import { memo, useCallback, type ReactNode } from "react";
import type { TurnTiming } from "@/timeline/turn-time";
import type { StreamItem } from "@/types/stream";
import type { StreamStrategy } from "@/agent-stream/strategy";
import {
  resolveAssistantTurnForkBoundary,
  type AssistantTurnForkBoundary,
} from "@/agent-stream/turn-boundary";
import type { TurnFooterHost } from "@/agent-stream/layout";
import { AssistantTurnFooter, LiveElapsed, type AssistantForkTarget } from "@/components/message";
import { AssistantForkMenu } from "@/components/assistant-fork-menu";
import { SyncedLoader } from "@/components/synced-loader";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { SPACING } from "@/styles/theme";

export const TURN_FOOTER_BOTTOM_SPACING = SPACING[8];

export type TurnContentStrategy = StreamStrategy;

export type AssistantTurnForkHandler = (input: {
  target: AssistantForkTarget;
  boundary: AssistantTurnForkBoundary;
}) => Promise<void> | void;

/**
 * Fork handler for the turn still streaming. It takes no boundary on purpose: with neither
 * boundary field the fork projects the whole timeline, partially streamed text included.
 */
export type InFlightTurnForkHandler = (target: AssistantForkTarget) => Promise<void> | void;

export const TurnFooter = memo(function TurnFooter({
  isRunning,
  inFlightTurnStartedAt,
  host,
  strategy,
  supportsTimelineCursor,
  onForkAssistantTurn,
  onForkInFlightTurn,
}: {
  isRunning: boolean;
  inFlightTurnStartedAt: Date | null;
  host: TurnFooterHost | null;
  strategy: TurnContentStrategy;
  supportsTimelineCursor: boolean;
  onForkAssistantTurn?: AssistantTurnForkHandler;
  onForkInFlightTurn?: InFlightTurnForkHandler;
}) {
  if (isRunning) {
    return (
      <TurnFooterRow>
        <div
          className="flex min-h-6 items-center self-start pb-8"
          data-testid="turn-working-indicator"
        >
          <WorkingIndicator
            inFlightTurnStartedAt={inFlightTurnStartedAt}
            onForkInFlightTurn={onForkInFlightTurn}
          />
        </div>
      </TurnFooterRow>
    );
  }
  if (!host) return null;
  return (
    <CompletedTurnFooterRow
      strategy={strategy}
      items={host.items}
      timing={host.timing}
      startIndex={host.startIndex}
      supportsTimelineCursor={supportsTimelineCursor}
      onForkAssistantTurn={onForkAssistantTurn}
    />
  );
});

export const CompletedTurnFooterRow = memo(function CompletedTurnFooterRow({
  strategy,
  items,
  timing,
  startIndex,
  supportsTimelineCursor,
  onForkAssistantTurn,
}: {
  strategy: TurnContentStrategy;
  items: StreamItem[];
  timing?: TurnTiming;
  startIndex: number;
  supportsTimelineCursor: boolean;
  onForkAssistantTurn?: AssistantTurnForkHandler;
}) {
  const getContent = useCallback(
    () => strategy.collectAssistantResponseContent(items, startIndex),
    [strategy, items, startIndex],
  );
  const boundary = resolveAssistantTurnForkBoundary({ items, startIndex, supportsTimelineCursor });
  const handleFork = useCallback(
    (target: AssistantForkTarget) => {
      if (!boundary) return;
      return onForkAssistantTurn?.({ target, boundary });
    },
    [boundary, onForkAssistantTurn],
  );
  return (
    <TurnFooterRow>
      <div className="flex min-h-6 items-center self-start pb-8">
        <AssistantTurnFooter
          getContent={getContent}
          completedAt={timing?.completedAt}
          durationMs={timing?.durationMs}
          onFork={boundary && onForkAssistantTurn ? handleFork : undefined}
        />
      </div>
    </TurnFooterRow>
  );
});

const WorkingIndicator = memo(function WorkingIndicator({
  inFlightTurnStartedAt = null,
  onForkInFlightTurn,
}: {
  inFlightTurnStartedAt?: Date | null;
  onForkInFlightTurn?: InFlightTurnForkHandler;
}) {
  const active = useRetainedPanelActive();
  return (
    <div className="flex h-6 items-center gap-3">
      <span className="-ml-0.5 flex text-foreground">
        <SyncedLoader size={14} />
      </span>
      {/* Match the completed-turn footer: actions precede timing metadata. */}
      {onForkInFlightTurn ? <AssistantForkMenu onFork={onForkInFlightTurn} /> : null}
      {inFlightTurnStartedAt ? (
        <LiveElapsed
          startedAt={inFlightTurnStartedAt}
          active={active}
          className="text-[13px] text-muted-foreground tabular-nums"
          testID="turn-working-elapsed"
        />
      ) : null}
    </div>
  );
});

function TurnFooterRow({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto mt-[13px] flex w-full max-w-[820px] flex-col px-2">{children}</div>
  );
}
