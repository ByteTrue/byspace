import { isSyntaxThemeId, type SyntaxThemeId } from "@bytetrue/highlight";
import type { ActiveTurnBehavior } from "@bytetrue/protocol/messages";
import type { QueryClient } from "@tanstack/react-query";
import type { AppLanguage } from "@/i18n/locales";
import type { SidebarNavPreference } from "@/sidebar-nav/model";
import {
  DEFAULT_SIDEBAR_CHECKS_DISPLAY,
  type SidebarChecksDisplay,
} from "@/components/sidebar/display-preferences/checks-display";
import {
  DEFAULT_SIDEBAR_ROW_ITEMS,
  type SidebarRowItems,
} from "@/components/sidebar/display-preferences/row-items";

import { FONT_SIZE, THEME_OPTIONS, type ThemePreference } from "@/styles/theme";
import { z } from "zod";
import { APP_SETTINGS_KEY } from "./keys";

export { APP_SETTINGS_KEY } from "./keys";
export const APP_SETTINGS_QUERY_KEY = ["app-settings"];

export type SendBehavior = ActiveTurnBehavior | "queue";
export type ReleaseChannel = "stable" | "beta";
export type ServiceUrlBehavior = "ask" | "in-app" | "external";
export type WorkspaceTitleSource = "title" | "branch";
export type PullRequestOpenLocation = "main" | "side" | "explorer";
/** What a sidebar workspace row shows in the space to the right of its title. */
export type SidebarWorkspaceTrailing = "diff" | "timestamp" | "none";
export type ToolCallDetailLevel = "overview" | "detailed";
/**
 * How much of the agent timeline renders expanded; the merged replacement for the retired
 * autoExpandReasoning toggle + toolCallDetailLevel picker.
 * - "overview": tool calls grouped into per-turn summaries, thinking collapsed ("Collapse all")
 * - "detailed": tool calls individually expandable, thinking collapsed ("Collapse details")
 * - "live": detailed + the thinking block at the tail expanded and pinned to its tail ("Show latest thinking")
 * - "thinking": detailed + every thinking block expanded ("Expand all thinking")
 * - "expanded": detailed + every thinking and tool call block expanded ("Expand all")
 */
export type TimelineDetailLevel = "overview" | "detailed" | "live" | "thinking" | "expanded";
/** Every level, in the order the picker shows them. Also the schema's single source of truth. */
export const TIMELINE_DETAIL_LEVELS: [TimelineDetailLevel, ...TimelineDetailLevel[]] = [
  "overview",
  "detailed",
  "live",
  "thinking",
  "expanded",
];
/** The projection/grouping machinery only cares about tool calls, not thinking. */
export function toToolCallDetailLevel(level: TimelineDetailLevel): ToolCallDetailLevel {
  return level === "overview" ? "overview" : "detailed";
}
/** Levels that open every thinking block on their own. */
export function expandsThinking(level: TimelineDetailLevel): boolean {
  return level === "thinking" || level === "expanded";
}
/** Levels that open tool call details on their own. "Expand all" only, not the thinking levels. */
export function expandsToolDetail(level: TimelineDetailLevel): boolean {
  return level === "expanded";
}
/** Terminal scheme independent of the app theme: "match" follows the app theme. */
export type TerminalAppearance = "match" | "dark" | "light";

const THEME_PREFERENCE_NAMES = THEME_OPTIONS.map((option) => option.name) as [
  ThemePreference,
  ...ThemePreference[],
];
const ThemePreferenceSchema = z.enum(THEME_PREFERENCE_NAMES);
/** Where the theme picker lands when the persisted preference cannot be honoured. */
export const DEFAULT_THEME_PREFERENCE = "auto" satisfies ThemePreference;
export const DEFAULT_TERMINAL_SCROLLBACK_LINES = 10_000;
export const MIN_TERMINAL_SCROLLBACK_LINES = 0;
export const MAX_TERMINAL_SCROLLBACK_LINES = 1_000_000;
export const DEFAULT_UI_BASE_FONT_SIZE = FONT_SIZE.base;
export const MIN_UI_BASE_FONT_SIZE = 10;
export const MAX_UI_BASE_FONT_SIZE = 21;
export const DEFAULT_CONTENT_FONT_SIZE = FONT_SIZE.content;
export const MIN_CONTENT_FONT_SIZE = 10;
export const MAX_CONTENT_FONT_SIZE = 21;
export const DEFAULT_CODE_FONT_SIZE = 12; // == FONT_SIZE.code
export const MIN_CODE_FONT_SIZE = 9;
export const MAX_CODE_FONT_SIZE = 22; // line-height 1.5×22=33 stays safe
export const MAX_FONT_FAMILY_LENGTH = 200;

