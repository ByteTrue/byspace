// Port of archive/expo-app:packages/app/src/screens/settings-screen.tsx: the settings sidebar, detail pane, General and About. Same logic, DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/settings-screen.py; edit it directly.
import { SidebarSlotPortal } from "~/app/sidebar-slot";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type FocusEvent,
} from "react";
import type { ComponentType, ReactNode } from "react";
import { Switch } from "~/components/ui/switch";
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
  ChevronsUpDown,
  type LucideIcon,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "~/components/ui/sidebar";
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
import { ScreenHeader } from "@/components/headers/screen-header";
import { AddHostMethodModal } from "@/components/add-host-method-modal";
import { AddHostModal } from "@/components/add-host-modal";
import { AddRemoteSshHostModal } from "@/components/add-remote-ssh-host-modal";
import { PairLinkModal } from "@/components/pair-link-modal";
import { Button } from "~/components/ui/button";

import { CommunityLinks } from "@/components/community-links";
import {
  DesktopAboutCardContent,
  DesktopGeneralRows,
} from "@/screens/settings/desktop-app-section";
import { WebPushSection } from "@/screens/settings/web-push-section";
import { resolveAppVersion } from "@/utils/app-version";
import { openChangelog } from "@/changelog";
import { useAppDiagnosticStore } from "@/diagnostics/store";
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
import { useIsCompactFormFactor } from "@/constants/layout";
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
import { Input } from "~/components/ui/input";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "~/components/ui/item";

function selectOnFocus(event: FocusEvent<HTMLInputElement>): void {
  event.currentTarget.select();
}

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

