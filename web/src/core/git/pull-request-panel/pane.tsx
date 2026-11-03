// Port of archive/expo-app:packages/app/src/git/pull-request-panel/pane.tsx. The pane's logic is the Expo
// file's; the view is DOM, and the activity cards are web/src/pull-request/activity-cards.tsx.
// Converted from the Expo file by archive/expo-app:web/scripts/port/pull-request-pane.py; edit it directly.
import { useCallback, useMemo, useState } from "react";
import {
  ExternalLink,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MessageSquare,
  MessageSquarePlus,
  RotateCw,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { openExternalUrl } from "@/utils/open-external-url";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceAttachmentsStore } from "@/attachments/workspace-attachments-store";
import { useToast } from "@/contexts/toast-context";
import { useCheckoutGitActionsStore } from "@/git/actions-store";
import { useIsCompactFormFactor } from "@/constants/layout";
import { PaneContentToolbar, ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { getForgePresentation } from "@/git/forge";
import { CLIENT_FORGE_VIEW_MODULES } from "@/git/forges/view";
import type { PaneNativeContribution } from "@/git/client-forge-module";
import { PrActivitySkeleton } from "@/git/pull-request-panel/activity-skeleton";
import {
  collapseActivity,
  expandActivity,
  getActivityState,
  getCollapsedEntryIds,
  getVisibleEntries,
} from "@/git/pull-request-panel/activity-state";
import {
  buildPullRequestCommentContextAttachment,
  buildPullRequestCheckContextAttachment,
  buildPullRequestReviewContextAttachment,
  buildPullRequestThreadContextAttachment,
  canAddPullRequestActivityToChat,
} from "@/git/pull-request-panel/context-attachment";
import { ChecksSection, getCheckIdentity } from "@/git/pull-request-panel/checks-section";
import { getStateLabel } from "@/git/pull-request-panel/data";
import type {
  PrPaneActivity,
  PrPaneCheck,
  PrPaneData,
  PrState,
} from "@/git/pull-request-panel/data";
import type { ForgeSpecificStatusFacts } from "@/git/merge-capability";
import { CheckPresentationIcon } from "@/git/check-presentation.view";
import { buildPrTimeline, type PrThreadEntry } from "@/git/pull-request-panel/timeline";
import { Section, SummaryPill, sectionKitClassNames } from "@/git/pull-request-panel/section-kit";
import { TimelineEntryCard } from "~/pull-request/activity-cards";
import { cn } from "cn";

const CLIENT_PANE_CONTRIBUTIONS: readonly PaneNativeContribution[] =
  CLIENT_FORGE_VIEW_MODULES.flatMap((module) => module.paneContributions ?? []);

function resolvePaneContribution(
  facts: ForgeSpecificStatusFacts | undefined,
): PaneNativeContribution | null {
  if (!facts) {
    return null;
  }
  return CLIENT_PANE_CONTRIBUTIONS.find((contribution) => contribution.guard(facts)) ?? null;
}

const PR_STATE_PRESENTATION: Record<PrState, { Icon: LucideIcon; className: string }> = {
  open: { Icon: GitPullRequest, className: "text-status-success" },
  draft: { Icon: GitPullRequestDraft, className: "text-muted-foreground" },
  merged: { Icon: GitMerge, className: "text-status-merged" },
  closed: { Icon: GitPullRequestClosed, className: "text-status-danger" },
};

const SUMMARY_COMMENT_ICON = <MessageSquare size={11} className="text-muted-foreground" />;
const SUMMARY_APPROVAL_ICON = <CheckPresentationIcon presentation="success" size={12} />;
const SUMMARY_CHANGES_REQUESTED_ICON = <CheckPresentationIcon presentation="failure" size={12} />;

function addLoadingCheck(current: ReadonlySet<string>, checkKey: string): ReadonlySet<string> {
  if (current.has(checkKey)) {
    return current;
  }
  const next = new Set(current);
  next.add(checkKey);
  return next;
}

function removeLoadingCheck(current: ReadonlySet<string>, checkKey: string): ReadonlySet<string> {
  if (!current.has(checkKey)) {
    return current;
  }
  const next = new Set(current);
  next.delete(checkKey);
  return next;
}

export function PullRequestPane({
  serverId,
  cwd,
  data,
  activityLoading,
  workspaceAttachmentScopeKey,
}: {
  serverId: string;
  cwd: string;
  data: PrPaneData;
  activityLoading: boolean;
  workspaceAttachmentScopeKey?: string;
}) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const toast = useToast();
  const daemonClient = useHostRuntimeClient(serverId);
  // COMPAT(githubCheckDetailsRpc): recognize the legacy capability on daemons
  // predating checkout.forge.get_check_details.*. Remove after 2027-01-17 once
  // the supported daemon floor is >= v0.2.0.
  const canFetchGitHubCheckDetails = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.githubCheckDetails === true,
  );
  const canFetchForgeCheckDetails = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.forgeCheckDetails === true,
  );
  const forgeProvidersEnabled = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.forgeProviders === true,
  );
  const addWorkspaceAttachment = useWorkspaceAttachmentsStore(
    (state) => state.addWorkspaceAttachment,
  );
  const [checksOpen, setChecksOpen] = useState(true);
  const [activityOpen, setActivityOpen] = useState(true);
  const [activityState, setActivityState] = useState(getActivityState);
  const [loadingCheckKeys, setLoadingCheckKeys] = useState<ReadonlySet<string>>(() => new Set());

  const handleOpenPrUrl = useCallback(() => {
    void openExternalUrl(data.url);
  }, [data.url]);

  const refreshSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.checkoutRefresh === true,
  );
  const runRefresh = useCheckoutGitActionsStore((state) => state.refresh);
  const isRefreshing =
    useCheckoutGitActionsStore((state) =>
      state.getStatus({ serverId, cwd, actionId: "refresh" }),
    ) === "pending";

  const handleRefresh = useCallback(() => {
    if (isRefreshing) {
      return;
    }
    void runRefresh({ serverId, cwd }).catch((error) => {
      toast.error(error instanceof Error ? error.message : t("workspace.git.diff.failedRefresh"));
    });
  }, [cwd, isRefreshing, runRefresh, serverId, t, toast]);

  const handleToggleChecks = useCallback(() => {
    setChecksOpen((open) => !open);
  }, []);

  const handleToggleActivity = useCallback(() => {
    setActivityOpen((open) => !open);
  }, []);

  const approvals = data.activity.filter(
    (item) => item.kind === "review" && item.reviewState === "approved",
  ).length;
  const changesRequested = data.activity.filter(
    (item) => item.kind === "review" && item.reviewState === "changes_requested",
  ).length;
  const commentCount = data.activity.filter(
    (item) =>
      item.kind === "comment" || (item.kind === "review" && item.reviewState === "commented"),
  ).length;

  const timelineEntries = useMemo(() => buildPrTimeline(data.activity), [data.activity]);
  const visibleEntries = useMemo(
    () =>
      getVisibleEntries(activityState, {
        prNumber: data.number,
        entries: timelineEntries,
      }),
    [activityState, data.number, timelineEntries],
  );
  const collapsedEntryIds = useMemo(
    () => getCollapsedEntryIds(activityState, { prNumber: data.number, entries: timelineEntries }),
    [activityState, data.number, timelineEntries],
  );
  const attachEnabled = workspaceAttachmentScopeKey !== undefined;

  const handleAddActivityToChat = useCallback(
    (activity: PrPaneActivity) => {
      if (!workspaceAttachmentScopeKey || !canAddPullRequestActivityToChat(activity)) {
        return;
      }
      const input = {
        provider: data.provider,
        forge: data.forge,
        pullRequest: { number: data.number, title: data.title, url: data.url },
        activity,
      };
      const attachment =
        activity.kind === "comment"
          ? buildPullRequestCommentContextAttachment(input)
          : buildPullRequestReviewContextAttachment(input);
      if (!attachment) {
        return;
      }
      addWorkspaceAttachment({
        scopeKey: workspaceAttachmentScopeKey,
        attachment,
      });
    },
    [
      addWorkspaceAttachment,
      data.forge,
      data.number,
      data.provider,
      data.title,
      data.url,
      workspaceAttachmentScopeKey,
    ],
  );

  const handleAddThreadToChat = useCallback(
    (thread: PrThreadEntry) => {
      if (!workspaceAttachmentScopeKey) {
        return;
      }
      const attachment = buildPullRequestThreadContextAttachment({
        provider: data.provider,
        forge: data.forge,
        pullRequest: { number: data.number, title: data.title, url: data.url },
        thread,
      });
      if (!attachment) {
        return;
      }
      addWorkspaceAttachment({
        scopeKey: workspaceAttachmentScopeKey,
        attachment,
      });
    },
    [
      addWorkspaceAttachment,
      data.forge,
      data.number,
      data.provider,
      data.title,
      data.url,
      workspaceAttachmentScopeKey,
    ],
  );

  const handleAddAllToChat = useCallback(() => {
    for (const { entry } of visibleEntries) {
      if (entry.kind === "single") {
        handleAddActivityToChat(entry.activity);
        continue;
      }
      if (entry.kind === "review") {
        handleAddActivityToChat(entry.review);
      }
      const threads = entry.kind === "thread" ? [entry] : entry.threads;
      for (const thread of threads) {
        if (thread.isResolved === true) {
          continue;
        }
        handleAddThreadToChat(thread);
      }
    }
  }, [handleAddActivityToChat, handleAddThreadToChat, visibleEntries]);

  const handleAddCheckLogsToChat = useCallback(
    async (check: PrPaneCheck) => {
      if (!workspaceAttachmentScopeKey) {
        return;
      }
      const checkKey = getCheckIdentity(check);
      setLoadingCheckKeys((current) => addLoadingCheck(current, checkKey));

      let details = null;
      try {
        const ref = check.detailRef;
        // The neutral forge RPC fetches detail for any forge; fall back to the
        // legacy github-only RPC only for GitHub against a daemon that predates
        // it. A non-GitHub forge therefore needs the neutral capability present.
        const canFetchDetail =
          canFetchForgeCheckDetails || (check.provider === "github" && canFetchGitHubCheckDetails);
        if (
          canFetchDetail &&
          daemonClient &&
          (ref?.checkRunId !== undefined || ref?.workflowRunId !== undefined) &&
          data.repoOwner &&
          data.repoName
        ) {
          try {
            const request = {
              cwd,
              repoOwner: data.repoOwner,
              repoName: data.repoName,
              checkRunId: ref.checkRunId,
              workflowRunId: ref.workflowRunId,
              changeRequestNumber: data.number,
            };
            // COMPAT(githubCheckDetailsRpc): use the legacy GitHub RPC with
            // daemons predating checkout.forge.get_check_details.*. Remove after
            // 2027-01-17 once the supported daemon floor is >= v0.2.0.
            const payload = canFetchForgeCheckDetails
              ? await daemonClient.checkoutForgeGetCheckDetails(request)
              : await daemonClient.checkoutGithubGetCheckDetails(request);
            details = payload.success ? payload.details : null;
          } catch {
            details = null;
          }
        }
        const attachment = buildPullRequestCheckContextAttachment({
          provider: data.provider,
          forge: data.forge,
          pullRequest: { number: data.number, title: data.title, url: data.url },
          check,
          githubDetails: details,
        });
        addWorkspaceAttachment({
          scopeKey: workspaceAttachmentScopeKey,
          attachment,
        });
      } catch {
        // The check row should recover even if attachment formatting or insertion fails.
      } finally {
        setLoadingCheckKeys((current) => removeLoadingCheck(current, checkKey));
      }
    },
    [
      addWorkspaceAttachment,
      canFetchForgeCheckDetails,
      canFetchGitHubCheckDetails,
      cwd,
      daemonClient,
      data.forge,
      data.number,
      data.provider,
      data.repoName,
      data.repoOwner,
      data.title,
      data.url,
      workspaceAttachmentScopeKey,
    ],
  );

  const handleToggleEntryCollapsed = useCallback(
    (entryId: string, collapsed: boolean) => {
      setActivityState((current) => {
        const identity = { prNumber: data.number, activityId: entryId };
        return collapsed ? expandActivity(current, identity) : collapseActivity(current, identity);
      });
    },
    [data.number],
  );

  const statePresentation = PR_STATE_PRESENTATION[data.state];
  const activitySummary = (
    <>
      <SummaryPill count={approvals} icon={SUMMARY_APPROVAL_ICON} variant="success" />
      <SummaryPill
        count={changesRequested}
        icon={SUMMARY_CHANGES_REQUESTED_ICON}
        variant="danger"
      />
      <SummaryPill count={commentCount} icon={SUMMARY_COMMENT_ICON} variant="muted" />
    </>
  );
  const StateIcon = statePresentation.Icon;
  const forgePresentation = getForgePresentation(data.forge);
  const repoIdentity =
    data.projectPath ??
    (data.repoOwner && data.repoName ? `${data.repoOwner}/${data.repoName}` : null);

  // Native forge surfaces (e.g. GitLab approvals/pipeline) come from a registry
  // keyed by the facts-family, so the central render has no per-forge branch.
  const nativeContribution = resolvePaneContribution(data.forgeSpecific);
  const nativeHeaderMeta = data.forgeSpecific
    ? nativeContribution?.renderHeaderMeta(data.forgeSpecific)
    : null;
  const nativeChecksSection = data.forgeSpecific
    ? nativeContribution?.renderChecksSection(data.forgeSpecific, {
        serverId,
        cwd,
        changeRequestNumber: data.number,
        open: checksOpen,
        onToggle: handleToggleChecks,
        enabled: forgeProvidersEnabled,
        canFetchCheckDetails: canFetchForgeCheckDetails,
      })
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-sidebar" data-testid="pr-pane">
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <PaneContentToolbar
          className="flex items-center justify-between px-3"
          testID="pr-pane-toolbar"
        >
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              onClick={handleOpenPrUrl}
              className="h-6 min-h-6 gap-1 rounded-md px-1 py-0"
              data-testid="pr-pane-view-pr"
            >
              <ExternalLink data-icon="inline-start" />
              {t("workspace.git.pr.actions.viewPullRequest")}
            </Button>
          </div>
          {refreshSupported ? (
            <ToolbarButton
              label={
                isRefreshing
                  ? t("workspace.git.diff.refreshing")
                  : t("workspace.git.diff.refreshState", { brand: forgePresentation.brandLabel })
              }
              compact={isCompact}
              disabled={isRefreshing}
              testID="pr-pane-refresh"
              onPress={handleRefresh}
            >
              {isRefreshing ? (
                <Spinner className="text-muted-foreground" />
              ) : (
                <RotateCw className="text-muted-foreground" />
              )}
            </ToolbarButton>
          ) : null}
        </PaneContentToolbar>

        <button
          type="button"
          onClick={handleOpenPrUrl}
          className="group/pr-header flex w-full flex-col gap-2 p-4 text-left"
        >
          <span className="text-sm leading-[22px] text-foreground" data-testid="pr-pane-title">
            {data.title}
            <span className="text-muted-foreground">
              {" "}
              {forgePresentation.numberPrefix}
              {data.number}
            </span>
          </span>
          <span className="flex min-h-4 w-full items-center gap-1">
            <StateIcon size={14} className={cn("shrink-0", statePresentation.className)} />
            <span
              className={cn("text-xs", statePresentation.className)}
              data-testid="pr-pane-state"
            >
              {getStateLabel(data.state)}
            </span>
            {nativeHeaderMeta}
            {repoIdentity ? (
              <span className="ml-1 min-w-0 shrink truncate text-xs text-muted-foreground">
                {repoIdentity}
              </span>
            ) : null}
            <ExternalLink
              size={12}
              className="ml-1 shrink-0 text-muted-foreground opacity-0 group-hover/pr-header:opacity-100"
            />
          </span>
        </button>

        {nativeChecksSection ?? (
          <ChecksSection
            checks={data.checks}
            open={checksOpen}
            onToggle={handleToggleChecks}
            attachEnabled={attachEnabled}
            loadingCheckKeys={loadingCheckKeys}
            onAddLogsToChat={handleAddCheckLogsToChat}
          />
        )}

        <div className="h-px bg-border" />

        <Section
          title="Activity"
          open={activityOpen}
          onToggle={handleToggleActivity}
          summary={activitySummary}
        >
          {timelineEntries.length > 0 && attachEnabled && visibleEntries.length > 0 ? (
            <div className="flex min-h-7 items-center pr-3 pb-2">
              <Button
                variant="ghost"
                size="xs"
                onClick={handleAddAllToChat}
                disabled={activityLoading}
              >
                <MessageSquarePlus data-icon="inline-start" />
                Add all to chat
              </Button>
            </div>
          ) : null}
          {activityLoading ? <PrActivitySkeleton /> : null}
          {!activityLoading && visibleEntries.length === 0 ? (
            <p className={sectionKitClassNames.emptyText}>No activity yet</p>
          ) : null}
          {!activityLoading
            ? visibleEntries.map(({ entry, collapsed }) => (
                <TimelineEntryCard
                  key={entry.id}
                  entry={entry}
                  collapsed={collapsed}
                  collapsedEntryIds={collapsedEntryIds}
                  attachEnabled={attachEnabled}
                  brandLabel={forgePresentation.brandLabel}
                  onAddToChat={handleAddActivityToChat}
                  onAddThreadToChat={handleAddThreadToChat}
                  onToggleCollapsed={handleToggleEntryCollapsed}
                />
              ))
            : null}
        </Section>
      </div>
    </div>
  );
}
