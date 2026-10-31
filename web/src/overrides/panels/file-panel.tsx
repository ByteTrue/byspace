// Override of packages/app/src/panels/file-panel.tsx: same descriptor.
// shortcut: the file preview and editor move in batch 5 of step 3.
import { useMemo } from "react";
import { createMaterialFileIcon } from "@/components/material-file-icon";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel } from "@/panels/panel-registry";
import { PendingPanel } from "@/panels/pending-panel";

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
  const { target } = usePaneContext();
  return <PendingPanel title={target.kind === "file" ? target.path : "File"} />;
}

export const filePanelRegistration = definePanel("file", {
  component: FilePanel,
  useDescriptor: useFilePanelDescriptor,
});