export interface AppSettings {
  theme: ThemePreference;
  terminalAppearance: TerminalAppearance;
  language: AppLanguage;
  sendBehavior: SendBehavior;
  serviceUrlBehavior: ServiceUrlBehavior;
  terminalScrollbackLines: number;
  uiFontFamily: string; // "" = platform default UI stack
  monoFontFamily: string; // "" = platform default mono stack
  uiBaseFontSize: number; // clamped px, platform default 14 or 15
  contentFontSize: number; // clamped px, platform default 15 or 16
  codeFontSize: number; // clamped px, default 12
  syntaxTheme: SyntaxThemeId; // default "one"
  workspaceTitleSource: WorkspaceTitleSource;
  sidebarWorkspaceTrailing: SidebarWorkspaceTrailing;
  sidebarRowItems: SidebarRowItems;
  sidebarChecksDisplay: SidebarChecksDisplay;
  /** Top-level sidebar rows in display order; empty means the default order, all visible. */
  sidebarNavItems: SidebarNavPreference[];
  timelineDetailLevel: TimelineDetailLevel;
  chatOutlineEnabled: boolean;
  vimKeybindings: boolean;
  /** Desktop-only preferences for implicit opens into the ordinary side pane. */
  openInSidePane: OpenInSidePanePreferences;
  pullRequestOpenLocation: PullRequestOpenLocation;
  /** Project view key → server id to preselect in New workspace's host picker; "" key unused. */
  defaultHostByProject: Record<string, string>;
  /** Project view key → isolation mode to preselect in New workspace; "" key unused. */
  newWorkspaceIsolationByProject: Record<string, "local" | "worktree">;
  /** Project view key → base branch to preselect for new worktrees; "" key unused. */
  defaultBaseBranchByProject: Record<string, string>;
}

export type AppSettingsUpdate =
  | Partial<AppSettings>
  | ((current: AppSettings) => Partial<AppSettings>);

export interface OpenInSidePanePreferences {
  explorerFiles: boolean;
  diffs: boolean;
  chatFiles: boolean;
  diffFiles: boolean;
  subagents: boolean;
}

export const DEFAULT_OPEN_IN_SIDE_PANE_PREFERENCES: OpenInSidePanePreferences = {
  explorerFiles: false,
  diffs: false,
  chatFiles: false,
  diffFiles: false,
  subagents: false,
};

export interface Settings extends AppSettings {
  manageBuiltInDaemon: boolean;
  releaseChannel: ReleaseChannel;
}

export const DEFAULT_CLIENT_SETTINGS: AppSettings = {
  theme: DEFAULT_THEME_PREFERENCE,
  terminalAppearance: "match",
  language: "system",
  sendBehavior: "steer",
  serviceUrlBehavior: "ask",
  terminalScrollbackLines: DEFAULT_TERMINAL_SCROLLBACK_LINES,
  uiFontFamily: "",
  monoFontFamily: "",
  uiBaseFontSize: DEFAULT_UI_BASE_FONT_SIZE,
  contentFontSize: DEFAULT_CONTENT_FONT_SIZE,
  codeFontSize: DEFAULT_CODE_FONT_SIZE,
  syntaxTheme: "one",
  workspaceTitleSource: "title",
  sidebarWorkspaceTrailing: "diff",
  sidebarRowItems: DEFAULT_SIDEBAR_ROW_ITEMS,
  sidebarChecksDisplay: DEFAULT_SIDEBAR_CHECKS_DISPLAY,
  sidebarNavItems: [],
  timelineDetailLevel: "detailed",
  chatOutlineEnabled: true,
  vimKeybindings: false,
  openInSidePane: DEFAULT_OPEN_IN_SIDE_PANE_PREFERENCES,
  pullRequestOpenLocation: "explorer",
  defaultHostByProject: {},
  newWorkspaceIsolationByProject: {},
  defaultBaseBranchByProject: {},
};

