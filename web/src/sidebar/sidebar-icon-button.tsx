import { useState, type ComponentProps, type ReactNode } from "react";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { cn } from "cn";
import { Shortcut } from "~/components/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

/** A small icon button with a tooltip naming it and its shortcut, as the sidebar header and footer use. */
export function SidebarIconButton({
  label,
  shortcutKeys,
  tooltipSide = "bottom",
  active = false,
  fill = true,
  className,
  children,
  ...props
}: ComponentProps<"button"> & {
  label: string;
  shortcutKeys?: ShortcutKey[][] | null;
  tooltipSide?: "top" | "bottom";
  active?: boolean;
  /** packages/app's footer buttons only darken their glyph on hover; header buttons also fill. */
  fill?: boolean;
  children: ReactNode;
}) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  // A menu this button opens covers the same spot; its tooltip stays away while the menu is up.
  const menuOpen = (props as { "data-state"?: string })["data-state"] === "open";
  return (
    <Tooltip open={tooltipOpen && !menuOpen} onOpenChange={setTooltipOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-foreground [&_svg]:size-4",
            active && "text-sidebar-foreground",
            !fill && "hover:bg-transparent data-[state=open]:bg-transparent",
            className,
          )}
          {...props}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>
        {label}
        {shortcutKeys ? <Shortcut chord={shortcutKeys} /> : null}
      </TooltipContent>
    </Tooltip>
  );
}
