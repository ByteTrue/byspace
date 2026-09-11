/**
 * Desktop shell shim (Electron retired, issue 025 A3).
 *
 * The Electron desktop app is gone; the web client is the only platform.
 * These constants exist so shared code can keep referencing them without
 * desktop branches — they are permanently false/null and any code path
 * behind them is dead. New code must not import from here; use plain web
 * logic instead.
 */

export function getDesktopHost(): null {
  return null;
}

/**
 * Structural stub: nothing ever implements these on web. The optional fields
 * mirror the retired Electron bridge surface so legacy call sites and tests
 * keep type-checking; every accessor is permanently undefined.
 */
export interface DesktopHostBridge {
  readonly __retired?: true;
  webUtils?: { getPathForFile?: (file: unknown) => string };
  platform?: string;
  window?: Record<string, unknown>;
  dialog?: DesktopDialogBridge;
  browser?: Record<string, unknown>;
  events?: Record<string, unknown>;
  opener?: Record<string, unknown>;
  notification?: Record<string, unknown>;
}

export interface DesktopDialogBridge {
  readonly __retired?: true;
  open?: (options: DesktopDialogOpenOptions) => Promise<unknown>;
  askWithCheckbox?: (
    message: string,
    options: Record<string, unknown>,
  ) => Promise<{ confirmed: boolean; dontAskAgain: boolean }>;
}

export interface DesktopDialogOpenOptions {
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  [key: string]: unknown;
}

export const isElectronRuntime = (): boolean => false;

export const isElectronRuntimeMac = (): boolean => false;

export function getElectronWebViewPartition(): null {
  return null;
}
