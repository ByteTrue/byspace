/**
 * Which host renders the sidebar collapse toggle, and whether the pinned sidebar is the
 * surface that reaches the window's top-left corner.
 *
 * Both hosts — the pinned sidebar's own top row and a content header — put the toggle at the
 * same pixel, so exactly one of them may render it. Keeping the decision here means the two
 * conditions are complements by construction rather than by two hand-written expressions
 * that can drift apart.
 */
export type SidebarToggleHost = "sidebar" | "content";

export interface SidebarToggleHostInput {
  isCompact: boolean;
  desktopSidebarVisible: boolean;
}

export function resolveSidebarToggleHost(input: SidebarToggleHostInput): SidebarToggleHost {
  return input.isCompact || !input.desktopSidebarVisible ? "content" : "sidebar";
}

/** The pinned sidebar's copy renders only when it owns the toggle. */
export function sidebarHostRendersToggle(input: SidebarToggleHostInput): boolean {
  return resolveSidebarToggleHost(input) === "sidebar";
}
