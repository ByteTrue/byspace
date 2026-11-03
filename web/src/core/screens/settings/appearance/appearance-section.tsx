// Port of archive/expo-app:packages/app/src/screens/settings/appearance/appearance-section.tsx: theme, terminal scheme, detail level, fonts, syntax theme. Same logic, DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/appearance-section.py; edit it directly.
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type FocusEvent,
} from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { ChevronDown, Monitor, Moon, Sun } from "lucide-react";
import {
  SYNTAX_THEME_OPTIONS,
  type SyntaxThemeId,
  type SyntaxThemeOption,
} from "@bytetrue/highlight";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SettingsCard, SettingsSwitch } from "@/components/settings";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import {
  MAX_CODE_FONT_SIZE,
  MAX_CONTENT_FONT_SIZE,
  MAX_UI_BASE_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_CONTENT_FONT_SIZE,
  MIN_UI_BASE_FONT_SIZE,
  parseClampedFontSize,
  sanitizeFontFamily,
  useAppSettings,
  type AppSettings,
  TIMELINE_DETAIL_LEVELS,
  type TimelineDetailLevel,
} from "@/hooks/use-settings";
import {
  DEFAULT_MONO_FONT_STACK,
  DEFAULT_UI_FONT_STACK,
  ICON_SIZE,
  THEME_OPTIONS,
  THEME_SWATCHES,
  type Theme,
} from "@/styles/theme";
import { settingsStyles } from "@/styles/settings";
import { AppearancePreview } from "@/screens/settings/appearance/appearance-preview";
import { SidebarNavSection } from "@/screens/settings/appearance/sidebar-nav-section";
import type { CSSProperties } from "react";
import { withTheme } from "~/app/theme-object";
import { Input } from "~/components/ui/input";

function selectOnFocus(event: FocusEvent<HTMLInputElement>): void {
  event.currentTarget.select();
}

// ---------------------------------------------------------------------------
// Theme-reactive leaf icons (withTheme + themeProps color mapping). Icon sizes read the static ICON_SIZE token; the appearance
// feature does not scale icons.
// ---------------------------------------------------------------------------

const ThemedSun = withTheme(Sun);
const ThemedMoon = withTheme(Moon);
const ThemedMonitor = withTheme(Monitor);
const ThemedChevronDown = withTheme(ChevronDown);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

type BuiltInThemePreference = AppSettings["theme"];

function getThemeLabel(t: TFunction, value: BuiltInThemePreference): string {
  return t(`settings.appearance.theme.options.${value}`);
}

// Platform default stacks can be the bare native tokens ("normal"/"monospace");
// those read as a bug, so show a human label in the placeholder instead.
const BARE_DEFAULT_STACKS: ReadonlySet<string> = new Set(["normal", "monospace"]);

function resolveDefaultStackPlaceholder(t: TFunction, stack: string): string {
  return BARE_DEFAULT_STACKS.has(stack) ? t("settings.appearance.fonts.systemDefault") : stack;
}

// Local size string (digits only) -> preview override number. Empty/invalid
// yields undefined so the preview falls back to the committed theme value.
function sizeDraftToOverride(value: string): number | undefined {
  if (value.length === 0) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const TRIGGER = "flex flex-row items-center gap-1 rounded-md border px-2 py-1 active:opacity-85";
const ROW_WITH_BORDER = "flex flex-row items-center justify-between border-t p-4";

// ---------------------------------------------------------------------------
// Theme picker
// ---------------------------------------------------------------------------

interface ThemeLeadingProps {
  themeValue: BuiltInThemePreference;
}

function ThemeLeading({ themeValue }: ThemeLeadingProps) {
  switch (themeValue) {
    case "light":
      return <ThemedSun size={ICON_SIZE.md} themeProps={mutedColorMapping} />;
    case "dark":
      return <ThemedMoon size={ICON_SIZE.md} themeProps={mutedColorMapping} />;
    case "auto":
      return <ThemedMonitor size={ICON_SIZE.md} themeProps={mutedColorMapping} />;
    default:
      return <ThemeSwatch color={THEME_SWATCHES[themeValue]} />;
  }
}

interface ThemeSwatchProps {
  color: string;
}

function ThemeSwatch({ color }: ThemeSwatchProps) {
  const swatchStyle = useMemo<CSSProperties>(() => ({ backgroundColor: color }), [color]);
  return <span className="size-4 shrink-0 rounded-full border" style={swatchStyle} />;
}

interface ThemeMenuItemProps {
  themeValue: BuiltInThemePreference;
  selected: boolean;
  onChange: (theme: BuiltInThemePreference) => void;
}

function ThemeMenuItem({ themeValue, selected, onChange }: ThemeMenuItemProps) {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => {
    onChange(themeValue);
  }, [onChange, themeValue]);
  const leading = useMemo(() => <ThemeLeading themeValue={themeValue} />, [themeValue]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect} leading={leading}>
      {getThemeLabel(t, themeValue)}
    </DropdownMenuItem>
  );
}

