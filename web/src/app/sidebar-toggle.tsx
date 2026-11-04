import { useCallback } from "react";
import { Menu, PanelLeft } from "lucide-react";
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

/**
 * The sidebar toggle, as in the Expo app's SidebarMenuToggle: exactly one host shows it, the
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
          size={isCompact ? "icon" : "icon-sm"}
          data-testid="menu-button"
          aria-label={isOpen ? t("shell.menu.close") : t("shell.menu.open")}
          onClick={toggle}
        >
          {isCompact ? <Menu /> : <PanelLeft />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={host === "sidebar" ? "bottom" : "right"}>
        {t("shell.menu.toggleSidebar")}
        <Shortcut keys={getShortcutOs() === "mac" ? MAC_TOGGLE_KEYS : OTHER_TOGGLE_KEYS} />
      </TooltipContent>
    </Tooltip>
  );
}
