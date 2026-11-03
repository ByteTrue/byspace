import { SETTINGS_DESKTOP_SPLIT_MIN_WIDTH } from "@/constants/layout";

export function resolveDesktopSidebarVisibility(input: {
  chromeEnabled: boolean;
  isCompactLayout: boolean;
  isMounted: boolean;
  isOpen: boolean;
  canShare: boolean;
}): boolean {
  return (
    input.chromeEnabled &&
    !input.isCompactLayout &&
    input.isMounted &&
    input.isOpen &&
    input.canShare
  );
}

export function resolveDesktopAppChromeLayout(input: {
  desktopSidebarRendered: boolean;
  hasTopLeftWindowControls: boolean;
  sidebarControlsEnabled: boolean;
}) {
  const sidebarOwnsTopLeft = input.desktopSidebarRendered && input.hasTopLeftWindowControls;
  let sidebarToggleOwner: "none" | "window" | "content" = "none";
  if (input.sidebarControlsEnabled) {
    sidebarToggleOwner = input.hasTopLeftWindowControls ? "window" : "content";
  }
  return {
    sidebarCorners: sidebarOwnsTopLeft ? ("top-left" as const) : ("none" as const),
    contentCorners: sidebarOwnsTopLeft ? ("top-right" as const) : ("both" as const),
    sidebarToggleOwner,
  };
}

export function resolveDesktopAppContentMinimum(input: { isSettingsRoute: boolean }): number {
  return input.isSettingsRoute ? SETTINGS_DESKTOP_SPLIT_MIN_WIDTH : 0;
}

export function canDesktopAppSidebarShare(input: {
  contentMinimumWidth: number;
  sidebarWidth: number;
  viewportWidth: number;
}): boolean {
  return input.viewportWidth - input.sidebarWidth >= input.contentMinimumWidth;
}