interface SidebarSectionItem {
  id: SettingsSectionSlug;
  labelKey: string;
  icon: LucideIcon;
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
  icon: LucideIcon;
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
  const handleSendBehaviorValue = useCallback(
    (value: string) => {
      const option = sendBehaviorOptions.find((candidate) => candidate.value === value);
      if (option) handleSendBehaviorChange(option.value);
    },
    [handleSendBehaviorChange, sendBehaviorOptions],
  );
  const handleLanguageValue = useCallback(
    (value: string) => {
      const option = LANGUAGE_OPTIONS.find((candidate) => candidate.value === value);
      if (option) handleLanguageChange(option.value);
    },
    [handleLanguageChange],
  );
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
  const handleTerminalScrollbackInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      handleTerminalScrollbackChangeText(event.target.value),
    [handleTerminalScrollbackChangeText],
  );

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
  const handleCommitTerminalScrollbackEnter = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing) commitTerminalScrollback();
    },
    [commitTerminalScrollback],
  );

  useEffect(() => {
    setTerminalScrollbackValue(String(settings.terminalScrollbackLines));
  }, [settings.terminalScrollbackLines]);

  return (
    <SettingsSection title={t("settings.general.title")}>
      <ItemGroup>
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>{t("settings.general.defaultSend.label")}</ItemTitle>
            <ItemDescription>{t(sendBehaviorDescriptionKey)}</ItemDescription>
          </ItemContent>
          <Select value={settings.sendBehavior} onValueChange={handleSendBehaviorValue}>
            <SelectTrigger
              aria-label={`${t("settings.general.defaultSend.label")}: ${selectedSendBehaviorLabel}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {sendBehaviorOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Item>
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>{t("settings.general.language.label")}</ItemTitle>
            <ItemDescription>{t("settings.general.language.description")}</ItemDescription>
          </ItemContent>
          <Select value={settings.language} onValueChange={handleLanguageValue}>
            <SelectTrigger aria-label={selectedLanguageLabel}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {LANGUAGE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {formatLanguageOptionLabel(option, activeLocale, t(option.labelKey))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Item>
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>{t("settings.general.terminalScrollback.label")}</ItemTitle>
            <ItemDescription>
              {t("settings.general.terminalScrollback.description")}
            </ItemDescription>
          </ItemContent>
          <Input
            defaultValue={terminalScrollbackValue}
            onChange={handleTerminalScrollbackInput}
            onBlur={commitTerminalScrollback}
            onKeyDown={handleCommitTerminalScrollbackEnter}
            inputMode="numeric"
            onFocus={selectOnFocus}
            className="w-28 text-right"
            aria-label={t("settings.general.terminalScrollback.accessibilityLabel")}
          />
        </Item>
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>{t("settings.editor.vimKeybindings")}</ItemTitle>
            <ItemDescription>{t("settings.editor.vimHint")}</ItemDescription>
          </ItemContent>
          <Switch
            checked={settings.vimKeybindings}
            onCheckedChange={handleVimKeybindingsChange}
            aria-label={t("settings.editor.vimKeybindings")}
            data-testid="vim-keybindings-toggle"
          />
        </Item>
        <DesktopGeneralRows />
      </ItemGroup>
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
      <Item variant="outline" data-testid="app-diagnostic-row">
        <ItemContent>
          <ItemTitle>{t("settings.diagnostics.app.rowTitle")}</ItemTitle>
          <ItemDescription>{t("settings.diagnostics.app.rowHint")}</ItemDescription>
        </ItemContent>
        <Button variant="secondary" size="sm" onClick={openAppDiagnostic}>
          {t("settings.diagnostics.app.run")}
        </Button>
      </Item>
    ),
    [openAppDiagnostic, t],
  );
  return (
    <>
      <SettingsSection title={t("settings.about.title")}>
        <ItemGroup>
          <DesktopAboutCardContent
            appVersionText={appVersionText}
            whatsNewRow={whatsNewRow}
            diagnosticRow={diagnosticRow}
          />
        </ItemGroup>
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
    <Item asChild variant="outline" className="group/whats-new w-full text-left">
      <button type="button" onClick={openChangelog} data-testid="settings-whats-new">
        <ItemContent>
          <ItemTitle>{t("changelog.title")}</ItemTitle>
          <ItemDescription>{t("settings.about.whatsNewHint")}</ItemDescription>
        </ItemContent>
        <ChevronRight
          size={theme.iconSize.sm}
          className="text-muted-foreground group-hover/whats-new:text-foreground"
        />
      </button>
    </Item>
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
      <ItemGroup>
        {hosts.map((host) => (
          <HostVersionRow key={host.serverId} host={host} clientVersion={clientVersion} />
        ))}
      </ItemGroup>
    </SettingsSection>
  );
}

function HostVersionRow({
  host,
  clientVersion,
}: {
  host: HostProfile;
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
    <Item variant="outline">
      <ItemContent>
        <ItemTitle className="truncate">{host.label}</ItemTitle>
        {isMismatch ? (
          <ItemDescription>{t("settings.about.versionDiffers")}</ItemDescription>
        ) : null}
      </ItemContent>
      <span className={cn("text-sm text-muted-foreground", isMismatch && "text-amber-500")}>
        {valueText}
      </span>
    </Item>
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
  icon: LucideIcon;
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
  const handlePress = useCallback(() => {
    onSelect(itemId);
  }, [onSelect, itemId]);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isSelected}
        aria-current={isSelected ? "page" : undefined}
        onClick={handlePress}
      >
        <IconComponent />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

interface SidebarHostSectionButtonProps {
  itemId: HostSectionSlug;
  label: string;
  icon: LucideIcon;
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
  const handlePress = useCallback(() => {
    onSelect(itemId);
  }, [onSelect, itemId]);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isSelected}
        aria-current={isSelected ? "page" : undefined}
        onClick={handlePress}
        data-testid={`settings-host-section-${itemId}`}
      >
        <IconComponent />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
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
      <SidebarMenuItem>
        <SidebarMenuButton
          ref={triggerRef}
          onClick={handleOpen}
          aria-label={t("settings.hostPicker.switchHost")}
          data-testid="settings-host-picker"
        >
          {activeHost ? (
            <span className="flex size-4 items-center justify-center">
              <HostStatusDot serverId={activeHost.serverId} />
            </span>
          ) : null}
          <span>{activeHost?.label ?? t("settings.groups.host")}</span>
          <ChevronsUpDown className="ml-auto" />
        </SidebarMenuButton>
      </SidebarMenuItem>
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
      <SidebarGroup>
        <SidebarGroupLabel>{t("settings.groups.app")}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
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
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarSeparator />
      <SidebarGroup>
        {hasHosts ? (
          <>
            <SidebarGroupLabel>{t("settings.groups.host")}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
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
              </SidebarMenu>
            </SidebarGroupContent>
          </>
        ) : (
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={onAddHost} data-testid="settings-add-host">
                  <Plus />
                  <span>{t("settings.addHost")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {enableBuiltInDaemonOption.visible ? (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={enableBuiltInDaemonOption.onPress}
                    data-testid="settings-enable-built-in-daemon"
                  >
                    <Server />
                    <span>{t("settings.enableBuiltInDaemon")}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : null}
            </SidebarMenu>
          </SidebarGroupContent>
        )}
      </SidebarGroup>
    </>
  );

  if (!isDesktop) {
    return (
      <nav aria-label={t("settings.title")} className="p-2" data-testid="settings-sidebar">
        {sidebarBody}
      </nav>
    );
  }
  // Rendered into the app's desktop sidebar (SidebarSlotPortal), which owns its width and rail.
  return (
    <nav
      aria-label={t("settings.title")}
      className="flex min-h-0 flex-1 flex-col"
      data-testid="settings-sidebar"
    >
      <SidebarHeader>
        <SidebarHeaderRow
          icon={ArrowLeft}
          label={t("settings.backToWorkspace")}
          onPress={onBackToWorkspace}
          testID="settings-back-to-workspace"
        />
      </SidebarHeader>
      <SidebarContent data-testid="settings-sidebar-scroll-body">{sidebarBody}</SidebarContent>
    </nav>
  );
}

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

  // Desktop: the navigation goes into the app's sidebar and the detail fills the app's inset
  // card, the same frame every other route has.
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="settings-detail-pane">
      <SidebarSlotPortal>
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
      </SidebarSlotPortal>
      <ScreenHeader
        borderless={!detailHeader}
        left={desktopDetailHeaderLeft}
        leftClassName="gap-2"
      />
      <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-[720px] flex-col p-4 pt-6">{content}</div>
      </div>
      {addHostModals}
    </div>
  );
}
