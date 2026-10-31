// Override of packages/app/src/panels/pull-request/index.tsx: the same hooks and content states
// (pane, error with retry, skeleton, "no pull request"); the empty state is DOM.
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { buildWorkspaceAttachmentScopeKey } from "@/attachments/workspace-attachments-store";
import { useToast } from "@/contexts/toast-context";
import { useCheckoutGitActionsStore } from "@/git/actions-store";
import {
  PullRequestPane,
  PullRequestPaneError,
  PullRequestPaneSkeleton,
  usePrPaneData,
} from "@/git/pull-request-panel";
import type { UsePrPaneDataResult } from "@/git/pull-request-panel/use-data";
import { useCheckoutPrStatusQuery } from "@/git/use-pr-status-query";
import {
  getPullRequestIdentity,
  resolvePullRequestContentState,
} from "@/panels/pull-request/state";

/**
 * Whether this workspace's branch has a pull request. Detection only offers the
 * pull request as something the user can open; it never opens a tab on its own.
 */
export function useHasPullRequest(input: {
  serverId: string;
  cwd: string | null;
  enabled: boolean;
}): boolean {
  const status = useCheckoutPrStatusQuery({
    serverId: input.serverId,
    cwd: input.cwd || "",
    enabled: input.enabled,
  }).status;
  return getPullRequestIdentity(status) !== null;
}

export function PullRequestContent(input: {
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
  prPane: UsePrPaneDataResult;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const refresh = useCheckoutGitActionsStore((state) => state.refresh);
  const onRetry = useCallback(() => {
    void refresh({ serverId: input.serverId, cwd: input.cwd }).catch((error) => {
      toast.error(error instanceof Error ? error.message : t("workspace.git.diff.failedRefresh"));
    });
  }, [input.cwd, input.serverId, refresh, t, toast]);

  if (input.prPane.data) {
    return (
      <PullRequestPane
        serverId={input.serverId}
        cwd={input.cwd}
        data={input.prPane.data}
        activityLoading={input.prPane.activityLoading}
        workspaceAttachmentScopeKey={buildWorkspaceAttachmentScopeKey({
          serverId: input.serverId,
          workspaceId: input.workspaceId,
          cwd: input.cwd,
        })}
      />
    );
  }
  const contentState = resolvePullRequestContentState(input.prPane);
  if (contentState === "error") {
    return <PullRequestPaneError onRetry={onRetry} />;
  }
  if (contentState === "loading") {
    return <PullRequestPaneSkeleton />;
  }
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-2 p-6"
      data-testid="pull-request-empty-state"
    >
      <span className="text-sm text-foreground">{t("panels.pullRequest.emptyTitle")}</span>
      <span className="text-sm text-muted-foreground">
        {t("panels.pullRequest.emptyDescription")}
      </span>
    </div>
  );
}

export function usePullRequestData(input: {
  serverId: string;
  cwd: string;
  enabled?: boolean;
  timelineEnabled?: boolean;
}) {
  return usePrPaneData(input);
}
