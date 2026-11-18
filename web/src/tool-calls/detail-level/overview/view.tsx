// Port of archive/expo-app:packages/app/src/tool-calls/detail-level/overview/view.tsx: a run of tool calls
// folded into one row; open, it lists them in a 400px scroll that follows the newest (on a phone
// it opens a drawer instead).
import { memo, useCallback, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ExpandableBadge } from "@/components/message";
import { useIsCompactFormFactor } from "@/constants/layout";
import type {
  OverviewSummary,
  OverviewToolCallGroup,
} from "@/tool-calls/detail-level/overview/model";
import { OverviewToolCallGroupSheet } from "@/tool-calls/detail-level/overview/sheet";
import { formatOverviewSummary } from "@/tool-calls/detail-level/overview/summary";

const TOOL_CALL_GROUP_MAX_HEIGHT = 400;
const GROUP_SCROLL_STYLE = { maxHeight: TOOL_CALL_GROUP_MAX_HEIGHT };

function useOverviewSummary(summary: OverviewSummary): string {
  const { t } = useTranslation();
  return useMemo(() => formatOverviewSummary(summary, t), [summary, t]);
}

function GroupScroll({ children }: { children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const content = contentRef.current;
    if (!scroll || !content) return;
    const toEnd = () => {
      scroll.scrollTop = scroll.scrollHeight;
    };
    toEnd();
    const observer = new ResizeObserver(toEnd);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={scrollRef} className="overflow-y-auto" style={GROUP_SCROLL_STYLE}>
      <div ref={contentRef} className="flex flex-col gap-1 px-1 pt-1">
        {children}
      </div>
    </div>
  );
}

export const OverviewToolCallGroupView = memo(function OverviewToolCallGroupView({
  group,
  expanded,
  isLastInSequence,
  onExpandedChange,
  children,
}: {
  group: OverviewToolCallGroup;
  expanded: boolean;
  isLastInSequence: boolean;
  onExpandedChange: (groupId: string, expanded: boolean) => void;
  children: ReactNode;
}) {
  const isCompact = useIsCompactFormFactor();
  const aggregateSummary = useOverviewSummary(group.summary);
  const toggle = useCallback(
    () => onExpandedChange(group.run.id, !expanded),
    [expanded, group.run.id, onExpandedChange],
  );
  const close = useCallback(
    () => onExpandedChange(group.run.id, false),
    [group.run.id, onExpandedChange],
  );
  const renderDetails = useCallback(() => <GroupScroll>{children}</GroupScroll>, [children]);
  if (isCompact) {
    return (
      <>
        <ExpandableBadge
          testID="tool-call-group"
          label={aggregateSummary}
          icon={Wrench}
          isLoading={group.isLoading}
          isExpanded={false}
          isLastInSequence={isLastInSequence}
          onToggle={toggle}
        />
        <OverviewToolCallGroupSheet visible={expanded} summary={aggregateSummary} onClose={close}>
          {children}
        </OverviewToolCallGroupSheet>
      </>
    );
  }
  return (
    <ExpandableBadge
      testID="tool-call-group"
      label={aggregateSummary}
      icon={Wrench}
      isLoading={group.isLoading}
      isExpanded={expanded}
      isLastInSequence={isLastInSequence}
      onToggle={toggle}
      renderDetails={renderDetails}
    />
  );
});
