import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";

type WorkspaceScript = SidebarWorkspaceEntry["scripts"][number];

export interface WorkspaceServiceSummary {
  name: string;
  health: WorkspaceScript["health"];
}

/** Selects the one running service worth surfacing: an unhealthy service wins. */
export function selectWorkspaceServiceSummary(
  scripts: SidebarWorkspaceEntry["scripts"],
): WorkspaceServiceSummary | null {
  let firstHealthy: WorkspaceServiceSummary | null = null;
  for (const script of scripts) {
    if (script.lifecycle !== "running") continue;
    if ((script.type ?? "service") !== "service") continue;

    const summary: WorkspaceServiceSummary = { name: script.scriptName, health: script.health };
    if (script.health === "unhealthy") return summary;
    firstHealthy ??= summary;
  }
  return firstHealthy;
}

export function workspaceServiceLabelKey(summary: WorkspaceServiceSummary): string {
  return summary.health === "unhealthy"
    ? "workspace.status.serviceUnhealthy"
    : "workspace.status.serviceRunning";
}
