// Override of packages/app/src/components/ui/icon-button-chrome.ts. The Expo file returns React
// Native styles; here the same frames are class names. Small: 20px (32px on a phone), large: 28px
// (32px on a phone), md radius, highlighted with the accent fill. Only an open menu (Radix's
// data-state) fills; aria-expanded on a panel toggle reports the panel, not a pressed look.
import { cn } from "cn";

export { extraMutedIconColorMapping, mutedIconColorMapping } from "@/components/ui/icon-color";

export type IconButtonChromeSize = "large" | "small";

export interface IconButtonChromeState {
  hovered?: boolean;
  pressed?: boolean;
  open?: boolean;
  active?: boolean;
}

const SMALL_ICON_BUTTON_SIZE = 20;
const COMPACT_SMALL_ICON_BUTTON_SIZE = 32;

export function iconButtonChromeClassName({
  size,
  compact = false,
  active = false,
  disabled = false,
  className,
}: {
  size: IconButtonChromeSize;
  compact?: boolean;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}): string {
  let frame = "size-8 md:size-7";
  if (size === "small") frame = compact ? "size-8" : "size-5";
  return cn(
    // As packages/app's chrome: hovered, pressed, open or active fills with the interaction
    // highlight; the glyph keeps the colour its caller gave it.
    "inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-interaction-highlight focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-interaction-highlight data-[state=open]:bg-interaction-highlight",
    frame,
    active && "bg-interaction-highlight",
    disabled && "pointer-events-none opacity-50",
    className,
  );
}

export function iconButtonChromeGlyphSize(size: IconButtonChromeSize, compact = false): number {
  if (size === "large") return 16;
  return compact ? 18 : 14;
}

export function smallIconButtonChromeFrameSize(compact = false): number {
  return compact ? COMPACT_SMALL_ICON_BUTTON_SIZE : SMALL_ICON_BUTTON_SIZE;
}
