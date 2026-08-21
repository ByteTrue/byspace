import { isSyntaxThemeId, type SyntaxThemeId } from "@bytetrue/byspace-highlight";
import type { QueryClient } from "@tanstack/react-query";
import { parseAppLanguage, type AppLanguage } from "@/i18n/locales";
import { THEME_OPTIONS, type ThemePreference } from "@/styles/theme";
import {
  DEFAULT_SIDEBAR_CHECKS_DISPLAY,
  parseSidebarChecksDisplay,
  type SidebarChecksDisplay,
} from "@/components/sidebar/display-preferences/checks-display";
import {
  DEFAULT_SIDEBAR_ROW_ITEMS,
  isChecksHiddenByLegacyRowItem,
  parseSidebarRowItems,
  type SidebarRowItems,
} from "@/components/sidebar/display-preferences/row-items";
import { z } from "zod";
import { readValidatedJson } from "@/storage/validated-storage";

export const APP_SETTINGS_KEY = "@byspace:app-settings";
export const APP_SETTINGS_QUERY_KEY = ["app-settings"];
const LEGACY_SETTINGS_KEY = "@byspace:settings";

export type SendBehavior = "interrupt" | "queue";
export type ServiceUrlBehavior = "ask" | "in-app" | "external";
export type WorkspaceTitleSource = "title" | "branch";
export type SidebarWorkspaceTrailing = "diff" | "timestamp" | "none";
export type ToolCallDetailLevel = "overview" | "detailed";

const VALID_THEMES = new Set<string>(THEME_OPTIONS.map((option) => option.name));
const ThemePreferenceSchema = z.enum(THEME_OPTIONS.map((option) => option.name));
const VALID_SERVICE_URL_BEHAVIORS = new Set<ServiceUrlBehavior>(["ask", "in-app", "external"]);
const VALID_WORKSPACE_TITLE_SOURCES = new Set<WorkspaceTitleSource>(["title", "branch"]);
const VALID_SIDEBAR_WORKSPACE_TRAILINGS = new Set<SidebarWorkspaceTrailing>([
  "diff",
  "timestamp",
  "none",
]);
const VALID_TOOL_CALL_DETAIL_LEVELS = new Set<ToolCallDetailLevel>(["overview", "detailed"]);
export const DEFAULT_TERMINAL_SCROLLBACK_LINES = 10_000;
export const MIN_TERMINAL_SCROLLBACK_LINES = 0;
export const MAX_TERMINAL_SCROLLBACK_LINES = 1_000_000;
export const DEFAULT_UI_FONT_SIZE = 16; // == FONT_SIZE.base
export const MIN_UI_FONT_SIZE = 11;
export const MAX_UI_FONT_SIZE = 24;
export const DEFAULT_CODE_FONT_SIZE = 14; // == FONT_SIZE.code (code, diff, and terminal)
export const MIN_CODE_FONT_SIZE = 9;
export const MAX_CODE_FONT_SIZE = 22; // line-height 1.5×22=33 stays safe
export const MAX_FONT_FAMILY_LENGTH = 200;

export interface AppSettings {
  theme: ThemePreference;
  language: AppLanguage;
  sendBehavior: SendBehavior;
  serviceUrlBehavior: ServiceUrlBehavior;
  terminalScrollbackLines: number;
  useLegacyTerminalRenderer: boolean;
  uiFontFamily: string;
  monoFontFamily: string;
  uiFontSize: number; // clamped px, default 16
  codeFontSize: number; // clamped px, default 14 (code, diff, and terminal)
  syntaxTheme: SyntaxThemeId;
  workspaceTitleSource: WorkspaceTitleSource;
  sidebarWorkspaceTrailing: SidebarWorkspaceTrailing;
  sidebarRowItems: SidebarRowItems;
  sidebarChecksDisplay: SidebarChecksDisplay;
  autoExpandReasoning: boolean;
  toolCallDetailLevel: ToolCallDetailLevel;
  chatOutlineEnabled: boolean;
  vimKeybindings: boolean;
}

