import { useCallback, useMemo } from "react";
import { usePathname, router } from "expo-router";
import { CalendarClock, History, Plus, Search, type LucideIcon } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { canCreateWorktreeForProjectKind } from "@/projects/host-projects";
import { useHostFeature } from "@/runtime/host-features";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useWorkspace } from "@/stores/session-store-hooks";
import {
  builtinSidebarNavLabelKey,
  builtinSidebarNavShortcutAction,
  type BuiltinSidebarNavId,
} from "@/sidebar-nav/model";
import { useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";
import {
  buildNewWorkspaceRoute,
  buildSchedulesRoute,
  buildSessionsRoute,
} from "@/utils/host-routes";
import type { ShortcutKey } from "@/utils/format-shortcut";

export interface SidebarNavEntry {
  id: BuiltinSidebarNavId;
  icon: LucideIcon;
  label: string;
  shortcutKeys: ShortcutKey[][] | null;
  isActive: boolean;
  onSelect: () => void;
}

export const SIDEBAR_NAV_ICONS: Record<BuiltinSidebarNavId, LucideIcon> = {
  "new-workspace": Plus,
  history: History,
  search: Search,
  schedules: CalendarClock,
};

/** testIDs for the compact sidebar rows. The desktop menu renders the same ids on its items. */
export const SIDEBAR_NAV_TEST_IDS: Record<BuiltinSidebarNavId, string> = {
  "new-workspace": "sidebar-global-new-workspace",
  history: "sidebar-sessions",
  search: "sidebar-search",
  schedules: "sidebar-schedules",
};

/**
 * The one source for the top-level navigation entries — New workspace, History, Search,
 * Schedules — in the user's order and visibility.
 *
 * Two surfaces render these: the compact sidebar's rows and the desktop sidebar's BySpace
 * menu. They differ in presentation only, so label, icon, shortcut badge, active state, and
 * the press target are resolved once here. Every hook below is called unconditionally for
 * all four builtins, so the order stays fixed while the returned list tracks the preference.
 */
export function useSidebarNavEntries(): SidebarNavEntry[] {
  const { t } = useTranslation();
  const { items } = useSidebarNavItems();
  const pathname = usePathname();
  const setCommandCenterOpen = useKeyboardShortcutsStore((state) => state.setCommandCenterOpen);

  const activeWorkspaceSelection = useActiveWorkspaceSelection();
  const activeWorkspaceServerId = activeWorkspaceSelection?.serverId ?? null;
  const activeWorkspaceId = activeWorkspaceSelection?.workspaceId ?? null;
  const activeWorkspace = useWorkspace(activeWorkspaceServerId, activeWorkspaceId);
  const supportsWorkspaceMultiplicity = useHostFeature(
    activeWorkspaceServerId,
    "workspaceMultiplicity",
  );
  const canUseActiveWorkspaceContext = Boolean(
    activeWorkspace &&
    (supportsWorkspaceMultiplicity || canCreateWorktreeForProjectKind(activeWorkspace.projectKind)),
  );

  const newWorkspaceShortcut = useShortcutKeys(builtinSidebarNavShortcutAction("new-workspace"));
  const historyShortcut = useShortcutKeys(builtinSidebarNavShortcutAction("history"));
  const searchShortcut = useShortcutKeys(builtinSidebarNavShortcutAction("search"));
  const schedulesShortcut = useShortcutKeys(builtinSidebarNavShortcutAction("schedules"));

  const onNewWorkspace = useCallback(() => {
    router.push(
      activeWorkspaceServerId
        ? buildNewWorkspaceRoute(
            activeWorkspace && canUseActiveWorkspaceContext
              ? {
                  serverId: activeWorkspaceServerId,
                  sourceDirectory: activeWorkspace.projectRootPath,
                  projectId: activeWorkspace.projectId,
                }
              : { serverId: activeWorkspaceServerId },
          )
        : buildNewWorkspaceRoute(),
    );
  }, [activeWorkspace, activeWorkspaceServerId, canUseActiveWorkspaceContext]);

  const onHistory = useCallback(() => {
    router.push(buildSessionsRoute());
  }, []);

  const onSearch = useCallback(() => {
    setCommandCenterOpen(true);
  }, [setCommandCenterOpen]);

  const onSchedules = useCallback(() => {
    router.push(buildSchedulesRoute());
  }, []);

  const resolved = useMemo<Record<BuiltinSidebarNavId, SidebarNavEntry>>(
    () => ({
      "new-workspace": {
        id: "new-workspace",
        icon: SIDEBAR_NAV_ICONS["new-workspace"],
        label: t(builtinSidebarNavLabelKey("new-workspace")),
        shortcutKeys: newWorkspaceShortcut,
        isActive: false,
        onSelect: onNewWorkspace,
      },
      history: {
        id: "history",
        icon: SIDEBAR_NAV_ICONS.history,
        label: t(builtinSidebarNavLabelKey("history")),
        shortcutKeys: historyShortcut,
        isActive: pathname.includes("/sessions"),
        onSelect: onHistory,
      },
      search: {
        id: "search",
        icon: SIDEBAR_NAV_ICONS.search,
        label: t(builtinSidebarNavLabelKey("search")),
        shortcutKeys: searchShortcut,
        // Search opens the command center in place; it is not a route.
        isActive: false,
        onSelect: onSearch,
      },
      schedules: {
        id: "schedules",
        icon: SIDEBAR_NAV_ICONS.schedules,
        label: t(builtinSidebarNavLabelKey("schedules")),
        shortcutKeys: schedulesShortcut,
        isActive: pathname.includes("/schedules"),
        onSelect: onSchedules,
      },
    }),
    [
      historyShortcut,
      newWorkspaceShortcut,
      onHistory,
      onNewWorkspace,
      onSchedules,
      onSearch,
      pathname,
      schedulesShortcut,
      searchShortcut,
      t,
    ],
  );

  return useMemo(
    () => items.filter((item) => item.visible).map((item) => resolved[item.id]),
    [items, resolved],
  );
}
