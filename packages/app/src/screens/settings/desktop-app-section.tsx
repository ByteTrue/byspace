import { useCallback, useEffect, useState } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { Switch } from "@/components/ui/switch";
import { isWeb } from "@/constants/platform";
import { settingsStyles } from "@/styles/settings";

type KeepAwakeLevel = "off" | "system" | "display";

interface DesktopPreferences {
  keepAwake?: KeepAwakeLevel;
  hideFromDock: boolean;
  lightweight: boolean;
  noAutoUpdate: boolean;
  noAutoDownload: boolean;
  autoRestart: boolean;
}

interface DaemonHostStatus {
  inProcess: boolean;
  healthy: boolean;
  addr: string;
  runningVersion?: string;
  externalPid?: number;
  externalPath?: string;
  reason?: string;
}

interface CLIShellStatus {
  name: string;
  default?: boolean;
  command?: string;
  ours: boolean;
  profile?: string;
}

interface CLIStatus {
  exe: string;
  command?: string;
  ours: boolean;
  dir?: string;
  shells: CLIShellStatus[];
  windows?: boolean;
}

interface UpdateStatusSnapshot {
  state: string;
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  downloaded?: number;
  total?: number;
  error?: string;
}

interface DesktopSettingsResponse {
  desktop?: boolean;
  platform?: string;
  settings?: DesktopPreferences;
  openAtLogin?: boolean;
  daemonStatus?: DaemonHostStatus;
  backupCount?: number;
  configFolder?: string;
  configFolderFull?: string;
  cliStatus?: CLIStatus;
  update?: UpdateStatusSnapshot;
}

const KEEP_AWAKE_LEVELS: readonly KeepAwakeLevel[] = ["system", "display", "off"];

function isWailsDesktopContainer(): boolean {
  if (!isWeb || typeof window === "undefined") {
    return false;
  }
  const isWailsOrigin =
    window.location?.protocol === "wails:" ||
    window.location?.hostname === "wails.localhost" ||
    "wails" in window;
  if (!isWailsOrigin) {
    return false;
  }
  const ua = window.navigator?.userAgent ?? "";
  return !/android|iphone|ipad|ipod/i.test(ua);
}

function formatMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function formatDownloadingProgress(isZh: boolean, upd: UpdateStatusSnapshot): string {
  const done = upd.downloaded ?? 0;
  const total = upd.total ?? 0;
  const ver = upd.latestVersion ? ` v${upd.latestVersion}` : "";
  if (total > 0) {
    const pct = Math.min(100, Math.round((done * 100) / total));
    return isZh
      ? `正在下载${ver}… ${pct}% (${formatMegabytes(done)} / ${formatMegabytes(total)} MB)`
      : `Downloading${ver}… ${pct}% (${formatMegabytes(done)} / ${formatMegabytes(total)} MB)`;
  }
  return isZh
    ? `正在下载${ver}… (${formatMegabytes(done)} MB)`
    : `Downloading${ver}… (${formatMegabytes(done)} MB)`;
}

function resolveVersionSubtitle(isZh: boolean, upd?: UpdateStatusSnapshot): string {
  if (!upd) {
    return isZh ? "检查并安装客户端更新" : "Check for and install client updates";
  }
  switch (upd.state) {
    case "checking":
      return isZh ? "正在检查更新…" : "Checking for updates…";
    case "downloading":
      return formatDownloadingProgress(isZh, upd);
    case "ready":
      return isZh
        ? `${upd.latestVersion ?? ""} 已下载就绪`
        : `${upd.latestVersion ?? ""} is downloaded`;
    case "found":
      return isZh
        ? `发现新版本 v${upd.latestVersion ?? ""}`
        : `v${upd.latestVersion ?? ""} is available`;
    case "error":
      return isZh
        ? `检查或下载更新失败${upd.error ? ": " + upd.error : ""}`
        : `Update failed${upd.error ? ": " + upd.error : ""}`;
    default:
      return isZh ? "已是最新版本" : "Up to date";
  }
}

