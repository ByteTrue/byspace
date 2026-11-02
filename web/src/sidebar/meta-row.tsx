import { Fragment, useCallback, useMemo, type MouseEvent, type ReactNode } from "react";
import {
  ExternalLink,
  Folder,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  Globe,
  Server,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  workspaceLabelKey,
  type WorkspaceLabelDefinition,
} from "@bytetrue/protocol/workspace-labels";
import { useSidebarMetaPreferences } from "@/components/sidebar/display-preferences/model";
import {
  toFilledQuarters,
  type CheckSummary,
} from "@/components/sidebar/workspace-meta-row/check-summary";
import {
  selectMetaRowItems,
  type MetaRowItem,
} from "@/components/sidebar/workspace-meta-row/meta-items";
import {
  workspaceServiceLabelKey,
  type WorkspaceServiceSummary,
} from "@/components/sidebar/workspace-meta-row/service-summary";
import { getForgePresentation, normalizeForge } from "@/git/forge";
import { DiffStat } from "@/components/diff-stat";
import type { PrHint } from "@/git/pr-hint";
import type { HostBadgeModel } from "@/hosts/appearance";
import { useCompactTimeAgo } from "@/hooks/use-compact-time-ago";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarWorkspaceTrailing } from "@/hooks/use-settings";
import { identityForeground, identityTint } from "@/styles/identity-colors";
import { openExternalUrl } from "@/utils/open-external-url";
import { cn } from "cn";
import { useResolvedColorScheme } from "~/app/color-scheme";

const PR_STATE_ICON = {
  open: GitPullRequest,
  merged: GitMerge,
  closed: GitPullRequestClosed,
} as const;
const PR_STATE_CLASS = {
  open: "text-status-success",
  merged: "text-status-merged",
  closed: "text-status-danger",
} as const;
const PR_STATE_LABEL_KEYS = {
  merged: "workspace.git.pr.states.merged",
  closed: "workspace.git.pr.states.closed",
} as const;
const CHECK_STATE_LABEL_KEYS = {
  passed: "workspace.git.pr.checksSummary.passedLabel",
  failed: "workspace.git.pr.checksSummary.failedLabel",
  running: "workspace.git.pr.checksSummary.runningLabel",
} as const;
const CHECK_STATE_ACCESSIBLE_KEYS = {
  passed: "workspace.git.pr.checksSummary.passedAccessible",
  failed: "workspace.git.pr.checksSummary.failedAccessible",
  running: "workspace.git.pr.checksSummary.runningAccessible",
} as const;
const CHECK_STATE_CLASS = {
  passed: "text-status-success",
  failed: "text-status-danger",
  running: "text-status-warning",
} as const;

export function PullRequestStateIcon({
  state,
  className,
}: {
  state: PrHint["state"];
  className?: string;
}) {
  const Icon = PR_STATE_ICON[state];
  return <Icon className={cn("size-3 shrink-0", PR_STATE_CLASS[state], className)} />;
}

/** packages/app's CheckIndicator: a ring with a tick, a cross, or a pie of finished checks. */
export function CheckIndicator({
  summary,
  className,
}: {
  summary: CheckSummary;
  className?: string;
}) {
  const fraction = summary.state === "running" ? toFilledQuarters(summary) : 0;
  let pie: ReactNode = null;
  if (summary.state === "running" && fraction > 0) {
    if (fraction >= 1) {
      pie = <circle cx="12" cy="12" r="7" fill="currentColor" />;
    } else {
      const angle = fraction * 2 * Math.PI;
      const endX = 12 + 7 * Math.sin(angle);
      const endY = 12 - 7 * Math.cos(angle);
      pie = (
        <path
          d={`M 12 12 L 12 5 A 7 7 0 ${fraction > 0.5 ? 1 : 0} 1 ${endX} ${endY} Z`}
          fill="currentColor"
        />
      );
    }
  }
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-3 shrink-0", CHECK_STATE_CLASS[summary.state], className)}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="11" stroke="currentColor" strokeWidth="2" fill="none" />
      {summary.state === "running" ? (
        pie
      ) : (
        <path
          d={
            summary.state === "passed"
              ? "M8 12.5 L11 15.5 L16.5 9"
              : "M8.5 8.5 L15.5 15.5 M15.5 8.5 L8.5 15.5"
          }
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      )}
    </svg>
  );
}