export type Settings = AppSettings;

const SidebarRowItemsSchema = z.strictObject({
  host: z.boolean().optional(),
  changeRequest: z.boolean().optional(),
  services: z.boolean().optional(),
  checks: z.boolean().optional(),
  scripts: z.boolean().optional(),
});

const StoredAppSettingsSchema = z.strictObject({
  theme: ThemePreferenceSchema.optional(),
  language: z
    .enum(["system", "ar", "en", "es", "fr", "ja", "ko", "pt-BR", "ru", "zh-CN"])
    .optional(),
  sendBehavior: z.enum(["interrupt", "queue"]).optional(),
  serviceUrlBehavior: z.enum(["ask", "in-app", "external"]).optional(),
  terminalScrollbackLines: z.union([z.number(), z.string()]).optional(),
  useLegacyTerminalRenderer: z.boolean().optional(),
  uiFontFamily: z.string().optional(),
  monoFontFamily: z.string().optional(),
  uiFontSize: z.union([z.number(), z.string()]).optional(),
  codeFontSize: z.union([z.number(), z.string()]).optional(),
  syntaxTheme: z.string().refine(isSyntaxThemeId).optional(),
  workspaceTitleSource: z.enum(["title", "branch"]).optional(),
  sidebarWorkspaceTrailing: z.enum(["diff", "timestamp", "none"]).optional(),
  sidebarRowItems: SidebarRowItemsSchema.optional(),
  sidebarChecksDisplay: z.enum(["iconAndText", "icon", "none"]).optional(),
  autoExpandReasoning: z.boolean().optional(),
  toolCallDetailLevel: z.enum(["overview", "detailed"]).optional(),
  compactToolCalls: z.boolean().optional(),
  chatOutlineEnabled: z.boolean().optional(),
  vimKeybindings: z.boolean().optional(),
});

const LegacyRendererSettingsSchema = StoredAppSettingsSchema;

type StoredAppSettings = z.infer<typeof StoredAppSettingsSchema>;

export const DEFAULT_CLIENT_SETTINGS: AppSettings = {
  theme: "auto",
  language: "system",
  sendBehavior: "interrupt",
  serviceUrlBehavior: "ask",
  terminalScrollbackLines: DEFAULT_TERMINAL_SCROLLBACK_LINES,
  useLegacyTerminalRenderer: false,
  uiFontFamily: "",
  monoFontFamily: "",
  uiFontSize: DEFAULT_UI_FONT_SIZE,
  codeFontSize: DEFAULT_CODE_FONT_SIZE,
  syntaxTheme: "one",
  workspaceTitleSource: "title",
  sidebarWorkspaceTrailing: "diff",
  sidebarRowItems: DEFAULT_SIDEBAR_ROW_ITEMS,
  sidebarChecksDisplay: DEFAULT_SIDEBAR_CHECKS_DISPLAY,
  autoExpandReasoning: false,
  toolCallDetailLevel: "detailed",
  chatOutlineEnabled: true,
  vimKeybindings: false,
};

export const DEFAULT_APP_SETTINGS: Settings = DEFAULT_CLIENT_SETTINGS;

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface SettingsDeps {
  storage: KeyValueStorage;
}

export async function saveAppSettings(input: {
  queryClient: QueryClient;
  updates: Partial<AppSettings>;
  deps: SettingsDeps;
}): Promise<void> {
  const storedCurrent =
    input.queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY) ??
    (await loadAppSettingsFromStorage(input.deps));
  const current = normalizeAppSettings(storedCurrent);
  const next = { ...current, ...input.updates };
  input.queryClient.setQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY, next);
  await input.deps.storage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
}

