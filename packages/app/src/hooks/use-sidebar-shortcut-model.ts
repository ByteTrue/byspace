import { useMemo } from "react";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import { buildSidebarShortcutModel } from "@/utils/sidebar-shortcuts";

export function useSidebarShortcutModel(input: { projects: SidebarProjectEntry[] }) {
  const { projects } = input;

  const shortcutModel = useMemo(() => buildSidebarShortcutModel({ projects }), [projects]);

  return {
    shortcutIndexByWorkspaceKey: shortcutModel.shortcutIndexByWorkspaceKey,
  };
}