export function HostBadge({ badge }: { badge: HostBadgeModel }) {
  const scheme = useResolvedColorScheme();
  const colorStyle = useMemo(
    () => (badge.color === "none" ? undefined : { color: identityForeground(badge.color, scheme) }),
    [badge.color, scheme],
  );
  return (
    <span
      className="flex min-w-0 shrink items-center gap-[3px]"
      data-testid={`host-badge-${badge.serverId}`}
      aria-label={badge.label}
    >
      <Server className="size-3 shrink-0 text-muted-foreground" style={colorStyle} />
      {badge.showLabel ? (
        <span className="truncate" style={colorStyle}>
          {badge.label}
        </span>
      ) : null}
    </span>
  );
}

export function WorkspaceLabelChip({ label }: { label: WorkspaceLabelDefinition }) {
  const scheme = useResolvedColorScheme();
  const style = useMemo(
    () => ({
      backgroundColor: identityTint(label.color),
      color: identityForeground(label.color, scheme),
    }),
    [label.color, scheme],
  );
  return (
    <span
      className="min-w-0 shrink truncate rounded-sm px-1"
      style={style}
      data-testid={`workspace-label-chip-${label.name}`}
    >
      {label.name}
    </span>
  );
}

function stopRowPress(event: MouseEvent) {
  event.stopPropagation();
  event.preventDefault();
}

function PullRequestItem({ hint }: { hint: PrHint }) {
  const { t } = useTranslation();
  const presentation = getForgePresentation(normalizeForge(hint.forge));
  const open = useCallback(
    (event: MouseEvent) => {
      stopRowPress(event);
      void openExternalUrl(hint.url);
    },
    [hint.url],
  );
  return (
    <button
      type="button"
      aria-label={t("workspace.git.pr.accessibility.pullRequest", {
        number: hint.number,
        context: presentation.changeRequestContext,
      })}
      className="group/pr flex shrink-0 items-center gap-[3px] hover:text-foreground"
      onClick={open}
      onPointerDown={stopRowPress}
    >
      <PullRequestStateIcon state={hint.state} className="group-hover/pr:hidden" />
      <ExternalLink className="hidden size-3 shrink-0 group-hover/pr:block" />
      <span className="truncate">
        {hint.number}
        {hint.state === "open" ? "" : ` ${t(PR_STATE_LABEL_KEYS[hint.state])}`}
      </span>
    </button>
  );
}

function ChecksItem({ summary, label }: { summary: CheckSummary; label: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className="flex shrink-0 items-center gap-[3px]"
      aria-label={t(CHECK_STATE_ACCESSIBLE_KEYS[summary.state])}
      data-testid={`sidebar-workspace-checks-${summary.state}`}
    >
      <CheckIndicator summary={summary} />
      {label ? (
        <span className={CHECK_STATE_CLASS[summary.state]}>
          {t(CHECK_STATE_LABEL_KEYS[summary.state])}
        </span>
      ) : null}
    </span>
  );
}

function ServiceItem({ summary }: { summary: WorkspaceServiceSummary }) {
  const { t } = useTranslation();
  const unhealthy = summary.health === "unhealthy";
  return (
    <span
      className="flex min-w-0 shrink items-center gap-[3px]"
      aria-label={t(workspaceServiceLabelKey(summary), { name: summary.name })}
      data-testid={unhealthy ? "workspace-service-unhealthy" : "workspace-service"}
    >
      <Globe
        className={cn("size-3 shrink-0", unhealthy ? "text-status-danger" : "text-status-success")}
      />
      <span className={cn("truncate", unhealthy && "text-status-danger")}>{summary.name}</span>
    </span>
  );
}

