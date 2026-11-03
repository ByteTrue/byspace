import { useState, type ComponentProps, type ReactNode } from "react";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { Button } from "~/components/ui/button";
import { Shortcut } from "~/components/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

/** shadcn's ghost icon Button with a Tooltip naming it and its shortcut (sidebar header and footer). */
export function SidebarIconButton({
  label,
  shortcutKeys,
  tooltipSide = "bottom",
  children,
  ...props
}: ComponentProps<"button"> & {
  label: string;
  shortcutKeys?: ShortcutKey[][] | null;
  tooltipSide?: "top" | "bottom";
  children: ReactNode;
}) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  // A menu this button opens covers the same spot; its tooltip stays away while the menu is up.
  const menuOpen = (props as { "data-state"?: string })["data-state"] === "open";
  return (
    <Tooltip open={tooltipOpen && !menuOpen} onOpenChange={setTooltipOpen}>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>
        {label}
        {shortcutKeys ? <Shortcut chord={shortcutKeys} /> : null}
      </TooltipContent>
    </Tooltip>
  );
}
