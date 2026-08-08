export const SIDEBAR_CHECKS_DISPLAYS = ["iconAndText", "icon", "none"] as const;
export type SidebarChecksDisplay = (typeof SIDEBAR_CHECKS_DISPLAYS)[number];
export const DEFAULT_SIDEBAR_CHECKS_DISPLAY: SidebarChecksDisplay = "iconAndText";

export function parseSidebarChecksDisplay(value: unknown): SidebarChecksDisplay | null {
  if (typeof value !== "string") return null;
  return (SIDEBAR_CHECKS_DISPLAYS as readonly string[]).includes(value)
    ? (value as SidebarChecksDisplay)
    : null;
}
