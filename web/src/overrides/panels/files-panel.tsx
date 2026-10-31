// Override of packages/app/src/panels/files-panel.tsx: same presentation.
// shortcut: the file tree moves in batch 5 of step 3.
import { Files } from "lucide-react";
import { useTranslation } from "react-i18next";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import { PendingPanel } from "@/panels/pending-panel";

const filesPanelPresentation = {
  label: (t) => t("panels.files.label"),
  subtitle: (t) => t("panels.files.subtitle"),
  tooltip: (t) => t("panels.files.tooltip"),
  icon: Files,
} satisfies PanelPresentation;

function FilesPanel() {
  const { t } = useTranslation();
  return <PendingPanel title={t("panels.files.label")} />;
}

export const filesPanelRegistration = definePanel("files", {
  component: FilesPanel,
  presentation: filesPanelPresentation,
});