function MetaItem({
  item,
  hostBadge,
}: {
  item: MetaRowItem;
  hostBadge: HostBadgeModel | null;
}): ReactNode {
  switch (item.kind) {
    case "branch":
    case "project": {
      const Icon = item.kind === "branch" ? GitBranch : Folder;
      return (
        <span
          className="flex min-w-0 shrink items-center gap-[3px]"
          data-testid={`sidebar-workspace-${item.kind}`}
        >
          <Icon className="size-3 shrink-0" />
          <span className="truncate">{item.name}</span>
          {item.kind === "project" && item.cue ? (
            <>
              <span aria-hidden="true" className="text-extra-muted-foreground">
                ·
              </span>
              <span
                className="truncate text-extra-muted-foreground"
                data-testid="sidebar-workspace-project-cue"
              >
                {item.cue}
              </span>
            </>
          ) : null}
        </span>
      );
    }
    case "host":
      return hostBadge ? <HostBadge badge={hostBadge} /> : null;
    case "changeRequest":
      return <PullRequestItem hint={item.hint} />;
    case "checks":
      return <ChecksItem summary={item.summary} label={item.label} />;
    case "labels":
      return (
        <span className="flex min-w-0 shrink items-center gap-1">
          {item.labels.map((label) => (
            <WorkspaceLabelChip key={workspaceLabelKey(label.name)} label={label} />
          ))}
        </span>
      );
    case "services":
      return <ServiceItem summary={item.summary} />;
  }
}

const EMPTY_LABELS: readonly WorkspaceLabelDefinition[] = [];

/** The line under a workspace title: branch, project, host, change request, checks, labels, service. */
export function WorkspaceMetaRow({
  currentBranch,
  projectName,
  projectNameCue = null,
  hostBadge,
  prHint,
  serviceSummary,
  labels = EMPTY_LABELS,
}: {
  currentBranch: string | null;
  projectName: string | null;
  projectNameCue?: string | null;
  hostBadge: HostBadgeModel | null;
  prHint: PrHint | null;
  serviceSummary: WorkspaceServiceSummary | null;
  labels?: readonly WorkspaceLabelDefinition[];
}) {
  const { rowItems, checksDisplay } = useSidebarMetaPreferences();
  const items = selectMetaRowItems({
    currentBranch,
    projectName,
    projectNameCue,
    hasHostBadge: hostBadge !== null,
    prHint,
    serviceSummary,
    labels,
    visible: rowItems,
    checksDisplay,
  });
  if (items.length === 0) return null;
  return (
    // packages/app's meta row: 6px between items and the dots, 3px inside an item.
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      {items.map((item, index) => (
        <Fragment key={item.kind}>
          {index > 0 ? (
            <span aria-hidden="true" className="text-extra-muted-foreground">
              ·
            </span>
          ) : null}
          <MetaItem item={item} hostBadge={hostBadge} />
        </Fragment>
      ))}
    </span>
  );
}

// packages/app's DiffStat, which the sidebar and the hover card share with the Changes pane.
export { DiffStat };

function WorkspaceTimestamp({ enteredAt }: { enteredAt: Date }) {
  const label = useCompactTimeAgo(enteredAt);
  return (
    <span
      className="h-5 shrink-0 text-xs leading-5 text-extra-muted-foreground"
      data-testid="sidebar-workspace-timestamp"
    >
      {label}
    </span>
  );
}

/** What a workspace row shows on its right edge: the diff, or how long it has been in its state. */
export function WorkspaceTrailingContent({
  workspace,
  trailing,
}: {
  workspace: SidebarWorkspaceEntry;
  trailing: SidebarWorkspaceTrailing;
}) {
  if (trailing === "diff" && workspace.diffStat) {
    return (
      <DiffStat additions={workspace.diffStat.additions} deletions={workspace.diffStat.deletions} />
    );
  }
  if (trailing === "timestamp" && workspace.statusEnteredAt) {
    return <WorkspaceTimestamp enteredAt={workspace.statusEnteredAt} />;
  }
  return null;
}
