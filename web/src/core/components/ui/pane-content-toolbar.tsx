// Port of packages/app/src/components/ui/pane-content-toolbar.tsx: the 36px bar on top of a
// pane and its 20px icon buttons, each with a tooltip naming it and its shortcut.
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  iconButtonChromeClassName,
  iconButtonChromeGlyphSize,
  smallIconButtonChromeFrameSize,
} from "@/components/ui/icon-button-chrome";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { cn } from "cn";

// packages/app/src/components/tree-primitives.tsx: the right rail trailing glyphs line up on.
const WORKSPACE_PANE_TRAILING_GLYPH_RAIL = 8;

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
  style?: unknown;
  disabled?: boolean;
  testID?: string;
} & ({ kind?: "action"; onPress: () => void } | { kind: "menu"; onPress?: never });

export function ToolbarButton({
  children,
  label,
  selected = false,
  compact = false,
  shortcut,
  tooltipSide = "bottom",
  className,
  kind = "action",
  onPress,
  disabled,
  testID,
}: ToolbarButtonProps) {
  const buttonClassName = iconButtonChromeClassName({
    size: "small",
    compact,
    active: selected,
    disabled,
    className,
  });
  const tooltip = (
    <TooltipContent side={tooltipSide} offset={8}>
      <span className="flex items-center gap-2">
        {label}
        {shortcut ? <Shortcut chord={shortcut} /> : null}
      </span>
    </TooltipContent>
  );
  if (kind === "menu") {
    return (
      <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            disabled={disabled}
            testID={testID}
            accessibilityLabel={label}
            aria-pressed={selected || undefined}
            className={buttonClassName}
          >
            {children}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {tooltip}
      </Tooltip>
    );
  }
  return (
    <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        disabled={disabled}
        testID={testID}
        accessibilityLabel={label}
        aria-pressed={selected || undefined}
        onPress={onPress}
        className={buttonClassName}
      >
        {children}
      </TooltipTrigger>
      {tooltip}
    </Tooltip>
  );
}

export function paneContentToolbarIconSize(isCompact: boolean): number {
  return iconButtonChromeGlyphSize("small", isCompact);
}

export function paneContentToolbarTrailingPadding(isCompact: boolean): number {
  const buttonSize = smallIconButtonChromeFrameSize(isCompact);
  return (
    WORKSPACE_PANE_TRAILING_GLYPH_RAIL - (buttonSize - paneContentToolbarIconSize(isCompact)) / 2
  );
}
