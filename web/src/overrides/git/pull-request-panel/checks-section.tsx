// Override of packages/app/src/git/pull-request-panel/checks-section.tsx: the PR pane's CI block —
// the summary line with its ring, then the checks grouped by status. Grouping, identity and the
// "Add to chat" gate are the Expo file's; the view is DOM.
import {
  useCallback,
  useMemo,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { ChevronDown, ChevronRight, MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { classifyCheck, type CheckPresentation } from "@/git/check-presentation";
import { CheckPresentationIcon } from "@/git/check-presentation.view";
import { useCheckGroupState } from "@/git/pull-request-panel/check-group-state";
import { ChecksRing } from "@/git/pull-request-panel/checks-ring";
import { summarizeChecks, type ChecksGroup } from "@/git/pull-request-panel/checks-summary";
import { canAddPullRequestCheckLogsToChat } from "@/git/pull-request-panel/context-attachment";
import type { PrPaneCheck } from "@/git/pull-request-panel/data";
import { sectionKitClassNames } from "@/git/pull-request-panel/section-kit";
import { ICON_SIZE } from "@/styles/theme";
import { openExternalUrl } from "@/utils/open-external-url";
import { cn } from "cn";

/**
 * Roughly eight rows. A repo with thirty checks would otherwise push the activity
 * timeline off the pane entirely, so past this height the list scrolls in place.
 */
const LIST_STYLE: CSSProperties = { maxHeight: 268 };

/**
 * The three statuses the pane has always labelled for tests. Skipped has no id because
 * nothing asserts on it.
 */
const PART_TEST_ID: Partial<Record<CheckPresentation, string>> = {
  actionRequired: "pr-pane-check-action-required",
  warning: "pr-pane-check-warning",
  success: "pr-pane-check-passed",
  failure: "pr-pane-check-failed",
  pending: "pr-pane-check-pending",
  manual: "pr-pane-check-manual",
};

/**
 * Identifies a check across refreshes. The forge's run id is stable where a forge exposes
 * one; the name/url pair is the fallback for forges that don't.
 */
export function getCheckIdentity(check: PrPaneCheck): string {
  if (check.detailRef?.checkRunId !== undefined) {
    return `${check.provider}:check-run:${check.detailRef.checkRunId}`;
  }
  if (check.detailRef?.workflowRunId !== undefined) {
    return `${check.provider}:workflow-run:${check.detailRef.workflowRunId}`;
  }
  return `${check.provider}:${check.name}:${check.url}`;
}

interface ChecksSectionProps {
  checks: readonly PrPaneCheck[];
  open: boolean;
  onToggle: () => void;
  attachEnabled: boolean;
  loadingCheckKeys: ReadonlySet<string>;
  onAddLogsToChat: (check: PrPaneCheck) => void;
}

/**
 * The CI surface of the PR pane: one line saying how the run went, and the checks behind
 * it grouped by status so a failure never needs scrolling to find.
 */
export function ChecksSection({
  checks,
  open,
  onToggle,
  attachEnabled,
  loadingCheckKeys,
  onAddLogsToChat,
}: ChecksSectionProps) {
  const summary = useMemo(() => summarizeChecks(checks), [checks]);
  const { collapsedGroups, toggle: handleToggleGroup } = useCheckGroupState();
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div data-testid="pr-pane-checks">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={summary.detail ? `${summary.headline}. ${summary.detail}` : summary.headline}
        className="flex w-full items-center gap-2 p-3 text-left hover:bg-sidebar-accent"
      >
        <ChecksRing summary={summary} size={ICON_SIZE.lg} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm leading-[18px] font-medium text-foreground">
            {summary.headline}
          </span>
          {summary.parts.length > 0 ? (
            <span
              className="truncate text-xs text-muted-foreground"
              data-testid="pr-pane-check-summary"
            >
              {summary.parts.map((part, index) => (
                <span key={part.status}>
                  {index > 0 ? ", " : ""}
                  <span data-testid={PART_TEST_ID[part.status]}>{part.text}</span>
                </span>
              ))}
              {` ${summary.countNoun}`}
            </span>
          ) : null}
        </span>
        <Chevron size={ICON_SIZE.sm} className="shrink-0 text-muted-foreground" />
      </button>

      {open && summary.groups.length > 0 ? (
        <div className="overflow-y-auto pb-2" style={LIST_STYLE}>
          {summary.groups.map((group) => (
            <CheckGroup
              key={group.status}
              group={group}
              collapsed={collapsedGroups.has(group.status)}
              onToggle={handleToggleGroup}
              attachEnabled={attachEnabled}
              loadingCheckKeys={loadingCheckKeys}
              onAddLogsToChat={onAddLogsToChat}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CheckGroup({
  group,
  collapsed,
  onToggle,
  attachEnabled,
  loadingCheckKeys,
  onAddLogsToChat,
}: {
  group: ChecksGroup;
  collapsed: boolean;
  onToggle: (status: CheckPresentation) => void;
  attachEnabled: boolean;
  loadingCheckKeys: ReadonlySet<string>;
  onAddLogsToChat: (check: PrPaneCheck) => void;
}) {
  const handlePress = useCallback(() => onToggle(group.status), [group.status, onToggle]);
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <div data-testid={`pr-pane-check-group-${group.status}`}>
      <button
        type="button"
        onClick={handlePress}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-1 px-3 pt-2 pb-1 text-left"
      >
        <span className="text-xs font-medium text-muted-foreground">{group.label}</span>
        <Chevron size={ICON_SIZE.xs} className="shrink-0 text-muted-foreground" />
      </button>
      {collapsed
        ? null
        : group.checks.map((check) => {
            const checkKey = getCheckIdentity(check);
            return (
              <CheckRow
                key={checkKey}
                check={check}
                attachEnabled={attachEnabled}
                isAddingLogsToChat={loadingCheckKeys.has(checkKey)}
                onAddLogsToChat={onAddLogsToChat}
              />
            );
          })}
    </div>
  );
}

function CheckRow({
  check,
  attachEnabled,
  isAddingLogsToChat,
  onAddLogsToChat,
}: {
  check: PrPaneCheck;
  attachEnabled: boolean;
  isAddingLogsToChat: boolean;
  onAddLogsToChat: (check: PrPaneCheck) => void;
}) {
  const open = useCallback(() => {
    void openExternalUrl(check.url);
  }, [check.url]);
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open();
    },
    [open],
  );
  const handleAddLogsToChat = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      // The row opens the check; its button only adds the logs.
      event.stopPropagation();
      onAddLogsToChat(check);
    },
    [check, onAddLogsToChat],
  );
  return (
    // The row holds a button, so it is a focusable div rather than a button itself.
    <div
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={handleKeyDown}
      data-testid="pr-pane-check-row"
      className={cn(sectionKitClassNames.checkRow, "cursor-pointer hover:bg-sidebar-accent")}
    >
      <CheckPresentationIcon presentation={classifyCheck(check)} size={14} />
      <span className={sectionKitClassNames.checkName}>{check.name}</span>
      {check.workflow ? (
        <span className={sectionKitClassNames.checkWorkflow}>{check.workflow}</span>
      ) : null}
      <span className={sectionKitClassNames.checkTrailing}>
        {attachEnabled && canAddPullRequestCheckLogsToChat(check) ? (
          <Button
            variant="ghost"
            size="xs"
            leftIcon={MessageSquarePlus}
            loading={isAddingLogsToChat}
            onClick={handleAddLogsToChat}
            className="px-1"
          >
            {isAddingLogsToChat ? "Adding..." : "Add to chat"}
          </Button>
        ) : null}
        {check.timing ? (
          <span className={sectionKitClassNames.checkDuration}>{check.timing}</span>
        ) : null}
      </span>
    </div>
  );
}
