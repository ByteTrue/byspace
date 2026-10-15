import {
  collectAllPanes,
  collectAllTabs,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-store";

/**
 * Whether the Chief session is the conversation on screen in a workspace.
 *
 * The maximized window and the compact entry both land on the workspace route
 * with the agent opened as a pane tab, and that route consumes its `?open=`
 * intent as soon as the tab exists — so re-reading the URL cannot answer this.
 * The layout can: the tab is still there, in a pane, after the intent is gone.
 */
export function isChiefSessionVisible(input: {
  layout: WorkspaceLayout | undefined;
  chiefAgentId: string | null;
  focusedPaneOnly: boolean;
}): boolean {
  const { chiefAgentId, layout } = input;
  if (!chiefAgentId || !layout) {
    return false;
  }
  const panes = collectAllPanes(layout.root).filter(
    (pane) => !input.focusedPaneOnly || pane.id === layout.focusedPaneId,
  );
  const onScreenTabIds = new Set(panes.map((pane) => pane.focusedTabId));
  return collectAllTabs(layout.root).some(
    (tab) =>
      onScreenTabIds.has(tab.tabId) &&
      tab.target.kind === "agent" &&
      tab.target.agentId === chiefAgentId,
  );
}