export const DEFAULT_APP_SETTINGS: Settings = {
  ...DEFAULT_CLIENT_SETTINGS,
  manageBuiltInDaemon: true,
  releaseChannel: "stable",
};

function clampedNumber(min: number, max: number) {
  return z
    .unknown()
    .transform((value) => parseClampedFontSize(value, { min, max }))
    .pipe(z.number());
}

function sanitizedFontFamily() {
  return z.unknown().transform(sanitizeFontFamily).pipe(z.string());
}

const SidebarRowItemsSchema = z
  .looseObject({
    branch: z.boolean().catch(DEFAULT_SIDEBAR_ROW_ITEMS.branch),
    project: z.boolean().catch(DEFAULT_SIDEBAR_ROW_ITEMS.project),
    host: z.boolean().catch(DEFAULT_SIDEBAR_ROW_ITEMS.host),
    changeRequest: z.boolean().catch(DEFAULT_SIDEBAR_ROW_ITEMS.changeRequest),
    services: z.boolean().catch(DEFAULT_SIDEBAR_ROW_ITEMS.services),
    labels: z.boolean().catch(DEFAULT_SIDEBAR_ROW_ITEMS.labels),
  })
  .catch(DEFAULT_SIDEBAR_ROW_ITEMS);

const StoredAppSettingsSchema = z
  .looseObject({
    theme: ThemePreferenceSchema.catch(DEFAULT_THEME_PREFERENCE),
    terminalAppearance: z.enum(["match", "dark", "light"]).catch("match"),
    language: z.enum(["system", "en", "zh-CN"]).catch("system"),
    sendBehavior: z.enum(["interrupt", "steer", "queue"]).catch("steer"),
    serviceUrlBehavior: z.enum(["ask", "in-app", "external"]).catch("ask"),
    terminalScrollbackLines: clampedNumber(
      MIN_TERMINAL_SCROLLBACK_LINES,
      MAX_TERMINAL_SCROLLBACK_LINES,
    ).catch(DEFAULT_TERMINAL_SCROLLBACK_LINES),
    uiFontFamily: sanitizedFontFamily().catch(""),
    monoFontFamily: sanitizedFontFamily().catch(""),
    uiBaseFontSize: clampedNumber(MIN_UI_BASE_FONT_SIZE, MAX_UI_BASE_FONT_SIZE).catch(
      DEFAULT_UI_BASE_FONT_SIZE,
    ),
    contentFontSize: clampedNumber(MIN_CONTENT_FONT_SIZE, MAX_CONTENT_FONT_SIZE).catch(
      DEFAULT_CONTENT_FONT_SIZE,
    ),
    codeFontSize: clampedNumber(MIN_CODE_FONT_SIZE, MAX_CODE_FONT_SIZE).catch(
      DEFAULT_CODE_FONT_SIZE,
    ),
    syntaxTheme: z.string().refine(isSyntaxThemeId).catch("one"),
    workspaceTitleSource: z.enum(["title", "branch"]).catch("title"),
    sidebarWorkspaceTrailing: z.enum(["diff", "timestamp", "none"]).catch("diff"),
    sidebarRowItems: SidebarRowItemsSchema,
    sidebarChecksDisplay: z
      .enum(["iconAndText", "icon", "none"])
      .catch(DEFAULT_SIDEBAR_CHECKS_DISPLAY),
    sidebarNavItems: z.array(z.object({ key: z.string(), visible: z.boolean() })).catch([]),
    timelineDetailLevel: z.enum(TIMELINE_DETAIL_LEVELS).catch("detailed"),
    chatOutlineEnabled: z.boolean().catch(true),
    vimKeybindings: z.boolean().catch(false),
    openInSidePane: z
      .object({
        explorerFiles: z.boolean().catch(false),
        diffs: z.boolean().catch(false),
        chatFiles: z.boolean().catch(false),
        diffFiles: z.boolean().catch(false),
        subagents: z.boolean().catch(false),
      })
      .catch(DEFAULT_OPEN_IN_SIDE_PANE_PREFERENCES),
    pullRequestOpenLocation: z.enum(["main", "side", "explorer"]).catch("explorer"),
    defaultHostByProject: z.record(z.string(), z.string()).catch({}),
    newWorkspaceIsolationByProject: z.record(z.string(), z.enum(["local", "worktree"])).catch({}),
    defaultBaseBranchByProject: z.record(z.string(), z.string()).catch({}),
  })
  .catch(DEFAULT_CLIENT_SETTINGS as AppSettings & Record<string, unknown>);

