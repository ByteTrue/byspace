// Override of packages/app/src/git/commits-section/commits-section.tsx: the collapsible "Commits"
// strip under the Changes view — the branch's commits ahead of its base, refreshed every 10s while
// open. The query and timing are the Expo file's; the view is DOM.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { CommitRow } from "@/git/commits-section/commit-row";
import { ThemedChevron, chevronColorMapping } from "@/git/themed-chevron";
import { useCheckoutCommitsQuery, type CheckoutCommitsQueryResult } from "@/git/use-commits-query";
import { normalizeBranchOptionName } from "@/utils/branch-suggestions";
import { cn } from "cn";

interface CommitsSectionProps {
  serverId: string;
  cwd: string;
  onCommitPress: (sha: string) => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

const SKELETON_BAR = "rounded-sm bg-muted";

function CommitsSectionSkeleton() {
  const { t } = useTranslation();
  return (
    <div
      aria-label={t("workspace.git.diff.commits.loading")}
      className="flex flex-col gap-2 pb-1"
      data-testid="commits-section-skeleton"
    >
      <div className="flex min-h-5 items-center gap-2 px-2 py-1">
        <span className="size-2 rounded-full bg-muted" />
        <span className={cn(SKELETON_BAR, "h-2.5 w-12")} />
        <span className={cn(SKELETON_BAR, "h-3 min-w-0 flex-1")} />
        <span className={cn(SKELETON_BAR, "h-2.5 w-10 shrink-0")} />
        <span className="size-4 shrink-0" />
      </div>
    </div>
  );
}

function CommitsSectionContent({
  query,
  now,
  onCommitPress,
}: {
  query: Exclude<CheckoutCommitsQueryResult, { status: "unsupported" }>;
  now: Date;
  onCommitPress: (sha: string) => void;
}) {
  const { t } = useTranslation();
  if (query.status === "error") {
    return (
      <p className="py-2 pr-3 pl-2 text-xs text-status-danger" data-testid="commits-section-error">
        {t("workspace.git.diff.commits.loadError")}
      </p>
    );
  }
  if (query.status !== "loaded") {
    return <CommitsSectionSkeleton />;
  }
  const workspaceCommits = query.data.commits.filter((commit) => !commit.isOnBase);
  const baseRef = normalizeBranchOptionName(query.data.baseRef) ?? t("workspace.git.diff.base");
  if (workspaceCommits.length === 0) {
    return (
      <div
        className="flex items-center pt-1 pr-3 pb-2 pl-2"
        data-testid="commits-section-no-workspace-commits"
      >
        <span className="text-xs text-muted-foreground">
          {t("workspace.git.diff.commits.noneAhead", { baseRef })}
        </span>
      </div>
    );
  }
  return (
    <div className="pb-1">
      {workspaceCommits.map((commit, index) => (
        <CommitRow
          key={commit.sha}
          commit={commit}
          isFirst={index === 0}
          isLast={index === workspaceCommits.length - 1}
          now={now}
          onCommitPress={onCommitPress}
        />
      ))}
    </div>
  );
}

export function CommitsSection({
  serverId,
  cwd,
  onCommitPress,
  collapsed = true,
  onCollapsedChange,
}: CommitsSectionProps) {
  const { t } = useTranslation();
  const isPanelActive = useRetainedPanelActive();
  const [now, setNow] = useState(() => new Date());
  const displayNow = useMemo(() => (isPanelActive ? new Date() : now), [isPanelActive, now]);
  const query = useCheckoutCommitsQuery({
    serverId,
    cwd,
    enabled: !collapsed,
  });

  const handleToggleSection = useCallback(() => {
    if (collapsed) {
      setNow(new Date());
    }
    onCollapsedChange?.(!collapsed);
  }, [collapsed, onCollapsedChange]);

  useEffect(() => {
    if (collapsed || !isPanelActive) {
      return;
    }
    const interval = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(interval);
  }, [collapsed, isPanelActive]);

  if (query.status === "unsupported") {
    return null;
  }
  const commitCount =
    query.status === "loaded"
      ? query.data.commits.filter((commit) => !commit.isOnBase).length
      : null;

  return (
    <div className="shrink-0 border-t pb-[env(safe-area-inset-bottom)]">
      <button
        type="button"
        data-testid="commits-section-header"
        aria-expanded={!collapsed}
        onClick={handleToggleSection}
        className="flex w-full shrink-0 items-center gap-2 py-2 pr-3 pl-2 text-left outline-none focus-visible:bg-accent"
      >
        <span
          className={cn(
            "flex size-4 shrink-0 items-center justify-center",
            !collapsed && "rotate-90",
          )}
        >
          <ThemedChevron size={14} uniProps={chevronColorMapping} />
        </span>
        <span className="text-sm leading-[18px] text-foreground">
          {t("workspace.git.diff.commits.title")}
        </span>
        {commitCount === null ? (
          <span className="flex-1" />
        ) : (
          <span
            className="flex-1 text-xs leading-[18px] text-muted-foreground"
            aria-label={t("workspace.git.diff.commits.countLabel", { count: commitCount })}
          >
            {commitCount}
          </span>
        )}
      </button>
      {collapsed ? null : (
        <CommitsSectionContent query={query} now={displayNow} onCommitPress={onCommitPress} />
      )}
    </div>
  );
}
