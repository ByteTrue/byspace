// Port of archive/expo-app:packages/app/src/screens/settings-screen.tsx: the settings sidebar, detail pane, General and About. Same logic, DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/settings-screen.py; edit it directly.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { Switch } from "@/components/ui/switch";
import { useRouter } from "~/app/navigation";
import { useFocusEffect } from "~/app/route-focus";
import { cn } from "cn";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  ArrowLeft,
  Settings,
  Palette,
  Server,
  Network,
  Bot,
  Gauge,
  Info,
  Bell,
  Plus,
  FolderGit2,
  ChevronRight,
} from "lucide-react";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { SidebarSeparator } from "@/components/sidebar/sidebar-separator";
import { HostPicker as SharedHostPicker } from "@/components/hosts/host-picker";
import { HostStatusDot } from "@/components/host-status-dot";
import { ScreenTitle } from "@/components/headers/screen-title";
import { HeaderIconBadge } from "@/components/headers/header-icon-badge";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { AppearanceSection } from "@/screens/settings/appearance/appearance-section";
import {
  useAppSettings,
  parseTerminalScrollbackLines,
  type AppSettings,
  type SendBehavior,
} from "@/hooks/use-settings";
import { useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import {
  orderHostsLocalFirst,
  resolveActiveHostServerId,
  type HostProfile,
} from "@/types/host-connection";
import { BackHeader } from "@/components/headers/back-header";
import { DesktopContentFrame } from "@/components/desktop-window-titlebar";
import { ScreenHeader } from "@/components/headers/screen-header";
import { AddHostMethodModal } from "@/components/add-host-method-modal";
import { AddHostModal } from "@/components/add-host-modal";
import { AddRemoteSshHostModal } from "@/components/add-remote-ssh-host-modal";
import { PairLinkModal } from "@/components/pair-link-modal";
import { Button } from "@/components/ui/button";

import { CommunityLinks } from "@/components/community-links";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  DesktopAboutCardContent,
  DesktopGeneralRows,
} from "@/screens/settings/desktop-app-section";
import { WebPushSection } from "@/screens/settings/web-push-section";
import { resolveAppVersion } from "@/utils/app-version";
import { openChangelog } from "@/changelog";
import { useAppDiagnosticStore } from "@/diagnostics/store";
import { settingsStyles } from "@/styles/settings";
import {
  LANGUAGE_OPTIONS,
  formatLanguageOptionLabel,
  parseAppLanguage,
  type AppLanguage,
  type SupportedLocale,
} from "@/i18n/locales";
import {
  HostConnectionsPage,
  HostAgentsPage,
  HostSettingsPage,
  HostUsagePage,
} from "@/screens/settings/host-page";

