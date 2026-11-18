// Port of archive/expo-app:packages/app/src/panels/file-panel.tsx: same descriptor and pane, DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/file-pane.py; edit it directly.
import { useMemo } from "react";
import invariant from "tiny-invariant";
import { useTranslation } from "react-i18next";
import { FilePane } from "@/file-pane/pane";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel } from "@/panels/panel-registry";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import { createMaterialFileIcon } from "@/components/material-file-icon";

function useFilePanelDescriptor(target: { kind: "file"; path: string }) {
  const fileName = target.path.split("/").findLast(Boolean) ?? target.path;
  const icon = useMemo(() => createMaterialFileIcon(fileName), [fileName]);
  return {
    label: fileName,
    subtitle: target.path,
    tooltip: target.path,
    titleState: "ready" as const,
    icon,
    statusBucket: null,
  };
}

function FilePanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, target, fileNavigationRevision } = usePaneContext();
  const workspaceDirectory = useWorkspaceDirectory(serverId, workspaceId);
  invariant(target.kind === "file", "FilePanel requires file target");
  if (!workspaceDirectory) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <span>{t("panels.file.directoryMissing")}</span>
      </div>
    );
  }
  return (
    <FilePane
      serverId={serverId}
      workspaceRoot={workspaceDirectory}
      location={target}
      navigationRevision={fileNavigationRevision ?? 0}
    />
  );
}

export const filePanelRegistration = definePanel("file", {
  component: FilePanel,
  useDescriptor: useFilePanelDescriptor,
});
