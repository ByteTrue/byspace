// The 36px bar on top of a pane and its icon buttons: shadcn ghost icon Buttons, each with a
// shadcn Tooltip naming it and its shortcut. A "menu" button is a shadcn DropdownMenuTrigger.
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { DropdownMenuTrigger } from "~/components/ui/dropdown-menu";
import { Shortcut } from "~/components/shortcut";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { cn } from "cn";

// The right rail trailing glyphs line up on (tree-primitives), and shadcn's icon-xs button: a 24px
// frame around a 12px glyph.
const WORKSPACE_PANE_TRAILING_GLYPH_RAIL = 8;
const ICON_BUTTON_FRAME = 24;
const ICON_BUTTON_GLYPH = 12;

export function PaneContentToolbar({
  children,
  className,
  style,
  testID,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  testID?: string;
}) {
  return (
    <div
      className={cn("h-9 shrink-0 border-b bg-background", className)}
      style={style}
      data-testid={testID}
    >
      {children}
    </div>
  );
}

export function ToolbarControls({
  children,
  className,
  testID,
  ...props
}: ComponentProps<"div"> & { testID?: string }) {
  return (
    <div {...props} data-testid={testID} className={cn("flex items-center gap-px", className)}>
      {children}
    </div>
  );
}

type ToolbarButtonProps = {
  children: ReactNode;
  label: string;
  selected?: boolean;
  compact?: boolean;
  shortcut?: ShortcutKey[][] | null;
  tooltipSide?: "left" | "right" | "top" | "bottom";
  className?: string;
  disabled?: boolean;
  testID?: string;
  "aria-selected"?: boolean;
} & ({ kind?: "action"; onPress: () => void } | { kind: "menu"; onPress?: never });

export function ToolbarButton({
  children,
  label,
  selected = false,
  shortcut,
  tooltipSide = "bottom",
  className,
  kind = "action",
  onPress,
  disabled,
  testID,
  "aria-selected": ariaSelected,
}: ToolbarButtonProps) {
  const variant = selected ? "secondary" : "ghost";
  const button = (
    <Button
      variant={variant}
      size="icon-xs"
      disabled={disabled}
      data-testid={testID}
      aria-label={label}
      aria-pressed={selected || undefined}
      aria-selected={ariaSelected}
      onClick={onPress}
      className={className}
    >
      {children}
    </Button>
  );
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        {kind === "menu" ? <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger> : button}
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>
        {label}
        {shortcut ? <Shortcut chord={shortcut} /> : null}
      </TooltipContent>
    </Tooltip>
  );
}

export function paneContentToolbarTrailingPadding(): number {
  return WORKSPACE_PANE_TRAILING_GLYPH_RAIL - (ICON_BUTTON_FRAME - ICON_BUTTON_GLYPH) / 2;
}
