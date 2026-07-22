import { useCallback, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { queryClient as appQueryClient } from "@/data/query-client";
import type { AppLanguage } from "@/i18n/locales";
import {
  APP_SETTINGS_KEY,
  APP_SETTINGS_QUERY_KEY,
  DEFAULT_APP_SETTINGS,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  DEFAULT_UI_FONT_SIZE,
  MAX_CODE_FONT_SIZE,
  MAX_TERMINAL_SCROLLBACK_LINES,
  MAX_UI_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_TERMINAL_SCROLLBACK_LINES,
  MIN_UI_FONT_SIZE,
  loadAppSettingsFromStorage as loadAppSettingsFromStoragePure,
  loadSettingsFromStorage as loadSettingsFromStoragePure,
  normalizeAppSettings,
  parseClampedFontSize,
  parseTerminalScrollbackLines,
  saveAppSettings as saveAppSettingsPure,
  type AppSettings,
  type KeyValueStorage,
  type SendBehavior,
  type ServiceUrlBehavior,
  type Settings,
  type SettingsDeps,
  type WorkspaceTitleSource,
} from "./storage";

export {
  APP_SETTINGS_KEY,
  DEFAULT_APP_SETTINGS,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  DEFAULT_UI_FONT_SIZE,
  MAX_CODE_FONT_SIZE,
  MAX_TERMINAL_SCROLLBACK_LINES,
  MAX_UI_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_TERMINAL_SCROLLBACK_LINES,
  MIN_UI_FONT_SIZE,
  parseClampedFontSize,
  parseTerminalScrollbackLines,
};
export type {
  AppSettings,
  AppLanguage,
  KeyValueStorage,
  SendBehavior,
  ServiceUrlBehavior,
  Settings,
  SettingsDeps,
  WorkspaceTitleSource,
};

const productionDeps: SettingsDeps = {
  storage: AsyncStorage,
};

export interface UseAppSettingsReturn {
  settings: AppSettings;
  isLoading: boolean;
  error: unknown;
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
  resetSettings: () => Promise<void>;
}

export interface UseSettingsReturn {
  settings: Settings;
  isLoading: boolean;
  error: unknown;
  updateSettings: (updates: Partial<Settings>) => Promise<void>;
  resetSettings: () => Promise<void>;
}

type SettingsSelector<TSelected> = (settings: Settings) => TSelected;

export function useAppSettings(): UseAppSettingsReturn {
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: APP_SETTINGS_QUERY_KEY,
    queryFn: () => loadAppSettingsFromStorage(),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const updateSettings = useCallback(
    async (updates: Partial<AppSettings>) => {
      try {
        await saveAppSettings({ queryClient, updates });
      } catch (err) {
        console.error("[AppSettings] Failed to save settings:", err);
        throw err;
      }
    },
    [queryClient],
  );

  const resetSettings = useCallback(async () => {
    try {
      const next = { ...DEFAULT_CLIENT_SETTINGS };
      queryClient.setQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY, next);
      await AsyncStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
    } catch (err) {
      console.error("[AppSettings] Failed to reset settings:", err);
      throw err;
    }
  }, [queryClient]);
  const settings = useMemo(() => normalizeAppSettings(data), [data]);

  return {
    settings,
    isLoading: isPending,
    error: error ?? null,
    updateSettings,
    resetSettings,
  };
}

export function useSettings(): UseSettingsReturn;
export function useSettings<TSelected>(selector: SettingsSelector<TSelected>): TSelected;
export function useSettings(): UseSettingsReturn;
export function useSettings<TSelected>(selector: SettingsSelector<TSelected>): TSelected;
export function useSettings<TSelected>(
  selector?: SettingsSelector<TSelected>,
): UseSettingsReturn | TSelected {
  const appSettings = useAppSettings();
  if (selector) return selector(appSettings.settings);
  return appSettings;
}

export async function persistAppSettings(updates: Partial<AppSettings>): Promise<void> {
  await saveAppSettings({ queryClient: appQueryClient, updates });
}

export async function saveAppSettings(input: {
  queryClient: QueryClient;
  updates: Partial<AppSettings>;
  deps?: SettingsDeps;
}): Promise<void> {
  await saveAppSettingsPure({
    queryClient: input.queryClient,
    updates: input.updates,
    deps: input.deps ?? productionDeps,
  });
}

export async function loadAppSettingsFromStorage(deps?: SettingsDeps): Promise<AppSettings> {
  return loadAppSettingsFromStoragePure(deps ?? productionDeps);
}

export async function loadSettingsFromStorage(deps?: SettingsDeps): Promise<Settings> {
  return loadSettingsFromStoragePure(deps ?? productionDeps);
}
