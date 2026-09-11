/**
 * Desktop settings shim (Electron retired, issue 025 A3).
 *
 * The settings store keeps its shape; the desktop branch of it is
 * permanently empty. New code must not read or write desktop settings.
 */

export interface DesktopSettings {
  daemon?: Record<string, never>;
  releaseChannel?: "stable" | "beta";
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {};

export function loadDesktopSettings(): Promise<DesktopSettings> {
  return Promise.resolve({});
}

export function migrateLegacyDesktopSettings(): Promise<void> {
  return Promise.resolve();
}

export function useDesktopSettings(): {
  settings: DesktopSettings;
  updateSettings: (updates: Partial<DesktopSettings>) => Promise<void>;
} {
  return {
    settings: DEFAULT_DESKTOP_SETTINGS,
    updateSettings: () => Promise.resolve(),
  };
}

export function useDesktopSettingsBridgeStatus(): "unavailable" {
  return "unavailable";
}
