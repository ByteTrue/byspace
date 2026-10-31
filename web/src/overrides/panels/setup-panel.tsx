// Override of packages/app/src/panels/setup-panel.tsx: same descriptor.
// shortcut: the setup log view moves in batch 8 of step 3.
import { CheckCircle2, CircleAlert, SquareTerminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { definePanel, type PanelDescriptor } from "@/panels/panel-registry";
import { useWorkspaceSetupStore } from "@/stores/workspace-setup-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { PendingPanel } from "@/panels/pending-panel";

function useSetupPanelDescriptor(
  target: { kind: "setup"; workspaceId: string },
  context: { serverId: string; workspaceId: string },
): PanelDescriptor {
  const { t } = useTranslation();
  const key = buildWorkspaceTabPersistenceKey({
    serverId: context.serverId,
    workspaceId: target.workspaceId,
  });
  const snapshot = useWorkspaceSetupStore((state) => (key ? (state.snapshots[key] ?? null) : null));
  const label = t("workspace.setup.descriptor.label");
  if (snapshot?.status === "completed") {
    const subtitle = t("workspace.setup.descriptor.completed");
    return {
      label,
      subtitle,
      tooltip: subtitle,
      titleState: "ready",
      icon: CheckCircle2,
      statusBucket: null,
    };
  }
  if (snapshot?.status === "failed") {
    const subtitle = t("workspace.setup.descriptor.failed");
    return {
      label,
      subtitle,
      tooltip: subtitle,
      titleState: "ready",
      icon: CircleAlert,
      statusBucket: null,
    };
  }
  if (snapshot?.status === "blocked") {
    const subtitle = t("workspace.setup.descriptor.blocked");
    return {
      label,
      subtitle,
      tooltip: subtitle,
      titleState: "ready",
      icon: CircleAlert,
      statusBucket: null,
    };
  }
  const subtitle = t("workspace.setup.descriptor.workspace");
  return {
    label,
    subtitle,
    tooltip: subtitle,
    titleState: "ready",
    icon: SquareTerminal,
    statusBucket: snapshot?.status === "running" ? "running" : null,
  };
}

function SetupPanel() {
  const { t } = useTranslation();
  return <PendingPanel title={t("workspace.setup.descriptor.label")} />;
}

export const setupPanelRegistration = definePanel("setup", {
  component: SetupPanel,
  useDescriptor: useSetupPanelDescriptor,
});