function resolveVersionActionLabel(isZh: boolean, state?: string): string {
  if (state === "ready") {
    return isZh ? "重启以更新" : "Restart to update";
  }
  if (state === "found") {
    return isZh ? "下载更新" : "Download update";
  }
  if (state === "downloading") {
    return isZh ? "下载中…" : "Downloading…";
  }
  if (state === "checking") {
    return isZh ? "检查中…" : "Checking…";
  }
  return isZh ? "检查更新" : "Check for updates";
}

function resolveAutoDownloadHint(isZh: boolean, enabled: boolean): string {
  if (isZh) {
    return enabled
      ? "发现新版本后立即在后台下载。使用按流量计费的网络或代理时可以关闭。"
      : "已关闭：发现新版本时不会自动下载，点击上方「下载更新」后才下载。";
  }
  return enabled
    ? "Downloads a newer version in the background as soon as it is found."
    : "Off: a newer version is downloaded only when you click Download update.";
}

function resolveKeepAwakeLabel(isZh: boolean, level: KeepAwakeLevel): string {
  if (isZh) {
    if (level === "off") return "关闭";
    if (level === "display") return "系统与屏幕";
    return "系统";
  }
  if (level === "off") return "Off";
  if (level === "display") return "System & Display";
  return "System";
}

function resolveDaemonDescription(isZh: boolean, st: DaemonHostStatus | null): string {
  if (!st) {
    return "";
  }
  if (st.inProcess) {
    return isZh
      ? `由当前桌面客户端进程内托管 (${st.addr})`
      : `Served in-process by this desktop app (${st.addr})`;
  }
  if (st.reason === "container") {
    return isZh
      ? `端口 ${st.addr} 由容器转发占用 (${st.externalPath ?? "container"})`
      : `Port ${st.addr} is held by a container forwarder (${st.externalPath ?? "container"})`;
  }
  if (st.reason === "not-byspace") {
    return isZh
      ? `端口 ${st.addr} 被其它程序占用 (PID ${st.externalPid ?? "?"}: ${st.externalPath ?? ""})`
      : `Port ${st.addr} is held by another program (PID ${st.externalPid ?? "?"}: ${st.externalPath ?? ""})`;
  }
  const verInfo = st.runningVersion ? ` v${st.runningVersion}` : "";
  const pidInfo = st.externalPid ? ` · PID ${st.externalPid}` : "";
  return isZh
    ? `当前附着在外部 BySpace Daemon (${st.addr}${verInfo}${pidInfo})，可一键由当前客户端进程内接管。`
    : `Attached to an external BySpace daemon (${st.addr}${verInfo}${pidInfo}). Click to take over in-process.`;
}

function resolveCLIHint(isZh: boolean, cli?: CLIStatus): string {
  if (!cli) {
    return "";
  }
  if (cli.ours) {
    return isZh
      ? `终端中的 byspace 命令已指向当前客户端 (${cli.command ?? ""})。`
      : `The byspace command in your terminal runs this app (${cli.command ?? ""}).`;
  }
  return isZh
    ? "新打开的终端还找不到 byspace 命令，点击右侧按钮将其添加到 PATH。"
    : "A new terminal can't find the byspace command yet. Click Add to PATH to install it.";
}

