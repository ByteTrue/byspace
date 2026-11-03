// Port of archive/expo-app:packages/app/src/panels/pull-request-panel.tsx: same presentation and descriptor.
import { GitPullRequest } from "lucide-react";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { formatPrTabLabel } from "@/git/pull-request-panel/tab-label";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import { PullRequestContent, usePullRequestData } from "@/panels/pull-request";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";

function CenteredMessage({ children }: { children: string }) {
  return <div className="flex flex-1 items-center justify-center p-4 text-sm">{children}</div>;
}

const pullRequestPanelPresentation = {
  label: (t) => t("panels.pullRequest.label"),
  subtitle: (t) => t("panels.pullRequest.subtitle"),
  tooltip: (t) => t("panels.pullRequest.label"),
  icon: GitPullRequest,
} satisfies PanelPresentation;

function usePullRequestPanelDescriptor(
  _target: { kind: "pull_request" },
  context: { serverId: string; workspaceId: string },
) {
  const { t } = useTranslation();
  const cwd = useWorkspaceDirectory(context.serverId, context.workspaceId) ?? "";
  const prPane = usePullRequestData({ serverId: context.serverId, cwd, timelineEnabled: false });
  const label =
    prPane.prNumber === null
      ? pullRequestPanelPresentation.label(t)
      : formatPrTabLabel(prPane.prNumber);
  return {
    label,
    subtitle: pullRequestPanelPresentation.subtitle(t),
    tooltip: label,
    titleState: prPane.isLoading ? ("loading" as const) : ("ready" as const),
    icon: pullRequestPanelPresentation.icon,
    statusBucket: null,
  };
}

function PullRequestPanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, target } = usePaneContext();
  const cwd = useWorkspaceDirectory(serverId, workspaceId) ?? "";
  invariant(target.kind === "pull_request", "PullRequestPanel requires pull_request target");
  const prPane = usePullRequestData({ serverId, cwd });
  if (!cwd) return <CenteredMessage>{t("panels.file.directoryMissing")}</CenteredMessage>;
  return (
    <PullRequestContent serverId={serverId} workspaceId={workspaceId} cwd={cwd} prPane={prPane} />
  );
}

export const pullRequestPanelRegistration = definePanel("pull_request", {
  component: PullRequestPanel,
  presentation: pullRequestPanelPresentation,
  useDescriptor: usePullRequestPanelDescriptor,
});
