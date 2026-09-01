export function buildPaneHeaderActionsPortalName(
  serverId: string,
  workspaceId: string,
  tabId: string,
): string {
  return `pane-header-actions:${serverId}:${workspaceId}:${tabId}`;
}
