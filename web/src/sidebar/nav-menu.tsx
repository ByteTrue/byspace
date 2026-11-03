import { useCallback } from "react";
import {
  SIDEBAR_NAV_TEST_IDS,
  useSidebarNavMenuEntries,
} from "@/sidebar-nav/use-sidebar-nav-entries";
import { Shortcut } from "~/components/shortcut";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";

type NavEntry = ReturnType<typeof useSidebarNavMenuEntries>[number];

function NavRow({ entry, onBeforeNavigate }: { entry: NavEntry; onBeforeNavigate?: () => void }) {
  const handleClick = useCallback(() => {
    onBeforeNavigate?.();
    entry.onSelect();
  }, [entry, onBeforeNavigate]);
  const Icon = entry.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={entry.isActive}
        onClick={handleClick}
        aria-current={entry.isActive ? "page" : undefined}
        data-testid={SIDEBAR_NAV_TEST_IDS[entry.id]}
      >
        <Icon />
        <span>{entry.label}</span>
        {entry.shortcutKeys ? (
          <span className="ml-auto max-md:hidden">
            <Shortcut chord={entry.shortcutKeys} />
          </span>
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * The destinations the Workspaces header does not carry (Search, Schedules, Tunnels, in the order
 * and visibility set in Appearance), as rows at the top of the sidebar. The Expo app folds them
 * into a "BySpace ⌄" dropdown at the top-left; on the web they are listed: a product name with a
 * chevron reads as an account switcher, and it hid the pages behind a click and never showed which
 * one was open. The rows scroll with the list, like the Workspaces header, so a long list keeps
 * its room.
 */
export function SidebarNavRows({ onBeforeNavigate }: { onBeforeNavigate?: () => void }) {
  const entries = useSidebarNavMenuEntries();
  if (entries.length === 0) return null;
  return (
    <SidebarGroup data-testid="sidebar-nav-rows">
      <SidebarMenu>
        {entries.map((entry) => (
          <NavRow key={entry.id} entry={entry} onBeforeNavigate={onBeforeNavigate} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
