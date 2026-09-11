/**
 * Desktop window chrome shim (Electron retired, issue 025 A3).
 *
 * These components permanently render nothing on web. They exist so shared
 * screens keep their layout calls; new code must not use them.
 */
import type { ReactNode } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

export function TitlebarDragRegion(_props?: any): ReactNode {
  return null;
}

export function WindowChromeSafeArea(_props?: any): ReactNode {
  return null;
}

export function WindowChromeRegion(
  props: { children: ReactNode } & Record<string, any>,
): ReactNode {
  return props.children;
}

export function WindowChromeRootRegion(
  props: { children: ReactNode } & Record<string, any>,
): ReactNode {
  return props.children;
}

export function isDesktopWindowFullscreen(): boolean {
  return false;
}

export function useOwnsWindowChromeCorner(_corner: string): false {
  return false;
}

export function useHasWindowChromeObstruction(_corner: string): false {
  return false;
}

export type WindowChromeCorners = "none" | "all" | string;

export function useWindowChromeCorners(): WindowChromeCorners {
  return "none";
}

export function removeWindowChromeCorner(
  corners: WindowChromeCorners,
  _corner: string,
): WindowChromeCorners {
  return corners;
}

export function toggleDesktopWindowFullscreen(): void {
  // No desktop window exists on web.
}

export function showDesktopWindowIfMinimized(): void {
  // No desktop window exists on web.
}