function resolveDesktopCopy(
  isZh: boolean,
  autoDownloadEnabled: boolean,
  backupCount: number,
  daemonSt: DaemonHostStatus | null,
  upd?: UpdateStatusSnapshot,
  cli?: CLIStatus,
) {
  const versionSubtitle = resolveVersionSubtitle(isZh, upd);
  const versionAction = resolveVersionActionLabel(isZh, upd?.state);
  const cliHint = resolveCLIHint(isZh, cli);
  if (isZh) {
    return {
      sectionTitle: "桌面客户端",
      versionLabel: "客户端版本 (Version)",
      versionSubtitle,
      versionAction,
      configFolderLabel: "配置文件夹 (Config folder)",
      configFolderHint: "存放主机配置、项目注册表、定时任务与客户端设置。",
      openFolderText: "打开",
      cliLabel: "命令行工具 (Command line)",
      cliHint,
      addToPathText: cli?.ours ? "重新配置 PATH" : "添加到 PATH",
      notFoundText: "未找到",
      defaultShellTag: "默认",
      openAtLoginLabel: "开机自启",
      openAtLoginHint: "登录系统时自动在后台系统托盘启动 BySpace（不弹出窗口）。",
      showInDockLabel: "关闭窗口后保留在程序坞 (Dock)",
      showInDockHint: "关闭后，关掉主窗口退驻菜单栏时自动从 macOS Dock 收起图标，保持程序坞整洁。",
      keepAwakeLabel: "Agent 运行时防止休眠",
      keepAwakeHint:
        "当有 Agent 正在运行（及结束后 10 分钟宽限期内）时阻止电脑自动休眠，空闲后恢复正常休眠。",
      lightweightLabel: "轻量模式",
      lightweightHint:
        "窗口关闭退驻托盘满 1 分钟后自动释放 WebView 渲染进程以节省内存，下次打开时重新加载。",
      autoUpdateLabel: "自动检查更新",
      autoUpdateHint: "后台自动检查是否有新版本发布。",
      autoDownloadLabel: "自动下载更新",
      autoDownloadHint: resolveAutoDownloadHint(true, autoDownloadEnabled),
      autoRestartLabel: "空闲时自动安装更新",
      autoRestartHint: "新版本下载好后，当窗口未在前台聚焦且没有 Agent 运行时自动完成安装并重启。",
      daemonLabel: "本地 Daemon 宿主",
      daemonHint: resolveDaemonDescription(true, daemonSt),
      takeOverBtnText: "接管",
      backupLabel: "核心配置自动滚动备份",
      backupHint: `启动及每 6 小时自动在 ~/.byspace/backups 下保留最近 10 份配置快照（当前已存 ${backupCount} 份）。`,
      backupNowText: "立即备份",
    };
  }
  return {
    sectionTitle: "Desktop App",
    versionLabel: "Version",
    versionSubtitle,
    versionAction,
    configFolderLabel: "Config folder",
    configFolderHint: "Providers, projects, schedules and desktop settings.",
    openFolderText: "Open",
    cliLabel: "Command line",
    cliHint,
    addToPathText: cli?.ours ? "Refresh PATH" : "Add to PATH",
    notFoundText: "not found",
    defaultShellTag: "default",
    openAtLoginLabel: "Open at login",
    openAtLoginHint: "Starts BySpace silently in the system tray when you log in.",
    showInDockLabel: "Keep in Dock when window is closed",
    showInDockHint:
      "When off, closing the window hides the Dock icon so BySpace lives only in the menu bar.",
    keepAwakeLabel: "Keep awake while agents work",
    keepAwakeHint:
      "Prevents the computer from idle-sleeping while an agent is working and for 10 minutes after.",
    lightweightLabel: "Lightweight mode",
    lightweightHint:
      "Releases the window's WebView process after it stays closed in the tray for a minute, and recreates it on the next open.",
    autoUpdateLabel: "Automatic updates",
    autoUpdateHint: "Checks for a newer BySpace release in the background.",
    autoDownloadLabel: "Download updates automatically",
    autoDownloadHint: resolveAutoDownloadHint(false, autoDownloadEnabled),
    autoRestartLabel: "Restart automatically when idle",
    autoRestartHint:
      "Once an update is downloaded, installs and restarts into it when the window is unfocused and no agent is running.",
    daemonLabel: "Local daemon host",
    daemonHint: resolveDaemonDescription(false, daemonSt),
    takeOverBtnText: "Take over",
    backupLabel: "Automatic config backups",
    backupHint: `Keeps the 10 most recent configuration snapshots under ~/.byspace/backups (currently ${backupCount} saved).`,
    backupNowText: "Back up now",
  };
}

interface KeepAwakeMenuItemProps {
  level: KeepAwakeLevel;
  label: string;
  selected: boolean;
  onSelectLevel: (level: KeepAwakeLevel) => void;
}

function KeepAwakeMenuItem({ level, label, selected, onSelectLevel }: KeepAwakeMenuItemProps) {
  const handleSelect = useCallback(() => {
    onSelectLevel(level);
  }, [level, onSelectLevel]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {label}
    </DropdownMenuItem>
  );
}