export async function loadAppSettingsFromStorage(deps: SettingsDeps): Promise<AppSettings> {
  try {
    const stored = await readValidatedJson(deps.storage, APP_SETTINGS_KEY, StoredAppSettingsSchema);
    if (stored) {
      return normalizeAppSettings(stored);
    }

    const legacyStored = await readValidatedJson(
      deps.storage,
      LEGACY_SETTINGS_KEY,
      LegacyRendererSettingsSchema,
    );
    if (legacyStored) {
      const next = {
        ...DEFAULT_CLIENT_SETTINGS,
        ...pickAppSettingsFromLegacy(legacyStored),
      } satisfies AppSettings;
      await deps.storage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
      return next;
    }

    await deps.storage.setItem(APP_SETTINGS_KEY, JSON.stringify(DEFAULT_CLIENT_SETTINGS));
    return DEFAULT_CLIENT_SETTINGS;
  } catch (error) {
    console.error("[AppSettings] Failed to load settings:", error);
    throw error;
  }
}

export async function loadSettingsFromStorage(deps: SettingsDeps): Promise<Settings> {
  return await loadAppSettingsFromStorage(deps);
}

export function normalizeAppSettings(value: unknown): AppSettings {
  const result = StoredAppSettingsSchema.safeParse(value);
  return {
    ...DEFAULT_CLIENT_SETTINGS,
    ...pickAppSettings(result.success ? result.data : {}),
  };
}

function parseToolCallDetailLevel(stored: StoredAppSettings): ToolCallDetailLevel | null {
  if (stored.toolCallDetailLevel !== undefined) {
    if (
      typeof stored.toolCallDetailLevel === "string" &&
      VALID_TOOL_CALL_DETAIL_LEVELS.has(stored.toolCallDetailLevel)
    ) {
      return stored.toolCallDetailLevel;
    }
    // COMPAT(toolCallDetailLevelConcise): removed in v0.1.107; legacy "concise" values
    // deliberately follow the unknown-value fallback. Remove after 2027-01-14.
    return "overview";
  }
  if (typeof stored.compactToolCalls === "boolean") {
    // COMPAT(compactToolCalls): migrated in v0.1.105, remove after 2027-01-12.
    return stored.compactToolCalls ? "overview" : "detailed";
  }
  return null;
}

function parseStoredSidebarChecksDisplay(stored: StoredAppSettings): SidebarChecksDisplay | null {
  const display = parseSidebarChecksDisplay(stored.sidebarChecksDisplay);
  if (display !== null) return display;
  // COMPAT(sidebarRowItemsChecks): migrated in v0.5.0, remove after 2027-08-05.
  return isChecksHiddenByLegacyRowItem(stored.sidebarRowItems) ? "none" : null;
}

function pickSidebarAppSettings(stored: StoredAppSettings): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  if (stored.sidebarRowItems !== undefined) {
    result.sidebarRowItems = parseSidebarRowItems(stored.sidebarRowItems);
  }
  const sidebarChecksDisplay = parseStoredSidebarChecksDisplay(stored);
  if (sidebarChecksDisplay !== null) {
    result.sidebarChecksDisplay = sidebarChecksDisplay;
  }
  if (
    typeof stored.sidebarWorkspaceTrailing === "string" &&
    VALID_SIDEBAR_WORKSPACE_TRAILINGS.has(stored.sidebarWorkspaceTrailing)
  ) {
    result.sidebarWorkspaceTrailing = stored.sidebarWorkspaceTrailing;
  }
  return result;
}