import ProjectsScreen from "@/screens/projects-screen";
import ProjectSettingsScreen from "@/screens/project-settings-screen";
import { SETTINGS_DESKTOP_SIDEBAR_WIDTH, useIsCompactFormFactor } from "@/constants/layout";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import {
  buildSettingsHostSectionRoute,
  buildSettingsSectionRoute,
  type HostSectionSlug,
  type SettingsSectionSlug,
} from "@/utils/host-routes";
import { useLastWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { returnFromSettings, type SettingsView } from "@/navigation/settings-navigation";
import { useThemeObject } from "~/app/theme-object";

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

interface SidebarSectionItem {
  id: SettingsSectionSlug;
  labelKey: string;
  icon: ComponentType<{ size: number; color: string }>;
}

const SIDEBAR_SECTION_ITEMS: SidebarSectionItem[] = [
  { id: "general", labelKey: "settings.sections.general", icon: Settings },
  { id: "appearance", labelKey: "settings.sections.appearance", icon: Palette },
  { id: "notifications", labelKey: "settings.sections.notifications", icon: Bell },
  { id: "about", labelKey: "settings.sections.about", icon: Info },
];

interface HostSectionItem {
  id: HostSectionSlug;
  labelKey: string;
  icon: ComponentType<{ size: number; color: string }>;
}

const HOST_SECTION_ITEMS: HostSectionItem[] = [
  { id: "host", labelKey: "settings.hostSections.host", icon: Server },
  { id: "projects", labelKey: "settings.hostSections.projects", icon: FolderGit2 },
  { id: "connections", labelKey: "settings.hostSections.connections", icon: Network },
  { id: "agents", labelKey: "settings.hostSections.agents", icon: Bot },
  { id: "usage", labelKey: "settings.hostSections.usage", icon: Gauge },
];

function renderHostSettingsContent(
  view: Extract<SettingsView, { kind: "host" }>,
  onHostRemoved: () => void,
): ReactNode {
  switch (view.section) {
    case "projects":
      return <ProjectsScreen serverId={view.serverId} />;
    case "connections":
      return <HostConnectionsPage serverId={view.serverId} />;
    case "agents":
      return <HostAgentsPage serverId={view.serverId} />;
    case "usage":
      return <HostUsagePage serverId={view.serverId} />;
    case "host":
      return <HostSettingsPage serverId={view.serverId} onHostRemoved={onHostRemoved} />;
  }
}

// ---------------------------------------------------------------------------
// Trigger + sidebar style helpers
// ---------------------------------------------------------------------------

const THEME_TRIGGER =
  "flex flex-row items-center gap-1 rounded-md border px-2 py-1 active:opacity-85";
const SIDEBAR_ITEM =
  "relative flex min-h-[34px] w-full items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent md:min-h-8";
const SELECTED_INDICATOR =
  "pointer-events-none absolute inset-y-2 left-0 w-0.5 rounded-full bg-foreground";

function getSendBehaviorOptions(t: TFunction) {
  return [
    { value: "interrupt" as const, label: t("settings.general.defaultSend.options.interrupt") },
    { value: "steer" as const, label: t("settings.general.defaultSend.options.steer") },
    { value: "queue" as const, label: t("settings.general.defaultSend.options.queue") },
  ];
}

function getActiveLocale(language: string | undefined): SupportedLocale {
  const parsed = parseAppLanguage(language);
  return parsed && parsed !== "system" ? parsed : "en";
}

// ---------------------------------------------------------------------------
// Section components
// ---------------------------------------------------------------------------

interface GeneralSectionProps {
  settings: AppSettings;
  handleSendBehaviorChange: (behavior: SendBehavior) => void;
  handleLanguageChange: (language: AppLanguage) => void;
  handleTerminalScrollbackLinesChange: (lines: number) => void;
  handleVimKeybindingsChange: (enabled: boolean) => void;
}

interface SendBehaviorMenuItemProps {
  value: SendBehavior;
  label: string;
  selected: boolean;
  onChange: (value: SendBehavior) => void;
}

function SendBehaviorMenuItem({ value, label, selected, onChange }: SendBehaviorMenuItemProps) {
  const handleSelect = useCallback(() => {
    onChange(value);
  }, [onChange, value]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {label}
    </DropdownMenuItem>
  );
}

interface LanguageMenuItemProps {
  value: AppLanguage;
  activeLocale: SupportedLocale;
  selected: boolean;
  onChange: (value: AppLanguage) => void;
}

function LanguageMenuItem({ value, activeLocale, selected, onChange }: LanguageMenuItemProps) {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => {
    onChange(value);
  }, [onChange, value]);
  const option = LANGUAGE_OPTIONS.find((entry) => entry.value === value);
  const label = option
    ? formatLanguageOptionLabel(option, activeLocale, t(option.labelKey))
    : value;

  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {label}
    </DropdownMenuItem>
  );
}