interface ThemeRowProps {
  value: AppSettings["theme"];
  onChange: (theme: BuiltInThemePreference) => void;
}

function ThemeRow({ value, onChange }: ThemeRowProps) {
  const { t } = useTranslation();
  const selectedLabel = getThemeLabel(t, value);
  return (
    <div className={settingsStyles.row}>
      <div className={settingsStyles.rowContent}>
        <span className={settingsStyles.rowTitle}>{t("settings.appearance.theme.title")}</span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={TRIGGER}
          accessibilityLabel={t("settings.appearance.theme.accessibilityLabel", {
            value: selectedLabel,
          })}
        >
          <ThemeLeading themeValue={value} />
          <span className="text-sm leading-[normal] text-foreground">{selectedLabel}</span>
          <ThemedChevronDown size={ICON_SIZE.sm} themeProps={mutedColorMapping} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" width={200}>
          {THEME_OPTIONS.map((option, index) => {
            const previousOption = THEME_OPTIONS[index - 1];
            return (
              <Fragment key={option.name}>
                {previousOption && previousOption.group !== option.group ? (
                  <DropdownMenuSeparator />
                ) : null}
                <ThemeMenuItem
                  themeValue={option.name}
                  selected={value === option.name}
                  onChange={onChange}
                />
              </Fragment>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Terminal appearance picker — the terminal's scheme, independent of the app
// theme.
// ---------------------------------------------------------------------------

type TerminalAppearance = AppSettings["terminalAppearance"];

const TERMINAL_APPEARANCE_OPTIONS: readonly TerminalAppearance[] = ["match", "dark", "light"];

function getTerminalAppearanceLabel(t: TFunction, value: TerminalAppearance): string {
  return t(`settings.appearance.terminal.options.${value}`);
}

function TerminalAppearanceLeading({ value }: { value: TerminalAppearance }) {
  switch (value) {
    case "dark":
      return <ThemedMoon size={ICON_SIZE.md} themeProps={mutedColorMapping} />;
    case "light":
      return <ThemedSun size={ICON_SIZE.md} themeProps={mutedColorMapping} />;
    case "match":
      return <ThemedMonitor size={ICON_SIZE.md} themeProps={mutedColorMapping} />;
  }
}

interface TerminalAppearanceMenuItemProps {
  value: TerminalAppearance;
  selected: boolean;
  onChange: (value: TerminalAppearance) => void;
}

function TerminalAppearanceMenuItem({
  value,
  selected,
  onChange,
}: TerminalAppearanceMenuItemProps) {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => onChange(value), [onChange, value]);
  const leading = useMemo(() => <TerminalAppearanceLeading value={value} />, [value]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect} leading={leading}>
      {getTerminalAppearanceLabel(t, value)}
    </DropdownMenuItem>
  );
}

interface TerminalAppearanceRowProps {
  value: TerminalAppearance;
  onChange: (value: TerminalAppearance) => void;
}

function TerminalAppearanceRow({ value, onChange }: TerminalAppearanceRowProps) {
  const { t } = useTranslation();
  const selectedLabel = getTerminalAppearanceLabel(t, value);
  return (
    <div className={settingsStyles.row}>
      <div className={settingsStyles.rowContent}>
        <span className={settingsStyles.rowTitle}>{t("settings.appearance.terminal.title")}</span>
        <span className={settingsStyles.rowHint}>{t("settings.appearance.terminal.hint")}</span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={TRIGGER}
          accessibilityLabel={t("settings.appearance.terminal.accessibilityLabel", {
            value: selectedLabel,
          })}
        >
          <TerminalAppearanceLeading value={value} />
          <span className="text-sm leading-[normal] text-foreground">{selectedLabel}</span>
          <ThemedChevronDown size={ICON_SIZE.sm} themeProps={mutedColorMapping} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" width={200}>
          {TERMINAL_APPEARANCE_OPTIONS.map((option) => (
            <TerminalAppearanceMenuItem
              key={option}
              value={option}
              selected={value === option}
              onChange={onChange}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

interface ChatOutlineRowProps {
  value: boolean;
  onChange: (value: boolean) => void;
}

function ChatOutlineRow({ value, onChange }: ChatOutlineRowProps) {
  const { t } = useTranslation();
  return (
    <SettingsSwitch
      label={t("settings.appearance.chatOutline.title")}
      hint={t("settings.appearance.chatOutline.description")}
      value={value}
      onValueChange={onChange}
    />
  );
}

function getTimelineDetailLevelLabel(t: TFunction, value: TimelineDetailLevel): string {
  return t(`settings.general.timelineDetail.options.${value}`);
}

interface TimelineDetailMenuItemProps {
  value: TimelineDetailLevel;
  selected: boolean;
  onChange: (value: TimelineDetailLevel) => void;
}

function TimelineDetailMenuItem({ value, selected, onChange }: TimelineDetailMenuItemProps) {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => onChange(value), [onChange, value]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {getTimelineDetailLevelLabel(t, value)}
    </DropdownMenuItem>
  );
}

interface TimelineDetailRowProps {
  value: TimelineDetailLevel;
  onChange: (value: TimelineDetailLevel) => void;
}

function TimelineDetailRow({ value, onChange }: TimelineDetailRowProps) {
  const { t } = useTranslation();
  const selectedLabel = getTimelineDetailLevelLabel(t, value);
  return (
    <div className={settingsStyles.row}>
      <div className={settingsStyles.rowContent}>
        <span className={settingsStyles.rowTitle}>
          {t("settings.general.timelineDetail.label")}
        </span>
        <span className={settingsStyles.rowHint}>
          {t("settings.general.timelineDetail.description")}
        </span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={TRIGGER}
          accessibilityLabel={t("settings.general.timelineDetail.accessibilityLabel", {
            value: selectedLabel,
          })}
        >
          <span className="text-sm leading-[normal] text-foreground">{selectedLabel}</span>
          <ThemedChevronDown size={ICON_SIZE.sm} themeProps={mutedColorMapping} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" width={200}>
          {TIMELINE_DETAIL_LEVELS.map((option) => (
            <TimelineDetailMenuItem
              key={option}
              value={option}
              selected={value === option}
              onChange={onChange}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fonts: family text fields + numeric size fields (commit on blur/submit)
// ---------------------------------------------------------------------------

interface FontFamilyRowProps {
  title: string;
  hint: string;
  accessibilityLabel: string;
  placeholder: string;
  value: string;
  draft: string;
  withBorder: boolean;
  onChangeDraft: (value: string) => void;
  onCommit: (value: string) => void;
}

function FontFamilyRow({
  title,
  hint,
  accessibilityLabel,
  placeholder,
  value,
  draft,
  withBorder,
  onChangeDraft,
  onCommit,
}: FontFamilyRowProps) {
  const handleChangeDraftInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onChangeDraft(event.target.value),
    [onChangeDraft],
  );
  const handleCommit = useCallback(() => {
    onCommit(draft);
  }, [draft, onCommit]);
  const handleCommitEnter = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing) handleCommit();
    },
    [handleCommit],
  );

  // Resync from the committed value when it changes elsewhere.
  useEffect(() => {
    onChangeDraft(value);
    // Only resync on external value changes, not on local keystrokes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className={withBorder ? ROW_WITH_BORDER : settingsStyles.row}>
      <div className={settingsStyles.rowContent}>
        <span className={settingsStyles.rowTitle}>{title}</span>
        <span className={settingsStyles.rowHint}>{hint}</span>
      </div>
      <Input
        defaultValue={draft}
        onChange={handleChangeDraftInput}
        onBlur={handleCommit}
        onKeyDown={handleCommitEnter}
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="max-w-[380px] shrink grow text-left text-xs"
        aria-label={accessibilityLabel}
      />
    </div>
  );
}

interface FontSizeRowProps {
  title: string;
  hint: string;
  accessibilityLabel: string;
  draft: string;
  withBorder?: boolean;
  onChangeDraft: (value: string) => void;
  onCommit: () => void;
}

function FontSizeRow({
  title,
  hint,
  accessibilityLabel,
  draft,
  withBorder = true,
  onChangeDraft,
  onCommit,
}: FontSizeRowProps) {
  const handleCommitEnter2 = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing) onCommit();
    },
    [onCommit],
  );
  const handleChangeDraftInput2 = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onChangeDraft(event.target.value),
    [onChangeDraft],
  );
  return (
    <div className={withBorder ? ROW_WITH_BORDER : settingsStyles.row}>
      <div className={settingsStyles.rowContent}>
        <span className={settingsStyles.rowTitle}>{title}</span>
        <span className={settingsStyles.rowHint}>{hint}</span>
      </div>
      <div className="flex flex-row items-center gap-2">
        <Input
          defaultValue={draft}
          onChange={handleChangeDraftInput2}
          onBlur={onCommit}
          onKeyDown={handleCommitEnter2}
          inputMode="numeric"
          onFocus={selectOnFocus}
          className="w-16 text-right"
          aria-label={accessibilityLabel}
        />
        <span className="text-sm text-muted-foreground">px</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Syntax highlight theme picker (commits immediately)
// ---------------------------------------------------------------------------

function syntaxLabelForId(id: SyntaxThemeId): string {
  const option = SYNTAX_THEME_OPTIONS.find((entry) => entry.id === id);
  return option ? option.label : id;
}

interface SyntaxMenuItemProps {
  option: SyntaxThemeOption;
  selected: boolean;
  onChange: (id: SyntaxThemeId) => void;
}

function SyntaxMenuItem({ option, selected, onChange }: SyntaxMenuItemProps) {
  const handleSelect = useCallback(() => {
    onChange(option.id);
  }, [onChange, option.id]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {option.label}
    </DropdownMenuItem>
  );
}

interface SyntaxRowProps {
  value: SyntaxThemeId;
  onChange: (id: SyntaxThemeId) => void;
}

function SyntaxRow({ value, onChange }: SyntaxRowProps) {
  const { t } = useTranslation();
  const selectedLabel = syntaxLabelForId(value);
  return (
    <div className={settingsStyles.row}>
      <div className={settingsStyles.rowContent}>
        <span className={settingsStyles.rowTitle}>
          {t("settings.appearance.syntax.highlightTheme")}
        </span>
        <span className={settingsStyles.rowHint}>
          {t("settings.appearance.syntax.highlightThemeHint")}
        </span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={TRIGGER}
          accessibilityLabel={t("settings.appearance.syntax.highlightThemeAccessibility", {
            value: selectedLabel,
          })}
        >
          <span className="text-sm leading-[normal] text-foreground">{selectedLabel}</span>
          <ThemedChevronDown size={ICON_SIZE.sm} themeProps={mutedColorMapping} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" width={200}>
          {SYNTAX_THEME_OPTIONS.map((option) => (
            <SyntaxMenuItem
              key={option.id}
              option={option}
              selected={value === option.id}
              onChange={onChange}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AppearanceSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const uiFontPlaceholder = resolveDefaultStackPlaceholder(t, DEFAULT_UI_FONT_STACK);
  const monoFontPlaceholder = resolveDefaultStackPlaceholder(t, DEFAULT_MONO_FONT_STACK);

  const [uiFontDraft, setUiFontDraft] = useState(settings.uiFontFamily);
  const [monoFontDraft, setMonoFontDraft] = useState(settings.monoFontFamily);
  const [uiBaseSizeDraft, setUiBaseSizeDraft] = useState(String(settings.uiBaseFontSize));
  const [contentSizeDraft, setContentSizeDraft] = useState(String(settings.contentFontSize));
  const [codeSizeDraft, setCodeSizeDraft] = useState(String(settings.codeFontSize));

  // Resync numeric drafts when the committed value changes elsewhere.
  useEffect(() => {
    setUiBaseSizeDraft(String(settings.uiBaseFontSize));
  }, [settings.uiBaseFontSize]);
  useEffect(() => {
    setContentSizeDraft(String(settings.contentFontSize));
  }, [settings.contentFontSize]);
  useEffect(() => {
    setCodeSizeDraft(String(settings.codeFontSize));
  }, [settings.codeFontSize]);

  const handleThemeChange = useCallback(
    (theme: BuiltInThemePreference) => {
      void updateSettings({ theme });
    },
    [updateSettings],
  );

  const handleTerminalAppearanceChange = useCallback(
    (terminalAppearance: AppSettings["terminalAppearance"]) => {
      void updateSettings({ terminalAppearance });
    },
    [updateSettings],
  );

  const handleSyntaxThemeChange = useCallback(
    (syntaxTheme: SyntaxThemeId) => {
      void updateSettings({ syntaxTheme });
    },
    [updateSettings],
  );

  const handleTimelineDetailLevelChange = useCallback(
    (timelineDetailLevel: TimelineDetailLevel) => {
      void updateSettings({ timelineDetailLevel });
    },
    [updateSettings],
  );

  const handleChatOutlineChange = useCallback(
    (chatOutlineEnabled: boolean) => {
      void updateSettings({ chatOutlineEnabled });
    },
    [updateSettings],
  );

  const commitUiFontFamily = useCallback(
    (value: string) => {
      const sanitized = sanitizeFontFamily(value);
      if (sanitized === null) {
        setUiFontDraft(settings.uiFontFamily);
        return;
      }
      setUiFontDraft(sanitized);
      if (sanitized !== settings.uiFontFamily) {
        void updateSettings({ uiFontFamily: sanitized });
      }
    },
    [settings.uiFontFamily, updateSettings],
  );

  const commitMonoFontFamily = useCallback(
    (value: string) => {
      const sanitized = sanitizeFontFamily(value);
      if (sanitized === null) {
        setMonoFontDraft(settings.monoFontFamily);
        return;
      }
      setMonoFontDraft(sanitized);
      if (sanitized !== settings.monoFontFamily) {
        void updateSettings({ monoFontFamily: sanitized });
      }
    },
    [settings.monoFontFamily, updateSettings],
  );

  const handleUiBaseSizeChange = useCallback((value: string) => {
    setUiBaseSizeDraft(value.replace(/[^\d]/g, ""));
  }, []);

  const handleCodeSizeChange = useCallback((value: string) => {
    setCodeSizeDraft(value.replace(/[^\d]/g, ""));
  }, []);

  const handleContentSizeChange = useCallback((value: string) => {
    setContentSizeDraft(value.replace(/[^\d]/g, ""));
  }, []);

  const commitUiBaseSize = useCallback(() => {
    const parsed = parseClampedFontSize(uiBaseSizeDraft, {
      min: MIN_UI_BASE_FONT_SIZE,
      max: MAX_UI_BASE_FONT_SIZE,
    });
    const next = parsed ?? settings.uiBaseFontSize;
    setUiBaseSizeDraft(String(next));
    if (next !== settings.uiBaseFontSize) {
      void updateSettings({ uiBaseFontSize: next });
    }
  }, [settings.uiBaseFontSize, uiBaseSizeDraft, updateSettings]);

  const commitCodeSize = useCallback(() => {
    const parsed = parseClampedFontSize(codeSizeDraft, {
      min: MIN_CODE_FONT_SIZE,
      max: MAX_CODE_FONT_SIZE,
    });
    const next = parsed ?? settings.codeFontSize;
    setCodeSizeDraft(String(next));
    if (next !== settings.codeFontSize) {
      void updateSettings({ codeFontSize: next });
    }
  }, [codeSizeDraft, settings.codeFontSize, updateSettings]);

  const commitContentSize = useCallback(() => {
    const parsed = parseClampedFontSize(contentSizeDraft, {
      min: MIN_CONTENT_FONT_SIZE,
      max: MAX_CONTENT_FONT_SIZE,
    });
    const next = parsed ?? settings.contentFontSize;
    setContentSizeDraft(String(next));
    if (next !== settings.contentFontSize) {
      void updateSettings({ contentFontSize: next });
    }
  }, [contentSizeDraft, settings.contentFontSize, updateSettings]);

  // Live-while-typing: the in-progress drafts drive the preview without
  // committing to the global theme. Empty/invalid fields fall back to the
  // theme value inside the preview.
  const previewOverrides = useMemo(
    () => ({
      contentFontSize: sizeDraftToOverride(contentSizeDraft),
      monoFontFamily: monoFontDraft,
      codeFontSize: sizeDraftToOverride(codeSizeDraft),
    }),
    [codeSizeDraft, contentSizeDraft, monoFontDraft],
  );

  return (
    <div className="flex flex-col">
      <SettingsSection title={t("settings.appearance.theme.title")}>
        <div className={settingsStyles.card}>
          <ThemeRow value={settings.theme} onChange={handleThemeChange} />
          <TerminalAppearanceRow
            value={settings.terminalAppearance}
            onChange={handleTerminalAppearanceChange}
          />
        </div>
      </SettingsSection>
      <SettingsSection title={t("settings.appearance.detailLevel.title")}>
        <SettingsCard>
          <TimelineDetailRow
            value={settings.timelineDetailLevel}
            onChange={handleTimelineDetailLevelChange}
          />
          <ChatOutlineRow value={settings.chatOutlineEnabled} onChange={handleChatOutlineChange} />
        </SettingsCard>
      </SettingsSection>
      <SidebarNavSection />
      <SettingsSection title={t("settings.appearance.fonts.title")}>
        <div className={settingsStyles.card}>
          <FontFamilyRow
            title={t("settings.appearance.fonts.interfaceFont")}
            hint={t("settings.appearance.fonts.interfaceFontHint")}
            accessibilityLabel={t("settings.appearance.fonts.interfaceFontAccessibility")}
            placeholder={uiFontPlaceholder}
            value={settings.uiFontFamily}
            draft={uiFontDraft}
            withBorder={false}
            onChangeDraft={setUiFontDraft}
            onCommit={commitUiFontFamily}
          />
          <FontSizeRow
            title={t("settings.appearance.fonts.interfaceSize")}
            hint={t("settings.appearance.fonts.interfaceSizeHint")}
            accessibilityLabel={t("settings.appearance.fonts.interfaceSizeAccessibility")}
            draft={uiBaseSizeDraft}
            withBorder
            onChangeDraft={handleUiBaseSizeChange}
            onCommit={commitUiBaseSize}
          />
          <FontSizeRow
            title={t("settings.appearance.fonts.contentSize")}
            hint={t("settings.appearance.fonts.contentSizeHint")}
            accessibilityLabel={t("settings.appearance.fonts.contentSizeAccessibility")}
            draft={contentSizeDraft}
            onChangeDraft={handleContentSizeChange}
            onCommit={commitContentSize}
          />
          <FontFamilyRow
            title={t("settings.appearance.fonts.codeFont")}
            hint={t("settings.appearance.fonts.codeFontHint")}
            accessibilityLabel={t("settings.appearance.fonts.codeFontAccessibility")}
            placeholder={monoFontPlaceholder}
            value={settings.monoFontFamily}
            draft={monoFontDraft}
            withBorder
            onChangeDraft={setMonoFontDraft}
            onCommit={commitMonoFontFamily}
          />
          <FontSizeRow
            title={t("settings.appearance.fonts.codeSize")}
            hint={t("settings.appearance.fonts.codeSizeHint")}
            accessibilityLabel={t("settings.appearance.fonts.codeSizeAccessibility")}
            draft={codeSizeDraft}
            onChangeDraft={handleCodeSizeChange}
            onCommit={commitCodeSize}
          />
        </div>
      </SettingsSection>
      <SettingsSection title={t("settings.appearance.syntax.title")}>
        <div className={settingsStyles.card}>
          <SyntaxRow value={settings.syntaxTheme} onChange={handleSyntaxThemeChange} />
        </div>
        <div className="mt-4">
          <AppearancePreview overrides={previewOverrides} />
        </div>
      </SettingsSection>
    </div>
  );
}
