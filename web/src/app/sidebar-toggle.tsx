import { useCallback } from "react";
import { PanelLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { resolveSidebarToggleHost } from "@/components/sidebar/sidebar-toggle-host";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useDesktopSidebarVisible } from "@/contexts/desktop-sidebar-visibility-context";
import { selectIsAgentListOpen, usePanelStore } from "@/stores/panel-store";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { Shortcut } from "~/components/shortcut";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

const MAC_TOGGLE_KEYS = ["mod", "B"];
const OTHER_TOGGLE_KEYS = ["mod", "."];

/** packages/app's compact menu glyph: two 16px lines and a short 8px one, 1.5px thick. */
function MobileMenuIcon() {
  return (
    <svg
      width="16"
      height="12"
      viewBox="0 0 16 12"
      aria-hidden="true"
      className="text-muted-foreground"
    >
      <rect y="0" width="16" height="1.5" rx="0.75" fill="currentColor" />
      <rect y="5.25" width="16" height="1.5" rx="0.75" fill="currentColor" />
      <rect y="10.5" width="8" height="1.5" rx="0.75" fill="currentColor" />
    </svg>
  );
}

/**
 * The sidebar toggle, as in packages/app's SidebarMenuToggle: exactly one host shows it, the
 * sidebar's top row while the pinned sidebar is open, otherwise the content header.
 */
export function SidebarToggle({ host }: { host: "sidebar" | "content" }) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const desktopSidebarVisible = useDesktopSidebarVisible();
  const isOpen = usePanelStore((state) => selectIsAgentListOpen(state, { isCompact }));
  const toggleAgentListForLayout = usePanelStore((state) => state.toggleAgentListForLayout);
  const toggle = useCallback(
    () => toggleAgentListForLayout({ isCompact }),
    [isCompact, toggleAgentListForLayout],
  );

  if (resolveSidebarToggleHost({ isCompact, desktopSidebarVisible }) !== host) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          // packages/app's large header control: 28px on desktop, 32px on a phone.
          size={isCompact ? "icon" : "icon-sm"}
          data-testid="menu-button"
          aria-label={isOpen ? t("shell.menu.close") : t("shell.menu.open")}
          aria-expanded={isOpen}
          // As packages/app's leadingToggle: pulled 2px left so the glyph sits on the rows' 16px icon rail.
          // aria-expanded reports the sidebar's state; it must not paint the ghost button's open look.
          className="text-muted-foreground aria-expanded:bg-transparent aria-expanded:text-muted-foreground aria-expanded:hover:bg-interaction-highlight md:-ml-0.5"
          onClick={toggle}
        >
          {/* packages/app's toggle glyph keeps its colour on hover; only the fill changes. */}
          {isCompact ? (
            <MobileMenuIcon />
          ) : (
            <PanelLeft strokeWidth={1.5} className="text-muted-foreground" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={host === "sidebar" ? "bottom" : "right"}>
        {t("shell.menu.toggleSidebar")}
        <Shortcut keys={getShortcutOs() === "mac" ? MAC_TOGGLE_KEYS : OTHER_TOGGLE_KEYS} />
      </TooltipContent>
    </Tooltip>
  );
}
