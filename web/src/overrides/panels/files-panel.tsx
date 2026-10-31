// Override of packages/app/src/panels/files-panel.tsx: same panel, DOM view.
// Generated from the Expo file by web/scripts/port/file-explorer.py.
// After changing either file, rerun it and then npm run format:files; do not edit by hand.
import { Files } from "lucide-react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { FileExplorerPane } from "@/components/file-explorer-pane";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import { useAddFileToChat } from "@/panels/use-add-file-to-chat";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";

const filesPanelPresentation = {
  label: (t) => t("panels.files.label"),
  subtitle: (t) => t("panels.files.subtitle"),
  tooltip: (t) => t("panels.files.tooltip"),
  icon: Files,
} satisfies PanelPresentation;

function FilesPanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, target, openPreferredTarget, openTargetToSide } = usePaneContext();
  const workspaceRoot = useWorkspaceDirectory(serverId, workspaceId);
  const { addFile, canAddToChat } = useAddFileToChat({ serverId, workspaceId });
  invariant(target.kind === "files", "FilesPanel requires files target");
  const onOpenFile = useCallback(
    (path: string) => openPreferredTarget({ kind: "file", path }, "explorerFiles"),
    [openPreferredTarget],
  );
  const onOpenFileToSide = useCallback(
    (path: string) => openTargetToSide?.({ kind: "file", path }),
    [openTargetToSide],
  );
  if (!workspaceRoot) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <span>{t("panels.file.directoryMissing")}</span>
      </div>
    );
  }
  return (
    <FileExplorerPane
      serverId={serverId}
      workspaceId={workspaceId}
      workspaceRoot={workspaceRoot}
      onOpenFile={onOpenFile}
      onOpenFileToSide={openTargetToSide ? onOpenFileToSide : undefined}
      onAddToChat={canAddToChat ? addFile : undefined}
    />
  );
}

export const filesPanelRegistration = definePanel("files", {
  component: FilesPanel,
  presentation: filesPanelPresentation,
});