function GeneralSection({
  settings,
  handleSendBehaviorChange,
  handleLanguageChange,
  handleTerminalScrollbackLinesChange,
  handleVimKeybindingsChange,
}: GeneralSectionProps) {
  const { t, i18n } = useTranslation();
  const activeLocale = getActiveLocale(i18n.language);
  const sendBehaviorOptions = useMemo(() => getSendBehaviorOptions(t), [t]);
  const selectedSendBehaviorLabel =
    sendBehaviorOptions.find((option) => option.value === settings.sendBehavior)?.label ??
    settings.sendBehavior;
  const sendBehaviorDescriptionKey = `settings.general.defaultSend.descriptions.${settings.sendBehavior}`;
  const selectedLanguageOption = LANGUAGE_OPTIONS.find(
    (option) => option.value === settings.language,
  );
  const selectedLanguageLabel = selectedLanguageOption
    ? formatLanguageOptionLabel(
        selectedLanguageOption,
        activeLocale,
        t(selectedLanguageOption.labelKey),
      )
    : settings.language;
  const [terminalScrollbackValue, setTerminalScrollbackValue] = useState(
    String(settings.terminalScrollbackLines),
  );

  const handleTerminalScrollbackChangeText = useCallback((value: string) => {
    setTerminalScrollbackValue(value.replace(/[^\d]/g, ""));
  }, []);

  const commitTerminalScrollback = useCallback(() => {
    const parsed = parseTerminalScrollbackLines(terminalScrollbackValue);
    const nextValue = parsed ?? settings.terminalScrollbackLines;
    setTerminalScrollbackValue(String(nextValue));
    if (nextValue !== settings.terminalScrollbackLines) {
      handleTerminalScrollbackLinesChange(nextValue);
    }
  }, [
    handleTerminalScrollbackLinesChange,
    settings.terminalScrollbackLines,
    terminalScrollbackValue,
  ]);

  useEffect(() => {
    setTerminalScrollbackValue(String(settings.terminalScrollbackLines));
  }, [settings.terminalScrollbackLines]);

  return (
    <SettingsSection title={t("settings.general.title")}>
      <div className={settingsStyles.card}>
        <div className={settingsStyles.row}>
          <div className={settingsStyles.rowContent}>
            <span className={settingsStyles.rowTitle}>
              {t("settings.general.defaultSend.label")}
            </span>
            <span className={settingsStyles.rowHint}>{t(sendBehaviorDescriptionKey)}</span>
          </div>
          <DropdownMenu>
            <DropdownTrigger
              accessibilityLabel={`${t("settings.general.defaultSend.label")}: ${selectedSendBehaviorLabel}`}
              className={THEME_TRIGGER}
            >
              <span className="text-sm leading-[normal] text-foreground">
                {selectedSendBehaviorLabel}
              </span>
            </DropdownTrigger>
            <DropdownMenuContent side="bottom" align="end" width={200}>
              {sendBehaviorOptions.map((option) => (
                <SendBehaviorMenuItem
                  key={option.value}
                  value={option.value}
                  label={option.label}
                  selected={settings.sendBehavior === option.value}
                  onChange={handleSendBehaviorChange}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className={cn(settingsStyles.row, settingsStyles.rowBorder)}>
          <div className={settingsStyles.rowContent}>
            <span className={settingsStyles.rowTitle}>{t("settings.general.language.label")}</span>
            <span className={settingsStyles.rowHint}>
              {t("settings.general.language.description")}
            </span>
          </div>
          <DropdownMenu>
            <DropdownTrigger accessibilityLabel={selectedLanguageLabel} className={THEME_TRIGGER}>
              <span className="text-sm leading-[normal] text-foreground">
                {selectedLanguageLabel}
              </span>
            </DropdownTrigger>
            <DropdownMenuContent side="bottom" align="end" width={300}>
              {LANGUAGE_OPTIONS.map((option) => (
                <LanguageMenuItem
                  key={option.value}
                  value={option.value}
                  activeLocale={activeLocale}
                  selected={settings.language === option.value}
                  onChange={handleLanguageChange}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className={cn(settingsStyles.row, settingsStyles.rowBorder)}>
          <div className={settingsStyles.rowContent}>
            <span className={settingsStyles.rowTitle}>
              {t("settings.general.terminalScrollback.label")}
            </span>
            <span className={settingsStyles.rowHint}>
              {t("settings.general.terminalScrollback.description")}
            </span>
          </div>
          <TextInput
            initialValue={terminalScrollbackValue}
            onChangeText={handleTerminalScrollbackChangeText}
            onBlur={commitTerminalScrollback}
            onSubmitEditing={commitTerminalScrollback}
            keyboardType="number-pad"
            inputMode="numeric"
            selectTextOnFocus
            className="min-h-9 rounded-[10px] border border-input bg-transparent px-2.5 py-2 text-foreground placeholder:text-muted-foreground md:min-h-8 md:py-1 dark:bg-input/30 w-28 text-right text-sm"
            accessibilityLabel={t("settings.general.terminalScrollback.accessibilityLabel")}
          />
        </div>
        <div className={cn(settingsStyles.row, settingsStyles.rowBorder)}>
          <div className={settingsStyles.rowContent}>
            <span className={settingsStyles.rowTitle}>{t("settings.editor.vimKeybindings")}</span>
            <span className={settingsStyles.rowHint}>{t("settings.editor.vimHint")}</span>
          </div>
          <Switch
            value={settings.vimKeybindings}
            onValueChange={handleVimKeybindingsChange}
            accessibilityLabel={t("settings.editor.vimKeybindings")}
            testID="vim-keybindings-toggle"
          />
        </div>
        <DesktopGeneralRows />
      </div>
    </SettingsSection>
  );
}

interface AboutSectionProps {
  appVersion: string | null;
  appVersionText: string;
}

function AboutSection({ appVersion, appVersionText }: AboutSectionProps) {
  const { t } = useTranslation();
  const openAppDiagnostic = useAppDiagnosticStore((state) => state.open);
  const whatsNewRow = useMemo(() => <WhatsNewRow />, []);
  const diagnosticRow = useMemo(
    () => (
      <div
        className={cn(settingsStyles.row, settingsStyles.rowBorder)}
        data-testid="app-diagnostic-row"
      >
        <div className={settingsStyles.rowContent}>
          <span className={settingsStyles.rowTitle}>{t("settings.diagnostics.app.rowTitle")}</span>
          <span className={settingsStyles.rowHint}>{t("settings.diagnostics.app.rowHint")}</span>
        </div>
        <Button variant="secondary" size="sm" onPress={openAppDiagnostic}>
          {t("settings.diagnostics.app.run")}
        </Button>
      </div>
    ),
    [openAppDiagnostic, t],
  );
  return (
    <>
      <SettingsSection title={t("settings.about.title")}>
        <div className={settingsStyles.card}>
          <DesktopAboutCardContent
            appVersionText={appVersionText}
            whatsNewRow={whatsNewRow}
            diagnosticRow={diagnosticRow}
          />
        </div>
      </SettingsSection>
      <ConnectedHostsSection clientVersion={appVersion} />
      <div className="mt-4">
        <CommunityLinks />
      </div>
    </>
  );
}

function WhatsNewRow() {
  const { t } = useTranslation();
  const theme = useThemeObject();

  return (
    <button
      type="button"
      className={cn(
        settingsStyles.row,
        settingsStyles.rowBorder,
        "group/whats-new w-full text-left",
      )}
      onClick={openChangelog}
      data-testid="settings-whats-new"
    >
      <span className={settingsStyles.rowContent}>
        <span className={settingsStyles.rowTitle}>{t("changelog.title")}</span>
        <span className={settingsStyles.rowHint}>{t("settings.about.whatsNewHint")}</span>
      </span>
      <ChevronRight
        size={theme.iconSize.sm}
        className="text-muted-foreground group-hover/whats-new:text-foreground"
      />
    </button>
  );
}

function normalizeVersion(version: string | null | undefined): string | null {
  const trimmed = version?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^v/i, "");
}

function ConnectedHostsSection({ clientVersion }: { clientVersion: string | null }) {
  const { t } = useTranslation();
  const hosts = useHosts();
  if (hosts.length === 0) {
    return null;
  }
  return (
    <SettingsSection title={t("settings.about.connectedHosts")}>
      <div className={settingsStyles.card}>
        {hosts.map((host, index) => (
          <HostVersionRow
            key={host.serverId}
            host={host}
            showBorder={index > 0}
            clientVersion={clientVersion}
          />
        ))}
      </div>
    </SettingsSection>
  );
}

function HostVersionRow({
  host,
  showBorder,
  clientVersion,
}: {
  host: HostProfile;
  showBorder: boolean;
  clientVersion: string | null;
}) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(host.serverId);
  const daemonVersion = useSessionStore(
    (state) => state.sessions[host.serverId]?.serverInfo?.version ?? null,
  );

  const normalizedHost = normalizeVersion(daemonVersion);
  const normalizedClient = normalizeVersion(clientVersion);
  const isMismatch =
    normalizedHost !== null && normalizedClient !== null && normalizedHost !== normalizedClient;

  let valueText: string;
  if (!isConnected) {
    valueText = t("settings.about.offline");
  } else if (normalizedHost) {
    valueText = formatVersionWithPrefix(normalizedHost);
  } else {
    valueText = "—";
  }

  return (
    <div className={cn(settingsStyles.row, showBorder && settingsStyles.rowBorder)}>
      <div className={settingsStyles.rowContent}>
        <span className={cn(settingsStyles.rowTitle, "truncate")}>{host.label}</span>
        {isMismatch ? (
          <span className={settingsStyles.rowHint}>{t("settings.about.versionDiffers")}</span>
        ) : null}
      </div>
      <span className={cn("text-sm text-muted-foreground", isMismatch && "text-amber-500")}>
        {valueText}
      </span>
    </div>
  );
}

/** Web: the built-in daemon option never shows (desktop-only affordance). */
function useEnableBuiltInDaemonOption(): { visible: false; onPress: () => void } {
  return { visible: false, onPress: () => undefined };
}

function formatVersionWithPrefix(version: string | null | undefined): string {
  if (!version) return "—";
  return version.startsWith("v") ? version : `v${version}`;
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

/**
 * Local daemon first, then remaining hosts in their existing order.
 */
function useSortedHosts(hosts: HostProfile[], localServerId: string | null): HostProfile[] {
  return useMemo(() => orderHostsLocalFirst(hosts, localServerId), [hosts, localServerId]);
}

interface SidebarSectionButtonProps {
  itemId: SettingsSectionSlug;
  label: string;
  icon: ComponentType<{ size: number; color: string }>;
  isSelected: boolean;
  onSelect: (section: SettingsSectionSlug) => void;
}

function SidebarSectionButton({
  itemId,
  label,
  icon: IconComponent,
  isSelected,
  onSelect,
}: SidebarSectionButtonProps) {
  const theme = useThemeObject();
  const handlePress = useCallback(() => {
    onSelect(itemId);
  }, [onSelect, itemId]);
  return (
    <button
      type="button"
      aria-current={isSelected ? "page" : undefined}
      onClick={handlePress}
      className={cn(SIDEBAR_ITEM, isSelected && "bg-sidebar-accent")}
    >
      {isSelected ? <span aria-hidden className={SELECTED_INDICATOR} /> : null}
      <IconComponent
        size={theme.iconSize.md}
        color={isSelected ? theme.colors.foreground : theme.colors.foregroundMuted}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm text-foreground",
          isSelected && "font-medium",
        )}
      >
        {label}
      </span>
    </button>
  );
}

interface SidebarHostSectionButtonProps {
  itemId: HostSectionSlug;
  label: string;
  icon: ComponentType<{ size: number; color: string }>;
  isSelected: boolean;
  onSelect: (section: HostSectionSlug) => void;
}

function SidebarHostSectionButton({
  itemId,
  label,
  icon: IconComponent,
  isSelected,
  onSelect,
}: SidebarHostSectionButtonProps) {
  const theme = useThemeObject();
  const handlePress = useCallback(() => {
    onSelect(itemId);
  }, [onSelect, itemId]);
  return (
    <button
      type="button"
      aria-current={isSelected ? "page" : undefined}
      onClick={handlePress}
      data-testid={`settings-host-section-${itemId}`}
      className={cn(SIDEBAR_ITEM, isSelected && "bg-sidebar-accent")}
    >
      {isSelected ? <span aria-hidden className={SELECTED_INDICATOR} /> : null}
      <IconComponent
        size={theme.iconSize.md}
        color={isSelected ? theme.colors.foreground : theme.colors.foregroundMuted}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm text-foreground",
          isSelected && "font-medium",
        )}
      >
        {label}
      </span>
    </button>
  );
}

interface HostPickerProps {
  activeServerId: string | null;
  sortedHosts: HostProfile[];
  onSelectHost: (serverId: string) => void;
  onAddHost: () => void;
  enableBuiltInDaemonOption: { visible: boolean; onPress: () => void };
}

/**
 * Scopes the host sections to a host. Reuses the canonical sidebar host
 * switcher pattern (left-sidebar.tsx): a quiet row-styled trigger opening a
 * <Combobox>. The local host is listed first, each row shows the connection it
 * is using right now; an "Add host" row is always reachable from the list —
 * even with a single host.
 */
function HostPicker({
  activeServerId,
  sortedHosts,
  onSelectHost,
  onAddHost,
  enableBuiltInDaemonOption,
}: HostPickerProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const activeHost =
    sortedHosts.find((host) => host.serverId === activeServerId) ?? sortedHosts[0] ?? null;

  const handleOpen = useCallback(() => setIsOpen(true), []);
  const hostOptionTestID = useCallback(
    (serverId: string) => `settings-host-picker-item-${serverId}`,
    [],
  );

  return (
    <SharedHostPicker
      hosts={sortedHosts}
      value={activeServerId ?? ""}
      onSelect={onSelectHost}
      open={isOpen}
      onOpenChange={setIsOpen}
      anchorRef={triggerRef}
      includeAddHost
      onAddHost={onAddHost}
      includeEnableBuiltInDaemon={enableBuiltInDaemonOption.visible}
      onEnableBuiltInDaemon={enableBuiltInDaemonOption.onPress}
      showActiveConnection
      searchable={false}
      title={t("settings.hostPicker.switchHost")}
      desktopMinWidth={240}
      addHostTestID="settings-add-host"
      hostOptionTestID={hostOptionTestID}
    >
      <ComboboxTrigger
        ref={triggerRef}
        block
        className="flex min-h-[34px] w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-sidebar-accent"
        onPress={handleOpen}
        accessibilityLabel={t("settings.hostPicker.switchHost")}
        testID="settings-host-picker"
      >
        {activeHost ? (
          <div className="flex size-4 items-center justify-center">
            <HostStatusDot serverId={activeHost.serverId} />
          </div>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
          {activeHost?.label ?? t("settings.groups.host")}
        </span>
      </ComboboxTrigger>
    </SharedHostPicker>
  );
}

interface SettingsSidebarProps {
  view: SettingsView;
  onSelectSection: (section: SettingsSectionSlug) => void;
  onSelectHostSection: (section: HostSectionSlug) => void;
  onSelectHost: (serverId: string) => void;
  onAddHost: () => void;
  onBackToWorkspace: () => void;
  activeHostServerId: string | null;
  layout: "desktop" | "mobile";
}

function SettingsSidebar({
  view,
  onSelectSection,
  onSelectHostSection,
  onSelectHost,
  onAddHost,
  onBackToWorkspace,
  activeHostServerId,
  layout,
}: SettingsSidebarProps) {
  const theme = useThemeObject();
  const { t } = useTranslation();
  const hosts = useHosts();
  const localServerId = useLocalDaemonServerId();
  const sortedHosts = useSortedHosts(hosts, localServerId);
  const hasHosts = sortedHosts.length > 0;
  const enableBuiltInDaemonOption = useEnableBuiltInDaemonOption();
  const items = SIDEBAR_SECTION_ITEMS;
  const isDesktop = layout === "desktop";
  const selectedSectionId = view.kind === "section" ? view.section : null;
  let selectedHostSection: HostSectionSlug | null = null;
  if (view.kind === "host") selectedHostSection = view.section;
  if (view.kind === "project") selectedHostSection = "projects";

  const sidebarBody = (
    <>
      <div className="flex flex-col gap-1 p-2">
        <span className="px-2 py-1 text-xs font-medium text-muted-foreground">
          {t("settings.groups.app")}
        </span>
        {items.map((item) => (
          <SidebarSectionButton
            key={item.id}
            itemId={item.id}
            label={t(item.labelKey)}
            icon={item.icon}
            isSelected={selectedSectionId === item.id}
            onSelect={onSelectSection}
          />
        ))}
      </div>
      <SidebarSeparator />
      {hasHosts ? (
        <div className="flex flex-col gap-1 p-2">
          <span className="px-2 py-1 text-xs font-medium text-muted-foreground">
            {t("settings.groups.host")}
          </span>
          <HostPicker
            activeServerId={activeHostServerId}
            sortedHosts={sortedHosts}
            onSelectHost={onSelectHost}
            onAddHost={onAddHost}
            enableBuiltInDaemonOption={enableBuiltInDaemonOption}
          />
          {HOST_SECTION_ITEMS.map((item) => (
            <SidebarHostSectionButton
              key={item.id}
              itemId={item.id}
              label={t(item.labelKey)}
              icon={item.icon}
              isSelected={selectedHostSection === item.id}
              onSelect={onSelectHostSection}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-1 p-2">
          <button
            type="button"
            aria-label={t("settings.addHost")}
            onClick={onAddHost}
            data-testid="settings-add-host"
            className={SIDEBAR_ITEM}
          >
            <Plus size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
              {t("settings.addHost")}
            </span>
          </button>
          {enableBuiltInDaemonOption.visible ? (
            <button
              type="button"
              aria-label={t("settings.enableBuiltInDaemon")}
              onClick={enableBuiltInDaemonOption.onPress}
              data-testid="settings-enable-built-in-daemon"
              className={SIDEBAR_ITEM}
            >
              <Server size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {t("settings.enableBuiltInDaemon")}
              </span>
            </button>
          ) : null}
        </div>
      )}
    </>
  );

  return (
    <nav
      aria-label={t("settings.title")}
      className={cn(isDesktop ? "flex shrink-0 flex-col bg-sidebar" : "p-2")}
      style={isDesktop ? SIDEBAR_WIDTH_STYLE : undefined}
      data-testid="settings-sidebar"
    >
      {isDesktop ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative">
            <SidebarHeaderRow
              icon={ArrowLeft}
              label={t("settings.backToWorkspace")}
              onPress={onBackToWorkspace}
              testID="settings-back-to-workspace"
            />
          </div>
          <div
            className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]"
            data-testid="settings-sidebar-scroll-body"
          >
            {sidebarBody}
          </div>
        </div>
      ) : (
        sidebarBody
      )}
    </nav>
  );
}

const SIDEBAR_WIDTH_STYLE = { width: SETTINGS_DESKTOP_SIDEBAR_WIDTH };

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export interface SettingsScreenProps {
  view: SettingsView;
  openAddHostIntent?: string | null;
}

export default function SettingsScreen({ view, openAddHostIntent = null }: SettingsScreenProps) {
  const router = useRouter();
  const theme = useThemeObject();
  const { t } = useTranslation();
  const { settings, isLoading: settingsLoading, updateSettings } = useAppSettings();
  const [isAddHostMethodVisible, setIsAddHostMethodVisible] = useState(false);
  const [isDirectHostVisible, setIsDirectHostVisible] = useState(false);
  const [isRemoteSshVisible, setIsRemoteSshVisible] = useState(false);
  const [isPasteLinkVisible, setIsPasteLinkVisible] = useState(false);
  const lastOpenedAddHostIntentRef = useRef<string | null>(null);
  const appVersion = resolveAppVersion();
  const appVersionText = formatVersionWithPrefix(appVersion);
  const isCompactLayout = useIsCompactFormFactor();
  const hosts = useHosts();
  const localServerId = useLocalDaemonServerId();
  const sortedHosts = useSortedHosts(hosts, localServerId);
  const lastWorkspaceSelection = useLastWorkspaceSelection();
  const routedSettingsHostServerId =
    view.kind === "host" || view.kind === "project" ? view.serverId : null;
  const [selectedSettingsHostServerId, setSelectedSettingsHostServerId] = useState<string | null>(
    routedSettingsHostServerId ?? lastWorkspaceSelection?.serverId ?? null,
  );
  useFocusEffect(
    useCallback(() => {
      setSelectedSettingsHostServerId(
        routedSettingsHostServerId ?? lastWorkspaceSelection?.serverId ?? null,
      );
    }, [lastWorkspaceSelection?.serverId, routedSettingsHostServerId]),
  );

  // The host the four sections scope to: the host on the active view, otherwise
  // the picker choice, otherwise the connected local daemon, otherwise the first host.
  const activeHostServerId = useMemo(() => {
    if (view.kind === "host" || view.kind === "project") return view.serverId;
    return resolveActiveHostServerId({
      selectedServerId: selectedSettingsHostServerId,
      localServerId,
      hosts,
      orderedHosts: sortedHosts,
    });
  }, [view, selectedSettingsHostServerId, localServerId, hosts, sortedHosts]);

  const handleSendBehaviorChange = useCallback(
    (behavior: SendBehavior) => {
      void updateSettings({ sendBehavior: behavior });
    },
    [updateSettings],
  );

  const handleLanguageChange = useCallback(
    (language: AppLanguage) => {
      void updateSettings({ language });
    },
    [updateSettings],
  );

  const handleTerminalScrollbackLinesChange = useCallback(
    (terminalScrollbackLines: number) => {
      void updateSettings({ terminalScrollbackLines });
    },
    [updateSettings],
  );

  const handleVimKeybindingsChange = useCallback(
    (vimKeybindings: boolean) => {
      void updateSettings({ vimKeybindings });
    },
    [updateSettings],
  );

  const closeAddConnectionFlow = useCallback(() => {
    setIsAddHostMethodVisible(false);
    setIsDirectHostVisible(false);
    setIsRemoteSshVisible(false);
    setIsPasteLinkVisible(false);
  }, []);

  const goBackToAddConnectionMethods = useCallback(() => {
    setIsDirectHostVisible(false);
    setIsRemoteSshVisible(false);
    setIsPasteLinkVisible(false);
    setIsAddHostMethodVisible(true);
  }, []);

  const handleAddHost = useCallback(() => {
    setIsAddHostMethodVisible(true);
  }, []);

  useEffect(() => {
    if (!openAddHostIntent || lastOpenedAddHostIntentRef.current === openAddHostIntent) {
      return;
    }
    lastOpenedAddHostIntentRef.current = openAddHostIntent;
    handleAddHost();
  }, [handleAddHost, openAddHostIntent]);

  const handleSelectDirectConnection = useCallback(() => {
    setIsAddHostMethodVisible(false);
    setIsDirectHostVisible(true);
  }, []);

  const handleSelectRemoteSsh = useCallback(() => {
    setIsAddHostMethodVisible(false);
    setIsRemoteSshVisible(true);
  }, []);

  const handleSelectPasteLink = useCallback(() => {
    setIsAddHostMethodVisible(false);
    setIsPasteLinkVisible(true);
  }, []);

  const handleHostAdded = useCallback(
    ({ serverId }: { serverId: string }) => {
      const target = buildSettingsHostSectionRoute(serverId, "connections");
      if (isCompactLayout) {
        router.push(target);
      } else {
        router.replace(target);
      }
    },
    [isCompactLayout, router],
  );

  const handleSelectSection = useCallback(
    (section: SettingsSectionSlug) => {
      const target = buildSettingsSectionRoute(section);
      if (isCompactLayout) {
        router.push(target);
      } else {
        router.replace(target);
      }
    },
    [isCompactLayout, router],
  );

  // Picker: choose the host for host-section rows. If the user is already on a
  // host detail route, keep that detail section and swap only the host segment.
  const handleSelectHost = useCallback(
    (serverId: string) => {
      setSelectedSettingsHostServerId(serverId);
      if (view.kind === "project") {
        const target = buildSettingsHostSectionRoute(serverId, "projects");
        if (isCompactLayout) {
          router.push(target);
        } else {
          router.replace(target);
        }
        return;
      }
      if (view.kind !== "host") {
        return;
      }
      const target = buildSettingsHostSectionRoute(serverId, view.section);
      if (isCompactLayout) {
        router.push(target);
      } else {
        router.replace(target);
      }
    },
    [isCompactLayout, router, view],
  );

  const handleSelectHostSection = useCallback(
    (section: HostSectionSlug) => {
      if (!activeHostServerId) {
        handleAddHost();
        return;
      }
      const target = buildSettingsHostSectionRoute(activeHostServerId, section);
      if (isCompactLayout) {
        router.push(target);
      } else {
        router.replace(target);
      }
    },
    [activeHostServerId, handleAddHost, isCompactLayout, router],
  );

  const handleHostRemoved = useCallback(() => {
    const fallback = buildSettingsSectionRoute("general");
    if (isCompactLayout) {
      router.replace("/settings");
    } else {
      router.replace(fallback);
    }
  }, [isCompactLayout, router]);

  const handleBackFromDetail = useCallback(() => {
    returnFromSettings(view);
  }, [view]);

  const handleBackToWorkspace = useCallback(() => {
    returnFromSettings({ kind: "root" });
  }, []);

  const detailHeader = ((): {
    title: string;
    Icon: ComponentType<{ size: number; color: string }>;
    titleAccessory?: ReactNode;
  } | null => {
    if (view.kind === "host") {
      const item = HOST_SECTION_ITEMS.find((s) => s.id === view.section);
      if (!item) return null;
      return { title: t(item.labelKey), Icon: item.icon };
    }
    if (view.kind === "section") {
      const item = SIDEBAR_SECTION_ITEMS.find((s) => s.id === view.section);
      if (!item) return null;
      return { title: t(item.labelKey), Icon: item.icon };
    }
    if (view.kind === "project") {
      return { title: t("settings.projects"), Icon: FolderGit2 };
    }
    return null;
  })();

  let content: ReactNode;
  if (view.kind === "section" && !SIDEBAR_SECTION_ITEMS.some((item) => item.id === view.section)) {
    // Unknown/retired section slugs fall back to an empty page; the route layer
    // already redirects unknown /settings/* to general.
    content = null;
  } else {
    content = (() => {
      if (view.kind === "host") {
        return renderHostSettingsContent(view, handleHostRemoved);
      }
      if (view.kind === "project") {
        return (
          <ProjectSettingsScreen
            serverId={view.serverId}
            projectId={view.projectId}
            onBackToProjects={handleBackFromDetail}
            showBackToProjects={!isCompactLayout}
          />
        );
      }
      if (view.kind === "section") {
        switch (view.section) {
          case "general":
            return (
              <GeneralSection
                settings={settings}
                handleSendBehaviorChange={handleSendBehaviorChange}
                handleLanguageChange={handleLanguageChange}
                handleTerminalScrollbackLinesChange={handleTerminalScrollbackLinesChange}
                handleVimKeybindingsChange={handleVimKeybindingsChange}
              />
            );
          case "appearance":
            return <AppearanceSection />;
          case "notifications":
            return <WebPushSection />;
          case "about":
            return <AboutSection appVersion={appVersion} appVersionText={appVersionText} />;
        }
      }
      return null;
    })();
  }

  if (settingsLoading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center bg-background">
        <span className="text-sm text-foreground">{t("settings.loading")}</span>
      </div>
    );
  }

  const desktopDetailHeaderLeft = detailHeader ? (
    <>
      <HeaderIconBadge>
        <detailHeader.Icon size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
      </HeaderIconBadge>
      <ScreenTitle testID="settings-detail-header-title">{detailHeader.title}</ScreenTitle>
      {detailHeader.titleAccessory}
    </>
  ) : null;

  const addHostModals = (
    <>
      <AddHostMethodModal
        visible={isAddHostMethodVisible}
        onClose={closeAddConnectionFlow}
        onDirectConnection={handleSelectDirectConnection}
        onRemoteSsh={handleSelectRemoteSsh}
        onPasteLink={handleSelectPasteLink}
      />
      <AddHostModal
        visible={isDirectHostVisible}
        onClose={closeAddConnectionFlow}
        onCancel={goBackToAddConnectionMethods}
        onSaved={handleHostAdded}
      />
      <AddRemoteSshHostModal
        visible={isRemoteSshVisible}
        onClose={closeAddConnectionFlow}
        onCancel={goBackToAddConnectionMethods}
        onSaved={handleHostAdded}
      />
      <PairLinkModal
        visible={isPasteLinkVisible}
        onClose={closeAddConnectionFlow}
        onCancel={goBackToAddConnectionMethods}
        onSaved={handleHostAdded}
      />
    </>
  );

  // Mobile root: full-screen sidebar-as-list.
  if (isCompactLayout && view.kind === "root") {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col bg-sidebar">
        <BackHeader title={t("settings.title")} onBack={handleBackToWorkspace} />
        <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          <SettingsSidebar
            view={view}
            onSelectSection={handleSelectSection}
            onSelectHostSection={handleSelectHostSection}
            onSelectHost={handleSelectHost}
            onAddHost={handleAddHost}
            onBackToWorkspace={handleBackToWorkspace}
            activeHostServerId={activeHostServerId}
            layout="mobile"
          />
        </div>
        {addHostModals}
      </div>
    );
  }

  if (isCompactLayout) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
        <BackHeader
          title={detailHeader?.title}
          titleAccessory={detailHeader?.titleAccessory}
          onBack={handleBackFromDetail}
        />
        <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto flex w-full max-w-[720px] flex-col p-4 pt-6">{content}</div>
        </div>
        {addHostModals}
      </div>
    );
  }

  // Desktop split view — mirrors AppContainer: sidebar owns the titlebar drag
  // region + traffic-light padding; detail pane renders whatever header the
  // selected section provides.
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-sidebar">
      <div className="flex min-h-0 flex-1 flex-row">
        <SettingsSidebar
          view={view}
          onSelectSection={handleSelectSection}
          onSelectHostSection={handleSelectHostSection}
          onSelectHost={handleSelectHost}
          onAddHost={handleAddHost}
          onBackToWorkspace={handleBackToWorkspace}
          activeHostServerId={activeHostServerId}
          layout="desktop"
        />
        <DesktopContentFrame
          enabled
          sidebarCollapsed={false}
          showCollapsedSidebarNav={false}
          testID="settings-detail-pane"
        >
          <ScreenHeader
            borderless={!detailHeader}
            left={desktopDetailHeaderLeft}
            leftClassName="gap-2"
          />
          <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
            <div className="mx-auto flex w-full max-w-[720px] flex-col p-4 pt-6">{content}</div>
          </div>
        </DesktopContentFrame>
      </div>
      {addHostModals}
    </div>
  );
}
