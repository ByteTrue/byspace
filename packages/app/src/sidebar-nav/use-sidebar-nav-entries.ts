import { useCallback, useMemo } from "react";
import { usePathname, router } from "expo-router";
import {
  ArrowRightLeft,
  Bot,
  CalendarClock,
  History,
  Plus,
  Search,
  type LucideIcon,
} from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { openChiefWorkspace, useIsShowingChiefWorkspace } from "@/chief/home-workspace";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import {
  builtinSidebarNavLabelKey,
  builtinSidebarNavShortcutAction,
  HEADER_SIDEBAR_NAV_IDS,
  isMenuSidebarNavId,
  type BuiltinSidebarNavId,
} from "@/sidebar-nav/model";
import { useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";
import {
  buildNewWorkspaceRoute,
  buildSchedulesRoute,
  buildSessionsRoute,
  buildTunnelsRoute,
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
  chief: Bot,
  search: Search,
  schedules: CalendarClock,
  tunnels: ArrowRightLeft,
};

/** testIDs for the nav entries. The app menu and the header buttons render the same ids. */
export const SIDEBAR_NAV_TEST_IDS: Record<BuiltinSidebarNavId, string> = {
  "new-workspace": "sidebar-global-new-workspace",
  history: "sidebar-sessions",
  chief: "sidebar-chief",
  search: "sidebar-search",
  schedules: "sidebar-schedules",
  tunnels: "sidebar-tunnels",
};

type MenuSidebarNavId = Exclude<BuiltinSidebarNavId, "new-workspace" | "history" | "chief">;

/**
 * The entries the app menu holds: the stored order, minus the fixed top-row and header buttons.
 *
 * Only called by `SidebarNavMenuSurface` while the menu is open, so the closed trigger does not
 * subscribe to menu-item shortcuts.
 */
export function useSidebarNavMenuEntries(): SidebarNavEntry[] {
  const { items } = useSidebarNavItems();
  const { t } = useTranslation();
  const pathname = usePathname();
  const setCommandCenterOpen = useKeyboardShortcutsStore((state) => state.setCommandCenterOpen);

  const searchShortcut = useShortcutKeys(builtinSidebarNavShortcutAction("search"));
  const schedulesShortcut = useShortcutKeys(builtinSidebarNavShortcutAction("schedules"));
  const tunnelsShortcut = useShortcutKeys(builtinSidebarNavShortcutAction("tunnels"));

  const onSearch = useCallback(() => {
    setCommandCenterOpen(true);
  }, [setCommandCenterOpen]);

  const onSchedules = useCallback(() => {
    router.push(buildSchedulesRoute());
  }, []);

  const onTunnels = useCallback(() => {
    router.push(buildTunnelsRoute());
  }, []);

  const entriesById = useMemo<Record<MenuSidebarNavId, SidebarNavEntry>>(
    () => ({
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
      tunnels: {
        id: "tunnels",
        icon: SIDEBAR_NAV_ICONS.tunnels,
        label: t(builtinSidebarNavLabelKey("tunnels")),
        shortcutKeys: tunnelsShortcut,
        isActive: pathname.includes("/tunnels"),
        onSelect: onTunnels,
      },
    }),
    [
      onSchedules,
      onSearch,
      onTunnels,
      pathname,
      schedulesShortcut,
      searchShortcut,
      t,
      tunnelsShortcut,
    ],
  );

  return useMemo(
    () =>
      items
        .filter(
          (item): item is typeof item & { id: MenuSidebarNavId } =>
            item.visible && isMenuSidebarNavId(item.id),
        )
        .map((item) => entriesById[item.id]),
    [items, entriesById],
  );
}

/**
 * The top-row Chief button's entry, or `null` when no connected host offers the Chief role or the
 * user switched Chief off in Appearance settings.
 */
export function useSidebarChiefNavEntry(): SidebarNavEntry | null {
  const { items } = useSidebarNavItems();
  const { t } = useTranslation();
  const pathname = usePathname();
  const chiefShortcut = useShortcutKeys(builtinSidebarNavShortcutAction("chief"));
  const isShowingChief = useIsShowingChiefWorkspace(pathname);

  const onChief = useCallback(() => {
    void openChiefWorkspace(pathname);
  }, [pathname]);

  return useMemo(() => {
    const visible = items.some((item) => item.id === "chief" && item.visible);
    if (!visible) return null;
    return {
      id: "chief",
      icon: SIDEBAR_NAV_ICONS.chief,
      label: t(builtinSidebarNavLabelKey("chief")),
      shortcutKeys: chiefShortcut,
      isActive: isShowingChief,
      onSelect: onChief,
    };
  }, [chiefShortcut, isShowingChief, items, onChief, t]);
}

/**
 * The Workspaces header's two icon buttons, in a fixed order rather than the stored one.
 *
 * The header is a row of controls over one list, so the two entries appear where the layout puts
 * them; a user-set order between two icons nobody sees side by side would be an order nobody
 * could observe. Visibility still applies — see the Appearance section.
 */
export function useSidebarHeaderNavEntries(): SidebarNavEntry[] {
  const { items } = useSidebarNavItems();
  const { t } = useTranslation();
  const pathname = usePathname();
  const newWorkspaceShortcut = useShortcutKeys(builtinSidebarNavShortcutAction("new-workspace"));
  const historyShortcut = useShortcutKeys(builtinSidebarNavShortcutAction("history"));

  // Route without a host: the screen resolver owns the initial host. A known route serverId
  // would bypass that chain, so this entry must not carry the active workspace's host.
  const onNewWorkspace = useCallback(() => {
    router.push(buildNewWorkspaceRoute());
  }, []);

  const onHistory = useCallback(() => {
    router.push(buildSessionsRoute());
  }, []);

  const entriesById = useMemo<Record<(typeof HEADER_SIDEBAR_NAV_IDS)[number], SidebarNavEntry>>(
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
    }),
    [historyShortcut, newWorkspaceShortcut, onHistory, onNewWorkspace, pathname, t],
  );

  return useMemo(() => {
    const visible = new Set(items.filter((item) => item.visible).map((item) => item.id));
    return HEADER_SIDEBAR_NAV_IDS.filter((id) => visible.has(id)).map((id) => entriesById[id]);
  }, [items, entriesById]);
}