type StoredAppSettings = z.output<typeof StoredAppSettingsSchema>;

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
  updates: AppSettingsUpdate;
  deps: SettingsDeps;
}): Promise<void> {
  const storedCurrent =
    input.queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY) ??
    (await loadAppSettingsFromStorage(input.deps));
  const current = normalizeAppSettings(storedCurrent);
  const updates = typeof input.updates === "function" ? input.updates(current) : input.updates;
  const next = { ...current, ...updates };
  input.queryClient.setQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY, next);
  await writeAppSettings(
    input.deps.storage,
    (await readSettingsObject(input.deps.storage, APP_SETTINGS_KEY)) ??
      StoredAppSettingsSchema.parse({}),
    next,
  );
}

export async function loadAppSettingsFromStorage(deps: SettingsDeps): Promise<AppSettings> {
  try {
    const stored = await readSettingsObject(deps.storage, APP_SETTINGS_KEY);
    return normalizeAppSettings(stored ?? StoredAppSettingsSchema.parse({}));
  } catch (error) {
    console.error("[AppSettings] Failed to load settings:", error);
    throw error;
  }
}

export async function loadSettingsFromStorage(deps: SettingsDeps): Promise<Settings> {
  const appSettings = await loadAppSettingsFromStorage(deps);

  // Desktop settings are retired (issue 025 A3): the web client never loads them.
  return {
    ...DEFAULT_APP_SETTINGS,
    ...appSettings,
  };
}

export function normalizeAppSettings(value: unknown): AppSettings {
  // Renderer-owned fields (desktop daemon management) must not leak into app settings.
  const {
    manageBuiltInDaemon: _manageBuiltInDaemon,
    releaseChannel: _releaseChannel,
    ...settings
  } = StoredAppSettingsSchema.parse(value);
  return settings;
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

export function sanitizeFontFamily(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return ""; // explicit empty = default
  }
  if (trimmed.length > MAX_FONT_FAMILY_LENGTH) {
    return null;
  }
  if (/[;{}<>]/.test(trimmed)) {
    return null; // would break the web CSS font-family declaration
  }
  if ([...trimmed].some((char) => char.charCodeAt(0) <= 0x1f)) {
    return null; // control chars would corrupt the font-family string
  }
  return trimmed; // quotes/commas are legit in stacks
}

async function readSettingsObject(
  storage: KeyValueStorage,
  key: string,
): Promise<StoredAppSettings | null> {
  const raw = await storage.getItem(key);
  if (raw === null) {
    return null;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    console.warn(`[AppSettings] Removing corrupt ${key}: invalid JSON.`);
    await storage.removeItem(key);
    return null;
  }
  return StoredAppSettingsSchema.parse(decoded);
}

async function writeAppSettings(
  storage: KeyValueStorage,
  stored: StoredAppSettings,
  settings: AppSettings,
): Promise<void> {
  await storage.setItem(
    APP_SETTINGS_KEY,
    JSON.stringify({
      ...stored,
      ...settings,
      sidebarRowItems: { ...stored.sidebarRowItems, ...settings.sidebarRowItems },
    }),
  );
}
