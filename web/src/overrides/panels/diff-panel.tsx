// Override of packages/app/src/panels/diff-panel.tsx: same presentations and commit descriptor.
// shortcut: the diff surfaces move in batch 6 of step 3.
import { FileDiff, GitCommitHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { definePanel, type PanelDescriptor, type PanelPresentation } from "@/panels/panel-registry";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { PendingPanel } from "@/panels/pending-panel";

const workingDiffPresentation = {
  label: (t) => t("panels.diff.diffLabel"),
  subtitle: (t) => t("panels.diff.changesSubtitle"),
  tooltip: (t) => t("panels.diff.changesSubtitle"),
  icon: FileDiff,
} satisfies PanelPresentation;

const changesTreePresentation = {
  label: (t) => t("panels.diff.changesLabel"),
  subtitle: (t) => t("panels.diff.changesSubtitle"),
  tooltip: (t) => t("panels.diff.changesSubtitle"),
  icon: FileDiff,
} satisfies PanelPresentation;

function useCommitDiffPanelDescriptor(
  target: Extract<WorkspaceTabTarget, { kind: "commit_diff" }>,
): PanelDescriptor {
  const { t } = useTranslation();
  return {
    label: target.sha.slice(0, 7),
    subtitle: t("panels.diff.commitSubtitle"),
    tooltip: target.sha,
    titleState: "ready",
    icon: GitCommitHorizontal,
    statusBucket: null,
  };
}

function ChangesPanel() {
  const { t } = useTranslation();
  return <PendingPanel title={t("panels.diff.changesLabel")} />;
}

function CommitDiffPanel() {
  const { t } = useTranslation();
  return <PendingPanel title={t("panels.diff.commitSubtitle")} />;
}

export const workingDiffPanelRegistration = definePanel("working_diff", {
  component: ChangesPanel,
  presentation: workingDiffPresentation,
});
export const changesTreePanelRegistration = definePanel("changes_tree", {
  component: ChangesPanel,
  presentation: changesTreePresentation,
});
export const commitDiffPanelRegistration = definePanel("commit_diff", {
  component: CommitDiffPanel,
  useDescriptor: useCommitDiffPanelDescriptor,
});
