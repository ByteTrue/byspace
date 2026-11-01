// Transitional stand-in for `react-native` while web/ imports modules from packages/app/src.
// It carries only the non-UI APIs those modules use, with react-native-web's semantics, and
// deliberately no components: a shared module that renders React Native UI fails to build and
// has to be overridden in src/overrides/. Deleted at the cutover.
import { useSyncExternalStore } from "react";

export type AppStateStatus = "active" | "background";
type AppStateEvent = "change" | "focus" | "blur";

function currentAppState(): AppStateStatus {
  return document.visibilityState === "hidden" ? "background" : "active";
}

export const AppState = {
  isAvailable: true,
  get currentState(): AppStateStatus {
    return currentAppState();
  },
  addEventListener(type: AppStateEvent, handler: (state: AppStateStatus) => void) {
    const listener = () => handler(currentAppState());
    if (type === "change") {
      document.addEventListener("visibilitychange", listener);
      return { remove: () => document.removeEventListener("visibilitychange", listener) };
    }
    window.addEventListener(type, listener);
    return { remove: () => window.removeEventListener(type, listener) };
  },
};

type PlatformSpec<T> = { web?: T; default?: T } & Record<string, T | undefined>;

export type PlatformOSType = "ios" | "android" | "macos" | "windows" | "web" | "native";

export const Platform = {
  // Typed like React Native's union so shared `Platform.OS === "ios"` checks still compile.
  OS: "web" as PlatformOSType,
  Version: 0,
  isTV: false,
  isTesting: false,
  select<T>(spec: PlatformSpec<T>): T {
    return ("web" in spec ? spec.web : spec.default) as T;
  },
};

function subscribeResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

let lastDimensions = { width: 0, height: 0, scale: 1, fontScale: 1 };
function readDimensions() {
  const { innerWidth: width, innerHeight: height, devicePixelRatio: scale } = window;
  if (
    width !== lastDimensions.width ||
    height !== lastDimensions.height ||
    scale !== lastDimensions.scale
  ) {
    lastDimensions = { width, height, scale, fontScale: 1 };
  }
  return lastDimensions;
}

export function useWindowDimensions() {
  return useSyncExternalStore(subscribeResize, readDimensions, readDimensions);
}

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");
function subscribeColorScheme(onChange: () => void) {
  const query = darkQuery();
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const readColorScheme = () => (darkQuery().matches ? "dark" : "light");

export function useColorScheme(): "light" | "dark" {
  return useSyncExternalStore(subscribeColorScheme, readColorScheme, readColorScheme);
}

export const Keyboard = {
  dismiss() {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  },
  addListener() {
    return { remove() {} };
  },
  isVisible() {
    return false;
  },
};

interface AlertButton {
  text?: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void;
}

// react-native-web's Alert.alert does nothing, so packages/app on the web never showed these; the
// forms that matter put the same error inline. A browser alert here would add a second, blocking
// copy of it.
// shortcut: errors that only ever went to Alert.alert (a failed provider toggle or removal, a
// failed restart request) still show nothing; route them to a toast when that gets an imperative API.
export const Alert = {
  alert(_title: string, _message?: string, _buttons?: AlertButton[]) {},
};

// Types shared modules reference in their signatures. Loose on purpose: on the web these values
// only pass through to overridden components, which read the CSS-compatible parts.
export type ViewStyle = Record<string, unknown>;
/**
 * On the web a View ref is the DOM element (shared `.web` hooks type their refs this way). A type
 * only: rendering `<View>` still fails the typecheck, as the shim has no components.
 */
export type View = HTMLElement;
export type TextStyle = Record<string, unknown>;
export type ImageStyle = Record<string, unknown>;
export type StyleProp<T> = T | ReadonlyArray<StyleProp<T>> | null | undefined | false;
export interface LayoutRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}
/**
 * The image load event as shared code reads it: React Native puts the size in `source`; on the
 * web the browser's own event carries the image as `target`.
 */
export interface ImageLoadEvent {
  nativeEvent: {
    source?: { width: number; height: number; uri?: string };
    target?: EventTarget | null;
  };
}
export interface LayoutChangeEvent {
  nativeEvent: { layout: LayoutRectangle };
}
export interface GestureResponderEvent {
  nativeEvent: unknown;
  stopPropagation?: () => void;
  preventDefault?: () => void;
}
export interface PressableStateCallbackType {
  pressed: boolean;
  hovered?: boolean;
  focused?: boolean;
}
export type PressableProps = Record<string, unknown>;
export type ViewProps = Record<string, unknown>;
export type TextProps = Record<string, unknown>;