const triggerStyle = ({ pressed }: PressableStateCallbackType) => [
  styles.dropdownTrigger,
  pressed && { opacity: 0.7 },
];

function DesktopSystemRows({
  copy,
  state,
  updState,
  onVersionAction,
  onOpenConfigFolder,
  onAddCLIToPath,
}: {
  copy: ReturnType<typeof resolveDesktopCopy>;
  state: DesktopSettingsResponse | null;
  updState: string | undefined;
  onVersionAction: () => void;
  onOpenConfigFolder: () => void;
  onAddCLIToPath: () => void;
}) {
  const isUpdateBusy = updState === "checking" || updState === "downloading";
  const actionVariant = updState === "ready" || updState === "found" ? "default" : "secondary";
  const shells = state?.cliStatus?.shells ?? [];
  const currentVersion = state?.update?.currentVersion;
  const configFolder = state?.configFolder;

  return (
    <>
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{copy.versionLabel}</Text>
          <Text style={settingsStyles.rowHint}>{copy.versionSubtitle}</Text>
        </View>
        <View style={styles.trailingActions}>
          {currentVersion ? <Text style={styles.monoValue}>{currentVersion}</Text> : null}
          <Button
            variant={actionVariant}
            size="sm"
            onPress={onVersionAction}
            disabled={isUpdateBusy}
            testID="desktop-version-action-button"
          >
            {copy.versionAction}
          </Button>
        </View>
      </View>
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{copy.configFolderLabel}</Text>
          <Text style={settingsStyles.rowHint}>{copy.configFolderHint}</Text>
        </View>
        <View style={styles.trailingActions}>
          {configFolder ? <Text style={styles.monoValue}>{configFolder}</Text> : null}
          <Button
            variant="secondary"
            size="sm"
            onPress={onOpenConfigFolder}
            testID="desktop-open-config-folder-button"
          >
            {copy.openFolderText}
          </Button>
        </View>
      </View>
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{copy.cliLabel}</Text>
          <Text style={settingsStyles.rowHint}>{copy.cliHint}</Text>
          {shells.length > 0 ? (
            <View style={styles.shellList}>
              {shells.map((sh) => (
                <View key={sh.name} style={styles.shellRow}>
                  <View
                    style={[
                      styles.shellDot,
                      sh.ours ? styles.shellDotActive : styles.shellDotInactive,
                    ]}
                  />
                  <Text style={styles.shellName}>
                    {sh.name}
                    {sh.default ? ` · ${copy.defaultShellTag}` : ""}
                  </Text>
                  <Text style={styles.shellCmd} numberOfLines={1}>
                    {sh.command ? sh.command : copy.notFoundText}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
        <Button
          variant="secondary"
          size="sm"
          onPress={onAddCLIToPath}
          testID="desktop-add-to-path-button"
        >
          {copy.addToPathText}
        </Button>
      </View>
    </>
  );
}

function isChineseLanguage(lang: string | undefined): boolean {
  return Boolean(lang && lang.toLowerCase().startsWith("zh"));
}

function resolveVersionPatch(updState: string | undefined): Record<string, unknown> {
  if (updState === "ready") {
    return { restartToUpdate: true };
  }
  if (updState === "found") {
    return { downloadUpdate: true };
  }
  return { checkForUpdates: true };
}

export function DesktopAppSection() {
  const { i18n } = useTranslation();
  const isZh = isChineseLanguage(i18n.language);
  const [state, setState] = useState<DesktopSettingsResponse | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/_byspace/desktop/settings", { method: "GET" });
      if (!res.ok) return;
      const data = (await res.json()) as DesktopSettingsResponse;
      if (data.desktop && data.settings) {
        setState(data);
      }
    } catch {
      // Ignore when not running inside the Wails desktop host
    }
  }, []);

  useEffect(() => {
    if (!isWailsDesktopContainer()) {
      return;
    }
    void fetchSettings();
  }, [fetchSettings]);

  const updState = state?.update?.state;
  useEffect(() => {
    if (updState !== "checking" && updState !== "downloading") {
      return;
    }
    const timer = setInterval(() => {
      void fetchSettings();
    }, 400);
    return () => clearInterval(timer);
  }, [fetchSettings, updState]);

  const sendPatch = useCallback((patch: Record<string, unknown>) => {
    async function save() {
      try {
        const res = await fetch("/_byspace/desktop/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) return;
        const data = (await res.json()) as DesktopSettingsResponse;
        if (data.desktop && data.settings) {
          setState(data);
        }
      } catch {
        // Ignore transient write errors
      }
    }
    void save();
  }, []);

  const prefs = state?.settings;
  const keepAwake: KeepAwakeLevel = prefs?.keepAwake ?? "system";

  const handleVersionAction = useCallback(() => {
    sendPatch(resolveVersionPatch(updState));
  }, [sendPatch, updState]);

  const handleOpenConfigFolder = useCallback(() => {
    sendPatch({ openConfigFolder: true });
  }, [sendPatch]);

  const handleAddCLIToPath = useCallback(() => {
    sendPatch({ addCLIToPath: true });
  }, [sendPatch]);

  const handleOpenAtLoginChange = useCallback(
    (value: boolean) => sendPatch({ openAtLogin: value }),
    [sendPatch],
  );
  const handleShowInDockChange = useCallback(
    (value: boolean) => sendPatch({ hideFromDock: !value }),
    [sendPatch],
  );
  const handleSelectKeepAwake = useCallback(
    (level: KeepAwakeLevel) => sendPatch({ keepAwake: level }),
    [sendPatch],
  );
  const handleLightweightChange = useCallback(
    (value: boolean) => sendPatch({ lightweight: value }),
    [sendPatch],
  );
  const handleAutoUpdateChange = useCallback(
    (value: boolean) => sendPatch({ noAutoUpdate: !value }),
    [sendPatch],
  );
  const handleAutoDownloadChange = useCallback(
    (value: boolean) => sendPatch({ noAutoDownload: !value }),
    [sendPatch],
  );
  const handleAutoRestartChange = useCallback(
    (value: boolean) => sendPatch({ autoRestart: value }),
    [sendPatch],
  );
  const handleTakeOverDaemon = useCallback(() => {
    sendPatch({ takeOverDaemon: true });
  }, [sendPatch]);
  const handleCreateBackup = useCallback(() => {
    sendPatch({ createBackup: true });
  }, [sendPatch]);

  if (!prefs) {
    return null;
  }

  const isMac = state?.platform === "darwin";
  const autoUpdateEnabled = !prefs.noAutoUpdate;
  const autoDownloadEnabled = !prefs.noAutoDownload;
  const showInDock = !prefs.hideFromDock;
  const daemonSt = state?.daemonStatus ?? null;
  const canTakeOver = daemonSt?.reason === "external-byspace";
  const copy = resolveDesktopCopy(
    isZh,
    autoDownloadEnabled,
    state?.backupCount ?? 0,
    daemonSt,
    state?.update,
    state?.cliStatus,
  );
  const selectedKeepAwakeLabel = resolveKeepAwakeLabel(isZh, keepAwake);

  return (
    <SettingsSection title={copy.sectionTitle}>
      <View style={settingsStyles.card}>
        <DesktopSystemRows
          copy={copy}
          state={state}
          updState={updState}
          onVersionAction={handleVersionAction}
          onOpenConfigFolder={handleOpenConfigFolder}
          onAddCLIToPath={handleAddCLIToPath}
        />
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{copy.openAtLoginLabel}</Text>
            <Text style={settingsStyles.rowHint}>{copy.openAtLoginHint}</Text>
          </View>
          <Switch
            value={Boolean(state?.openAtLogin)}
            onValueChange={handleOpenAtLoginChange}
            accessibilityLabel={copy.openAtLoginLabel}
            testID="desktop-open-at-login-toggle"
          />
        </View>
        {isMac ? (
          <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{copy.showInDockLabel}</Text>
              <Text style={settingsStyles.rowHint}>{copy.showInDockHint}</Text>
            </View>
            <Switch
              value={showInDock}
              onValueChange={handleShowInDockChange}
              accessibilityLabel={copy.showInDockLabel}
              testID="desktop-show-in-dock-toggle"
            />
          </View>
        ) : null}
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{copy.keepAwakeLabel}</Text>
            <Text style={settingsStyles.rowHint}>{copy.keepAwakeHint}</Text>
          </View>
          <DropdownMenu>
            <DropdownTrigger
              accessibilityRole="button"
              accessibilityLabel={`${copy.keepAwakeLabel}: ${selectedKeepAwakeLabel}`}
              style={triggerStyle}
              testID="desktop-keep-awake-button"
            >
              <Text style={styles.dropdownTriggerText}>{selectedKeepAwakeLabel}</Text>
            </DropdownTrigger>
            <DropdownMenuContent side="bottom" align="end" width={180}>
              {KEEP_AWAKE_LEVELS.map((lvl) => (
                <KeepAwakeMenuItem
                  key={lvl}
                  level={lvl}
                  label={resolveKeepAwakeLabel(isZh, lvl)}
                  selected={keepAwake === lvl}
                  onSelectLevel={handleSelectKeepAwake}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </View>
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{copy.lightweightLabel}</Text>
            <Text style={settingsStyles.rowHint}>{copy.lightweightHint}</Text>
          </View>
          <Switch
            value={prefs.lightweight}
            onValueChange={handleLightweightChange}
            accessibilityLabel={copy.lightweightLabel}
            testID="desktop-lightweight-toggle"
          />
        </View>
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{copy.autoUpdateLabel}</Text>
            <Text style={settingsStyles.rowHint}>{copy.autoUpdateHint}</Text>
          </View>
          <Switch
            value={autoUpdateEnabled}
            onValueChange={handleAutoUpdateChange}
            accessibilityLabel={copy.autoUpdateLabel}
            testID="desktop-auto-update-toggle"
          />
        </View>
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{copy.autoDownloadLabel}</Text>
            <Text style={settingsStyles.rowHint}>{copy.autoDownloadHint}</Text>
          </View>
          <Switch
            value={autoDownloadEnabled}
            onValueChange={handleAutoDownloadChange}
            disabled={!autoUpdateEnabled}
            accessibilityLabel={copy.autoDownloadLabel}
            testID="desktop-auto-download-toggle"
          />
        </View>
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{copy.autoRestartLabel}</Text>
            <Text style={settingsStyles.rowHint}>{copy.autoRestartHint}</Text>
          </View>
          <Switch
            value={prefs.autoRestart}
            onValueChange={handleAutoRestartChange}
            disabled={!autoUpdateEnabled}
            accessibilityLabel={copy.autoRestartLabel}
            testID="desktop-auto-restart-toggle"
          />
        </View>
        {daemonSt ? (
          <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{copy.daemonLabel}</Text>
              <Text style={settingsStyles.rowHint}>{copy.daemonHint}</Text>
            </View>
            {canTakeOver ? (
              <Button
                variant="secondary"
                size="sm"
                onPress={handleTakeOverDaemon}
                testID="desktop-daemon-takeover-button"
              >
                {copy.takeOverBtnText}
              </Button>
            ) : null}
          </View>
        ) : null}
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{copy.backupLabel}</Text>
            <Text style={settingsStyles.rowHint}>{copy.backupHint}</Text>
          </View>
          <Button
            variant="secondary"
            size="sm"
            onPress={handleCreateBackup}
            testID="desktop-backup-now-button"
          >
            {copy.backupNowText}
          </Button>
        </View>
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  dropdownTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  dropdownTriggerText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  trailingActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  monoValue: {
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foregroundMuted,
  },
  shellList: {
    marginTop: theme.spacing[2],
    gap: theme.spacing[1],
  },
  shellRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  shellDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  shellDotActive: {
    backgroundColor: theme.colors.palette.green[400],
  },
  shellDotInactive: {
    backgroundColor: theme.colors.foregroundMuted,
  },
  shellName: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    minWidth: 120,
  },
  shellCmd: {
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foregroundMuted,
    flex: 1,
  },
}));
