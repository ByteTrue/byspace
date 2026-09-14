/**
 * Desktop window chrome shim (Electron retired, issue 025 A3).
 *
 * These components permanently render nothing on web. They exist so shared
 * screens keep their layout calls; new code must not use them.
 */
import { View, type StyleProp, type ViewStyle } from "react-native";
import type { ReactNode } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

export function TitlebarDragRegion(_props?: any): ReactNode {
  return null;
}

/**
 * On web there is no window chrome obstruction, so this is a plain View that
 * keeps the caller's horizontal padding (the Electron path used to add
 * traffic-light insets on top of it).
 */
export function WindowChromeSafeArea({
  horizontalPadding = 0,
  style,
  ...props
}: { horizontalPadding?: number; style?: StyleProp<ViewStyle> } & Record<string, any>): ReactNode {
  return (
    <View
      {...props}
      style={[style, { paddingLeft: horizontalPadding, paddingRight: horizontalPadding }]}
    />
  );
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

/**
 * Web owns all window chrome corners: the browser frame draws its own
 * controls there, so owned corners are "both" exactly as the Electron
 * runtime reported them. Obstruction (traffic-light insets) stays empty.
 */
export function useOwnsWindowChromeCorner(_corner: string): true {
  return true;
}

export function useHasWindowChromeObstruction(_corner: string): false {
  return false;
}

export type WindowChromeCorners = "none" | "all" | string;

export function useWindowChromeCorners(): WindowChromeCorners {
  return "both";
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
