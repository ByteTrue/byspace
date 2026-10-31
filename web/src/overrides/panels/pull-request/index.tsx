// Override of packages/app/src/panels/pull-request/index.tsx: same hooks.
// shortcut: the pull request pane moves in batch 7 of step 3; PullRequestContent shows the notice.
import { usePrPaneData } from "@/git/pull-request-panel/use-data";
import type { UsePrPaneDataResult } from "@/git/pull-request-panel/use-data";
import { useCheckoutPrStatusQuery } from "@/git/use-pr-status-query";
import { getPullRequestIdentity } from "@/panels/pull-request/state";
import { PendingPanel } from "@/panels/pending-panel";

/**
 * Whether this workspace's branch has a pull request. Detection only offers the pull request as
 * something the user can open; it never opens a tab on its own.
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

export function PullRequestContent(_input: {
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
  prPane: UsePrPaneDataResult;
}) {
  return <PendingPanel title="Pull request" />;
}

export function usePullRequestData(input: {
  serverId: string;
  cwd: string;
  enabled?: boolean;
  timelineEnabled?: boolean;
}) {
  return usePrPaneData(input);
}
