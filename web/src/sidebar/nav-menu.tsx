import { useCallback } from "react";
import {
  SIDEBAR_NAV_TEST_IDS,
  useSidebarNavMenuEntries,
} from "@/sidebar-nav/use-sidebar-nav-entries";
import { Shortcut } from "~/components/shortcut";

type NavEntry = ReturnType<typeof useSidebarNavMenuEntries>[number];

function NavRow({ entry, onBeforeNavigate }: { entry: NavEntry; onBeforeNavigate?: () => void }) {
  const handleClick = useCallback(() => {
    onBeforeNavigate?.();
    entry.onSelect();
  }, [entry, onBeforeNavigate]);
  const Icon = entry.icon;
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-current={entry.isActive ? "page" : undefined}
      data-active={entry.isActive}
      data-testid={SIDEBAR_NAV_TEST_IDS[entry.id]}
      className="relative flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-sidebar-foreground transition-[background-color] before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-sidebar-foreground before:opacity-0 hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:before:opacity-100 md:min-h-8 md:py-1.5"
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{entry.label}</span>
      {entry.shortcutKeys ? (
        <span className="shrink-0 max-md:hidden">
          <Shortcut chord={entry.shortcutKeys} />
        </span>
      ) : null}
    </button>
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
    <nav className="flex flex-col gap-px px-2 pt-1" data-testid="sidebar-nav-rows">
      {entries.map((entry) => (
        <NavRow key={entry.id} entry={entry} onBeforeNavigate={onBeforeNavigate} />
      ))}
    </nav>
  );
}
