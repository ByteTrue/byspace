import { useTranslation } from "react-i18next";
import { FileDiff } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { GitDiffPane } from "@/git/diff-pane";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";

const ThemedFileDiff = withUnistyles(FileDiff);

function WorkingDiffPanel() {
  const { serverId, workspaceId, target } = usePaneContext();
  const cwd = useWorkspaceDirectory(serverId, workspaceId);
  const isActive = useRetainedPanelActive();
  invariant(target.kind === "working_diff", "WorkingDiffPanel requires working_diff target");

  if (!cwd) {
    return null;
  }
  return (
    <GitDiffPane
      serverId={serverId}
      workspaceId={workspaceId}
      cwd={cwd}
      enabled={isActive}
      asWorkspaceTab
      focusPath={target.focusPath}
      focusRequestId={target.focusRequestId}
    />
  );
}

function useWorkingDiffPanelDescriptor(): PanelDescriptor {
  const { t } = useTranslation();
  return {
    label: t("panels.diff.changesLabel"),
    subtitle: t("panels.diff.changesSubtitle"),
    titleState: "ready",
    icon: ThemedFileDiff,
    statusBucket: null,
  };
}

export const workingDiffPanelRegistration: PanelRegistration<"working_diff"> = {
  kind: "working_diff",
  component: WorkingDiffPanel,
  useDescriptor: useWorkingDiffPanelDescriptor,
};