// oxlint-disable-next-line complexity
function pickAppSettings(stored: StoredAppSettings): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  if (typeof stored.theme === "string" && VALID_THEMES.has(stored.theme)) {
    result.theme = stored.theme;
  }
  const language = parseAppLanguage(stored.language);
  if (language !== null) {
    result.language = language;
  }
  if (stored.sendBehavior === "interrupt" || stored.sendBehavior === "queue") {
    result.sendBehavior = stored.sendBehavior;
  }
  if (
    typeof stored.serviceUrlBehavior === "string" &&
    VALID_SERVICE_URL_BEHAVIORS.has(stored.serviceUrlBehavior)
  ) {
    result.serviceUrlBehavior = stored.serviceUrlBehavior;
  }
  const terminalScrollbackLines = parseTerminalScrollbackLines(stored.terminalScrollbackLines);
  if (terminalScrollbackLines !== null) {
    result.terminalScrollbackLines = terminalScrollbackLines;
  }
  if (typeof stored.useLegacyTerminalRenderer === "boolean") {
    result.useLegacyTerminalRenderer = stored.useLegacyTerminalRenderer;
  }
  const uiFontFamily = sanitizeFontFamily(stored.uiFontFamily);
  if (uiFontFamily !== null) {
    result.uiFontFamily = uiFontFamily;
  }
  const monoFontFamily = sanitizeFontFamily(stored.monoFontFamily);
  if (monoFontFamily !== null) {
    result.monoFontFamily = monoFontFamily;
  }
  if (typeof stored.syntaxTheme === "string" && isSyntaxThemeId(stored.syntaxTheme)) {
    result.syntaxTheme = stored.syntaxTheme;
  }
  const uiFontSize = parseClampedFontSize(stored.uiFontSize, {
    min: MIN_UI_FONT_SIZE,
    max: MAX_UI_FONT_SIZE,
  });
  if (uiFontSize !== null) {
    result.uiFontSize = uiFontSize;
  }
  const codeFontSize = parseClampedFontSize(stored.codeFontSize, {
    min: MIN_CODE_FONT_SIZE,
    max: MAX_CODE_FONT_SIZE,
  });
  if (codeFontSize !== null) {
    result.codeFontSize = codeFontSize;
  }
  if (typeof stored.vimKeybindings === "boolean") {
    result.vimKeybindings = stored.vimKeybindings;
  }
  if (typeof stored.chatOutlineEnabled === "boolean") {
    result.chatOutlineEnabled = stored.chatOutlineEnabled;
  }
  if (
    typeof stored.workspaceTitleSource === "string" &&
    VALID_WORKSPACE_TITLE_SOURCES.has(stored.workspaceTitleSource)
  ) {
    result.workspaceTitleSource = stored.workspaceTitleSource;
  }
  Object.assign(result, pickSidebarAppSettings(stored));
  if (typeof stored.autoExpandReasoning === "boolean") {
    result.autoExpandReasoning = stored.autoExpandReasoning;
  }
  const toolCallDetailLevel = parseToolCallDetailLevel(stored);
  if (toolCallDetailLevel !== null) {
    result.toolCallDetailLevel = toolCallDetailLevel;
  }
  return result;
}

function pickAppSettingsFromLegacy(
  legacy: z.infer<typeof LegacyRendererSettingsSchema>,
): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  if (legacy.theme === "dark" || legacy.theme === "light" || legacy.theme === "auto") {
    result.theme = legacy.theme;
  }
  return result;
}

export function parseTerminalScrollbackLines(value: unknown): number | null {
  let numericValue = NaN;
  if (typeof value === "number") {
    numericValue = value;
  } else if (typeof value === "string" && value.trim().length > 0) {
    numericValue = Number(value);
  }
  if (!Number.isFinite(numericValue)) {
    return null;
  }
  return Math.min(
    MAX_TERMINAL_SCROLLBACK_LINES,
    Math.max(MIN_TERMINAL_SCROLLBACK_LINES, Math.floor(numericValue)),
  );
}

export function sanitizeFontFamily(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.length > MAX_FONT_FAMILY_LENGTH || /[;{}<>]/.test(trimmed)) return null;
  if ([...trimmed].some((char) => char.charCodeAt(0) <= 0x1f)) return null;
  return trimmed;
}

export function parseClampedFontSize(
  value: unknown,
  bounds: { min: number; max: number },
): number | null {
  let numericValue = NaN;
  if (typeof value === "number") {
    numericValue = value;
  } else if (typeof value === "string" && value.trim().length > 0) {
    numericValue = Number(value);
  }
  if (!Number.isFinite(numericValue)) {
    return null;
  }
  return Math.min(bounds.max, Math.max(bounds.min, Math.floor(numericValue)));
}
