import { useCallback } from "react";
import { Menu, PanelLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useIsFocused } from "@/platform/route-focus";
import { selectIsAgentListOpen, usePanelStore } from "@/stores/panel-store";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { Shortcut } from "@/widgets/shortcut";
import { Button } from "@/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";

const MAC_TOGGLE_KEYS = ["mod", "B"];
const OTHER_TOGGLE_KEYS = ["mod", "."];

/**
 * The left sidebar's collapse/expand toggle in the active screen's content header.
 * Hidden when a workspace stays mounted behind a pushed screen (`WorkspaceLayer`).
 */
export function SidebarToggle() {
  const { t } = useTranslation();
  const isFocused = useIsFocused();
  const isCompact = useIsCompactFormFactor();
  const isOpen = usePanelStore((state) => selectIsAgentListOpen(state, { isCompact }));
  const toggleAgentListForLayout = usePanelStore((state) => state.toggleAgentListForLayout);
  const toggle = useCallback(
    () => toggleAgentListForLayout({ isCompact }),
    [isCompact, toggleAgentListForLayout],
  );

  if (!isFocused) return null;

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
      <TooltipContent side="bottom">
        {t("shell.menu.toggleSidebar")}
        <Shortcut keys={getShortcutOs() === "mac" ? MAC_TOGGLE_KEYS : OTHER_TOGGLE_KEYS} />
      </TooltipContent>
    </Tooltip>
  );
}
