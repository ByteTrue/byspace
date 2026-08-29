import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { FileDiff } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { ChangesSurface } from "@/git/diff-pane";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";
import { useAddFileToChat } from "@/panels/use-add-file-to-chat";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";

const ThemedFileDiff = withUnistyles(FileDiff);

function WorkingDiffPanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, target, openFileInWorkspace } = usePaneContext();
  const cwd = useWorkspaceDirectory(serverId, workspaceId);
  const isActive = useRetainedPanelActive();
  const { addFile, canAddToChat } = useAddFileToChat({ serverId, workspaceId });
  invariant(target.kind === "working_diff", "WorkingDiffPanel requires working_diff target");

  const handleOpenFile = useCallback(
    (path: string) => openFileInWorkspace({ location: { path }, disposition: "side" }),
    [openFileInWorkspace],
  );

  if (!cwd) {
    return (
      <View style={styles.centerState}>
        <Text style={styles.mutedText}>{t("panels.diff.directoryMissing")}</Text>
      </View>
    );
  }
  return (
    <View style={styles.container} testID="working-diff-panel">
      <ChangesSurface
        serverId={serverId}
        workspaceId={workspaceId}
        cwd={cwd}
        enabled={isActive}
        host="panel"
        focusPath={target.focusPath}
        focusRequestId={target.focusRequestId}
        onOpenFile={handleOpenFile}
        onAddToChat={canAddToChat ? addFile : undefined}
      />
    </View>
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
  resourceKey: () => "working_diff",

  component: WorkingDiffPanel,
  useDescriptor: useWorkingDiffPanelDescriptor,
};

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[6],
  },
  mutedText: {
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
}));
