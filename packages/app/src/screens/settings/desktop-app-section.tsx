import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { isWeb } from "@/constants/platform";
import { settingsStyles } from "@/styles/settings";

type KeepAwakeLevel = "off" | "system" | "display";
type DockMode = "hide" | "window" | "show";
type UpdateEveryStr = "30" | "60" | "360" | "1440";

interface DesktopPreferences {
  keepAwake?: KeepAwakeLevel;
  dockMode?: DockMode;
  hideFromDock: boolean;
  lightweight: boolean;
  noAutoUpdate: boolean;
  updateEvery?: number;
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

function isChineseLanguage(lang: string | undefined): boolean {
  return Boolean(lang && lang.toLowerCase().startsWith("zh"));
}

function formatMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function formatDownloadingProgress(isZh: boolean, upd: UpdateStatusSnapshot): string {
  const done = upd.downloaded ?? 0;
  const total = upd.total ?? 0;
  const ver = upd.latestVersion ?? "";
  if (total > 0) {
    const pct = Math.min(100, Math.round((done * 100) / total));
    return isZh
      ? `正在下载 ${ver}… ${pct}% · ${formatMegabytes(done)} / ${formatMegabytes(total)} MB`
      : `Downloading ${ver}… ${pct}% · ${formatMegabytes(done)} of ${formatMegabytes(total)} MB`;
  }
  return isZh
    ? `正在下载 ${ver}… ${formatMegabytes(done)} MB`
    : `Downloading ${ver}… ${formatMegabytes(done)} MB`;
}

function resolveVersionSubtitle(isZh: boolean, upd?: UpdateStatusSnapshot): string {
  if (!upd) {
    return isZh ? "已是最新版本" : "Up to date";
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
        ? `发现新版本 ${upd.latestVersion ?? ""}`
        : `${upd.latestVersion ?? ""} is available`;
    case "error":
      return isZh
        ? `检查或下载失败${upd.error ? ": " + upd.error : ""}`
        : `Update failed${upd.error ? ": " + upd.error : ""}`;
    default:
      return isZh ? "已是最新版本" : "Up to date";
  }
}

function resolveActionVariant(state?: string): "default" | "secondary" {
  return state === "ready" || state === "found" ? "default" : "secondary";
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

function resolveVersionPatch(updState: string | undefined): Record<string, unknown> {
  if (updState === "ready") {
    return { restartToUpdate: true };
  }
  if (updState === "found") {
    return { downloadUpdate: true };
  }
  return { checkForUpdates: true };
}

function resolveCLIHint(isZh: boolean, cli?: CLIStatus): string {
  if (!cli) {
    return "";
  }
  if (cli.ours) {
    return isZh
      ? `在新打开的终端中，byspace 运行当前应用：${cli.command ?? ""}`
      : `In a new terminal, byspace runs this app: ${cli.command ?? ""}`;
  }
  return isZh
    ? "新打开的终端还找不到 byspace 命令，点击右侧按钮将其添加到 PATH。"
    : "In a new terminal, byspace is not on your PATH yet.";
}

function resolveDaemonDescription(isZh: boolean, st: DaemonHostStatus | null): string {
  if (!st) {
    return "";
  }
  if (st.inProcess) {
    return isZh
      ? "本地 Agent 与客户端连接的地址"
      : "the address local agents and clients connect to";
  }
  if (st.reason === "container") {
    return isZh
      ? `端口 ${st.addr} 由容器转发占用 (${st.externalPath ?? "container"})`
      : `Port ${st.addr} is held by a container forwarder (${st.externalPath ?? "container"})`;
  }
  if (st.reason === "not-byspace") {
    return isZh
      ? `端口 ${st.addr} 被其它程序占用 (PID ${st.externalPid ?? "?"})`
      : `Port ${st.addr} is held by another program (PID ${st.externalPid ?? "?"})`;
  }
  const verInfo = st.runningVersion ? ` v${st.runningVersion}` : "";
  const pidInfo = st.externalPid ? ` · PID ${st.externalPid}` : "";
  return isZh
    ? `当前由外部 BySpace 进程提供服务 (${verInfo}${pidInfo})，可一键由当前应用接管`
    : `Served by an external BySpace process (${verInfo}${pidInfo}); click to take over`;
}

function useDesktopSettingsState() {
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
      // Ignore outside the Wails desktop host
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

  return { state, sendPatch };
}

/**
 * Desktop rows embedded at the bottom of the Settings → General card (matching Magpie's General
 * page: Open at login, Show in Dock [Hide | With window | Show], Lightweight mode, Prevent sleep
 * [Off | On | Screen on too]).
 */
export function DesktopGeneralRows() {
  const { i18n } = useTranslation();
  const isZh = isChineseLanguage(i18n.language);
  const { state, sendPatch } = useDesktopSettingsState();
  const prefs = state?.settings;

  const dockOptions = useMemo(
    () => [
      { value: "hide" as const, label: isZh ? "隐藏" : "Hide" },
      { value: "window" as const, label: isZh ? "打开窗口时" : "With window" },
      { value: "show" as const, label: isZh ? "常驻" : "Show" },
    ],
    [isZh],
  );

  const sleepOptions = useMemo(
    () => [
      { value: "off" as const, label: isZh ? "关闭" : "Off" },
      { value: "system" as const, label: isZh ? "开启" : "On" },
      { value: "display" as const, label: isZh ? "保持亮屏" : "Screen on too" },
    ],
    [isZh],
  );

  const handleOpenAtLoginChange = useCallback(
    (value: boolean) => sendPatch({ openAtLogin: value }),
    [sendPatch],
  );
  const handleDockModeChange = useCallback(
    (mode: DockMode) => sendPatch({ dockMode: mode }),
    [sendPatch],
  );
  const handleLightweightChange = useCallback(
    (value: boolean) => sendPatch({ lightweight: value }),
    [sendPatch],
  );
  const handleKeepAwakeChange = useCallback(
    (level: KeepAwakeLevel) => sendPatch({ keepAwake: level }),
    [sendPatch],
  );

  if (!prefs) {
    return null;
  }

  const isMac = state?.platform === "darwin";
  const dockMode: DockMode = prefs.dockMode ?? (prefs.hideFromDock ? "window" : "show");
  const keepAwake: KeepAwakeLevel = prefs.keepAwake ?? "system";

  return (
    <>
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{isZh ? "开机自启" : "Open at login"}</Text>
        </View>
        <Switch
          value={Boolean(state?.openAtLogin)}
          onValueChange={handleOpenAtLoginChange}
          accessibilityLabel={isZh ? "开机自启" : "Open at login"}
          testID="desktop-open-at-login-toggle"
        />
      </View>
      {isMac ? (
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {isZh ? "程序坞 (Dock) 图标" : "Show in Dock"}
            </Text>
          </View>
          <SegmentedControl
            size="sm"
            options={dockOptions}
            value={dockMode}
            onValueChange={handleDockModeChange}
          />
        </View>
      ) : null}
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{isZh ? "轻量模式" : "Lightweight mode"}</Text>
          <Text style={settingsStyles.rowHint}>
            {isZh
              ? "窗口关闭 1 分钟后释放约 100 MB 内存；后台 Daemon 与 Agent 继续运行，仅下次打开时重载页面"
              : "A closed window frees about 100 MB after a minute; the daemon and agents keep running, only the page reloads"}
          </Text>
        </View>
        <Switch
          value={prefs.lightweight}
          onValueChange={handleLightweightChange}
          accessibilityLabel={isZh ? "轻量模式" : "Lightweight mode"}
          testID="desktop-lightweight-toggle"
        />
      </View>
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{isZh ? "防止休眠" : "Prevent sleep"}</Text>
          <Text style={settingsStyles.rowHint}>
            {isZh
              ? "当 BySpace 正在运行 Agent 任务时阻止电脑进入休眠"
              : "Keeps this computer awake while BySpace runs agents"}
          </Text>
        </View>
        <SegmentedControl
          size="sm"
          options={sleepOptions}
          value={keepAwake}
          onValueChange={handleKeepAwakeChange}
        />
      </View>
    </>
  );
}

const UPDATE_EVERY_OPTIONS: Array<{ value: UpdateEveryStr; label: string }> = [
  { value: "30", label: "30 min" },
  { value: "60", label: "1 h" },
  { value: "360", label: "6 h" },
  { value: "1440", label: "24 h" },
];

function formatShellNameLabel(sh: CLIShellStatus, isZh: boolean): string {
  if (!sh.default) {
    return sh.name;
  }
  return sh.name + (isZh ? " · 默认" : " · default");
}

function formatShellCommandStatus(sh: CLIShellStatus, isZh: boolean): string {
  if (sh.ours) {
    return isZh ? "运行当前应用" : "runs this app";
  }
  if (sh.command) {
    return sh.command;
  }
  return isZh ? "未找到" : "not found";
}

function resolveAboutCopy(isZh: boolean) {
  if (isZh) {
    return {
      versionTitle: "版本 (Version)",
      autoUpdateTitle: "自动更新",
      autoUpdateHint: "自动检查并下载新版本 BySpace",
      checkEveryTitle: "检查频率",
      checkEveryHint: "BySpace 多久检查一次是否有新版本",
      autoDownloadTitle: "自动下载更新",
      autoDownloadHint: "发现新版本后立即下载。使用按流量计费的网络或代理时可关闭",
      autoRestartTitle: "自动重启更新",
      autoRestartHint: "更新下载完成后，在不中断正在运行的 Agent 请求的前提下自动重启完成安装",
      configFolderTitle: "配置目录 (Config folder)",
      configFolderHint: "providers、projects、schedules 与当前设置",
      openText: "打开",
      daemonUrlTitle: "Daemon 地址 (Daemon URL)",
      takeOverText: "接管",
    };
  }
  return {
    versionTitle: "Version",
    autoUpdateTitle: "Automatic updates",
    autoUpdateHint: "Checks for a newer BySpace and downloads it",
    checkEveryTitle: "Check every",
    checkEveryHint: "How often BySpace looks for a newer version",
    autoDownloadTitle: "Download updates automatically",
    autoDownloadHint:
      "Downloads a newer version as soon as it is found. Turn off on a metered network or a proxy billed by traffic",
    autoRestartTitle: "Restart automatically",
    autoRestartHint:
      "Once an update is downloaded, restarts into it without cutting off an agent's request",
    configFolderTitle: "Config folder",
    configFolderHint: "providers, projects, schedules and these settings",
    openText: "Open",
    daemonUrlTitle: "Daemon URL",
    takeOverText: "Take over",
  };
}

function DesktopCommandLineBlock({
  isZh,
  cli,
  onAddCLIToPath,
}: {
  isZh: boolean;
  cli: CLIStatus | undefined;
  onAddCLIToPath: () => void;
}) {
  const shells = cli?.shells ?? [];
  const allOurs = Boolean(cli?.ours && shells.every((s) => s.ours));
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>
          {isZh ? "命令行 (Command line)" : "Command line"}
        </Text>
        <Text style={settingsStyles.rowHint}>{resolveCLIHint(isZh, cli)}</Text>
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
                <Text style={styles.shellName}>{formatShellNameLabel(sh, isZh)}</Text>
                <Text style={styles.shellCmd} numberOfLines={1}>
                  {formatShellCommandStatus(sh, isZh)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      {!allOurs ? (
        <Button
          variant="secondary"
          size="sm"
          onPress={onAddCLIToPath}
          testID="desktop-add-to-path-button"
        >
          {isZh ? "添加到 PATH" : "Add to PATH"}
        </Button>
      ) : null}
    </View>
  );
}

/**
 * Desktop rows embedded inside the Settings → About card (matching Magpie's About page:
 * Version with check/download/progress/restart, What's new, Automatic updates, Check every
 * [30 min | 1 h | 6 h | 24 h], Download updates automatically, Restart automatically,
 * Config folder, Command line, and Daemon URL).
 */
export function DesktopAboutCardContent({
  appVersionText,
  whatsNewRow,
  diagnosticRow,
}: {
  appVersionText: string;
  whatsNewRow: React.ReactNode;
  diagnosticRow: React.ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const isZh = isChineseLanguage(i18n.language);
  const { state, sendPatch } = useDesktopSettingsState();
  const prefs = state?.settings;
  const updState = state?.update?.state;

  const handleVersionAction = useCallback(() => {
    sendPatch(resolveVersionPatch(updState));
  }, [sendPatch, updState]);
  const handleAutoUpdateChange = useCallback(
    (value: boolean) => sendPatch({ noAutoUpdate: !value }),
    [sendPatch],
  );
  const handleUpdateEveryChange = useCallback(
    (val: UpdateEveryStr) => sendPatch({ updateEvery: Number.parseInt(val, 10) }),
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
  const handleOpenConfigFolder = useCallback(() => {
    sendPatch({ openConfigFolder: true });
  }, [sendPatch]);
  const handleAddCLIToPath = useCallback(() => {
    sendPatch({ addCLIToPath: true });
  }, [sendPatch]);
  const handleTakeOverDaemon = useCallback(() => {
    sendPatch({ takeOverDaemon: true });
  }, [sendPatch]);

  if (!prefs) {
    return (
      <>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.about.appVersion")}</Text>
            <Text style={settingsStyles.rowHint}>{t("settings.about.thisDevice")}</Text>
          </View>
          <Text style={styles.monoValue}>{appVersionText}</Text>
        </View>
        {whatsNewRow}
        {diagnosticRow}
      </>
    );
  }

  const autoUpdateEnabled = !prefs.noAutoUpdate;
  const autoDownloadEnabled = !prefs.noAutoDownload;
  const updateEveryVal = String(prefs.updateEvery ?? 360) as UpdateEveryStr;
  const isUpdateBusy = updState === "checking" || updState === "downloading";
  const actionVariant = resolveActionVariant(updState);
  const daemonSt = state?.daemonStatus;
  const currentVersion = state?.update?.currentVersion ?? appVersionText;
  const copy = resolveAboutCopy(isZh);

  return (
    <>
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{copy.versionTitle}</Text>
          <Text style={settingsStyles.rowHint}>{resolveVersionSubtitle(isZh, state?.update)}</Text>
        </View>
        <View style={styles.trailingActions}>
          <Text style={styles.monoValue}>{currentVersion}</Text>
          <Button
            variant={actionVariant}
            size="sm"
            onPress={handleVersionAction}
            disabled={isUpdateBusy}
            testID="desktop-version-action-button"
          >
            {resolveVersionActionLabel(isZh, updState)}
          </Button>
        </View>
      </View>
      {whatsNewRow}
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{copy.autoUpdateTitle}</Text>
          <Text style={settingsStyles.rowHint}>{copy.autoUpdateHint}</Text>
        </View>
        <Switch
          value={autoUpdateEnabled}
          onValueChange={handleAutoUpdateChange}
          accessibilityLabel={copy.autoUpdateTitle}
          testID="desktop-auto-update-toggle"
        />
      </View>
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{copy.checkEveryTitle}</Text>
          <Text style={settingsStyles.rowHint}>{copy.checkEveryHint}</Text>
        </View>
        <SegmentedControl
          size="sm"
          options={UPDATE_EVERY_OPTIONS}
          value={updateEveryVal}
          onValueChange={handleUpdateEveryChange}
        />
      </View>
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{copy.autoDownloadTitle}</Text>
          <Text style={settingsStyles.rowHint}>{copy.autoDownloadHint}</Text>
        </View>
        <Switch
          value={autoDownloadEnabled}
          onValueChange={handleAutoDownloadChange}
          disabled={!autoUpdateEnabled}
          accessibilityLabel={copy.autoDownloadTitle}
          testID="desktop-auto-download-toggle"
        />
      </View>
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{copy.autoRestartTitle}</Text>
          <Text style={settingsStyles.rowHint}>{copy.autoRestartHint}</Text>
        </View>
        <Switch
          value={prefs.autoRestart}
          onValueChange={handleAutoRestartChange}
          disabled={!autoUpdateEnabled}
          accessibilityLabel={copy.autoRestartTitle}
          testID="desktop-auto-restart-toggle"
        />
      </View>
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{copy.configFolderTitle}</Text>
          <Text style={settingsStyles.rowHint}>{copy.configFolderHint}</Text>
        </View>
        <View style={styles.trailingActions}>
          {state?.configFolder ? <Text style={styles.monoValue}>{state.configFolder}</Text> : null}
          <Button
            variant="secondary"
            size="sm"
            onPress={handleOpenConfigFolder}
            testID="desktop-open-config-folder-button"
          >
            {copy.openText}
          </Button>
        </View>
      </View>
      <DesktopCommandLineBlock
        isZh={isZh}
        cli={state?.cliStatus}
        onAddCLIToPath={handleAddCLIToPath}
      />
      {daemonSt ? (
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{copy.daemonUrlTitle}</Text>
            <Text style={settingsStyles.rowHint}>{resolveDaemonDescription(isZh, daemonSt)}</Text>
          </View>
          <View style={styles.trailingActions}>
            <Text style={styles.monoValue}>{`http://${daemonSt.addr}`}</Text>
            {daemonSt.reason === "external-byspace" ? (
              <Button
                variant="secondary"
                size="sm"
                onPress={handleTakeOverDaemon}
                testID="desktop-daemon-takeover-button"
              >
                {copy.takeOverText}
              </Button>
            ) : null}
          </View>
        </View>
      ) : null}
      {diagnosticRow}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
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
