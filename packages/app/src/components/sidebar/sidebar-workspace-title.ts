import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { WorkspaceTitleSource } from "@/hooks/use-settings";

export function resolveSidebarWorkspacePrimaryLabel(input: {
  workspace: Pick<SidebarWorkspaceEntry, "name" | "currentBranch">;
  workspaceTitleSource: WorkspaceTitleSource;
}): string {
  if (input.workspaceTitleSource === "branch") {
    return input.workspace.currentBranch ?? input.workspace.name;
  }
  return input.workspace.name;
}

export function resolveSidebarWorkspaceAccessibilityLabel(input: {
  workspace: Pick<SidebarWorkspaceEntry, "name" | "currentBranch">;
  workspaceTitleSource: WorkspaceTitleSource;
  projectName?: string | null;
  hostLabel?: string | null;
  pullRequestLabel?: string | null;
  checksLabel?: string | null;
  serviceLabel?: string | null;
  statusLabel?: string | null;
}): string {
  return [
    input.projectName,
    resolveSidebarWorkspacePrimaryLabel(input),
    input.hostLabel,
    input.pullRequestLabel,
    input.checksLabel,
    input.serviceLabel,
    input.statusLabel,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(", ");
}
