import type { PluginWorkspacePanelContribution } from "@bytetrue/byspace-plugin";
import type { InstalledPlugin } from "../types";
import type { PluginWorkspaceTabTarget } from "@/stores/workspace-tabs-store";

export function resolvePluginWorkspacePanel(
  plugin: InstalledPlugin | null,
  target: PluginWorkspaceTabTarget,
): PluginWorkspacePanelContribution | null {
  return (
    plugin?.workspacePanels.find(
      (panel) => panel.id === target.panelId && panel.context === target.context,
    ) ?? null
  );
}
