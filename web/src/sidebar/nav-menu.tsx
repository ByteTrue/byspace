import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isMenuSidebarNavId } from "@/sidebar-nav/model";
import {
  SIDEBAR_NAV_TEST_IDS,
  useSidebarNavMenuEntries,
} from "@/sidebar-nav/use-sidebar-nav-entries";
import { useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";
import { Shortcut } from "~/components/shortcut";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

type NavEntry = ReturnType<typeof useSidebarNavMenuEntries>[number];

function NavMenuEntry({
  entry,
  onBeforeNavigate,
}: {
  entry: NavEntry;
  onBeforeNavigate?: () => void;
}) {
  const handleSelect = useCallback(() => {
    onBeforeNavigate?.();
    entry.onSelect();
  }, [entry, onBeforeNavigate]);
  const Icon = entry.icon;
  return (
    <DropdownMenuCheckboxItem
      checked={entry.isActive}
      onSelect={handleSelect}
      data-testid={SIDEBAR_NAV_TEST_IDS[entry.id]}
    >
      <Icon />
      {entry.label}
      {entry.shortcutKeys ? (
        <DropdownMenuShortcut>
          <Shortcut chord={entry.shortcutKeys} />
        </DropdownMenuShortcut>
      ) : null}
    </DropdownMenuCheckboxItem>
  );
}

function NavMenuEntries({ onBeforeNavigate }: { onBeforeNavigate?: () => void }) {
  const entries = useSidebarNavMenuEntries();
  return entries.map((entry) => (
    <NavMenuEntry key={entry.id} entry={entry} onBeforeNavigate={onBeforeNavigate} />
  ));
}

/**
 * packages/app's SidebarNavMenu: the BySpace button at the top of the sidebar, holding the
 * destinations the Workspaces header does not carry. No entries, no button.
 */
export function SidebarNavMenu({
  panelActive,
  onBeforeNavigate,
}: {
  panelActive: boolean;
  onBeforeNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // The panel stays mounted while hidden, so a menu left open would float with nothing under it.
  useEffect(() => {
    if (!panelActive) setOpen(false);
  }, [panelActive]);
  const { items } = useSidebarNavItems();
  const hasEntries = items.some((item) => item.visible && isMenuSidebarNavId(item.id));
  if (!hasEntries) return null;
  const label = t("sidebar.appMenu.label");
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label={label}
        data-testid="sidebar-nav-menu-trigger"
        className="group/nav flex h-7 min-w-0 items-center gap-1 rounded-md px-2 text-sm font-semibold text-sidebar-foreground outline-none ring-sidebar-ring hover:bg-sidebar-accent focus-visible:ring-2 data-[state=open]:bg-sidebar-accent"
      >
        <span className="truncate" data-testid="sidebar-nav-menu-label">
          {label}
        </span>
        <Chevron className="size-3.5 shrink-0 text-muted-foreground group-hover/nav:text-sidebar-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-60"
        data-testid="sidebar-nav-menu"
      >
        {open ? <NavMenuEntries onBeforeNavigate={onBeforeNavigate} /> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
