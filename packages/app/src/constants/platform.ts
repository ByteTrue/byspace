import { Platform } from "react-native";
import { isElectronRuntime, isElectronRuntimeMac } from "@/desktop/host";

/** Browser or Electron runtime; DOM APIs are available. */
export const isWeb = Platform.OS === "web";

/** iOS or Android React Native runtime. */
export const isNative = Platform.OS !== "web";

/** iOS policy gate: daemon-delivered plugin bundles must not execute in the App Store client. */
export function allowsDynamicPluginClientBundles(os: string = Platform.OS): boolean {
  return os !== "ios";
}

/** Development build/runtime. */
export const isDev = Boolean((globalThis as { __DEV__?: boolean }).__DEV__);

let isElectronCached: boolean | null = null;
let isElectronMacCached: boolean | null = null;

/** Running inside the Electron desktop wrapper (any desktop OS). */
export function getIsElectron(): boolean {
  if (isElectronCached === true) return true;
  if (!isWeb) return false;
  const result = isElectronRuntime();
  if (result) isElectronCached = true;
  return result;
}

/** Running inside the Electron desktop wrapper on macOS. */
export function getIsElectronMac(): boolean {
  if (isElectronMacCached === true) return true;
  if (!isWeb) return false;
  const result = isElectronRuntimeMac();
  if (result) isElectronMacCached = true;
  return result;
}
