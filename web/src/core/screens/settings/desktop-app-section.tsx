// Port of archive/expo-app:packages/app/src/screens/settings/desktop-app-section.tsx: the Wails desktop app's General and About rows. Same logic, DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/desktop-app-section.py; edit it directly.
import { isWailsDesktopContainer } from "@/utils/wails";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import { Button } from "~/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Switch } from "~/components/ui/switch";
import { Item, ItemContent, ItemDescription, ItemTitle } from "~/components/ui/item";

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
    (value: string) => {
      const mode = dockOptions.find((option) => option.value === value)?.value;
      if (mode) sendPatch({ dockMode: mode });
    },
    [dockOptions, sendPatch],
  );
  const handleLightweightChange = useCallback(
    (value: boolean) => sendPatch({ lightweight: value }),
    [sendPatch],
  );
  const handleKeepAwakeChange = useCallback(
    (value: string) => {
      const level = sleepOptions.find((option) => option.value === value)?.value;
      if (level) sendPatch({ keepAwake: level });
    },
    [sleepOptions, sendPatch],
  );

  if (!prefs) {
    return null;
  }

  const isMac = state?.platform === "darwin";
  const dockMode: DockMode = prefs.dockMode ?? (prefs.hideFromDock ? "window" : "show");
  const keepAwake: KeepAwakeLevel = prefs.keepAwake ?? "system";

  return (
    <>
      <Item variant="outline">
        <ItemContent>
          <ItemTitle>{isZh ? "开机自启" : "Open at login"}</ItemTitle>
        </ItemContent>
        <Switch
          checked={Boolean(state?.openAtLogin)}
          onCheckedChange={handleOpenAtLoginChange}
          aria-label={isZh ? "开机自启" : "Open at login"}
          data-testid="desktop-open-at-login-toggle"
        />
      </Item>
      {isMac ? (
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>{isZh ? "程序坞 (Dock) 图标" : "Show in Dock"}</ItemTitle>
          </ItemContent>
          <Tabs value={dockMode} onValueChange={handleDockModeChange}>
            <TabsList>
              {dockOptions.map((option) => (
                <TabsTrigger key={option.value} value={option.value}>
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </Item>
      ) : null}
      <Item variant="outline">
        <ItemContent>
          <ItemTitle>{isZh ? "轻量模式" : "Lightweight mode"}</ItemTitle>
          <ItemDescription>
            {isZh
              ? "窗口关闭 1 分钟后释放约 100 MB 内存；后台 Daemon 与 Agent 继续运行，仅下次打开时重载页面"
              : "A closed window frees about 100 MB after a minute; the daemon and agents keep running, only the page reloads"}
          </ItemDescription>
        </ItemContent>
        <Switch
          checked={prefs.lightweight}
          onCheckedChange={handleLightweightChange}
          aria-label={isZh ? "轻量模式" : "Lightweight mode"}
          data-testid="desktop-lightweight-toggle"
        />
      </Item>
      <Item variant="outline">
        <ItemContent>
          <ItemTitle>{isZh ? "防止休眠" : "Prevent sleep"}</ItemTitle>
          <ItemDescription>
            {isZh
              ? "当 BySpace 正在运行 Agent 任务时阻止电脑进入休眠"
              : "Keeps this computer awake while BySpace runs agents"}
          </ItemDescription>
        </ItemContent>
        <Tabs value={keepAwake} onValueChange={handleKeepAwakeChange}>
          <TabsList>
            {sleepOptions.map((option) => (
              <TabsTrigger key={option.value} value={option.value}>
                {option.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </Item>
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
    <Item variant="outline">
      <ItemContent>
        <ItemTitle>{isZh ? "命令行 (Command line)" : "Command line"}</ItemTitle>
        <ItemDescription>{resolveCLIHint(isZh, cli)}</ItemDescription>
        {shells.length > 0 ? (
          <div className="mt-2 flex flex-col gap-1">
            {shells.map((sh) => (
              <div key={sh.name} className="flex flex-row items-center gap-2">
                <div
                  className={cn(
                    "size-[7px] shrink-0 rounded-full",
                    sh.ours ? "bg-green-400" : "bg-muted-foreground",
                  )}
                />
                <span className="min-w-[120px] text-xs text-foreground">
                  {formatShellNameLabel(sh, isZh)}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {formatShellCommandStatus(sh, isZh)}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </ItemContent>
      {!allOurs ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={onAddCLIToPath}
          data-testid="desktop-add-to-path-button"
        >
          {isZh ? "添加到 PATH" : "Add to PATH"}
        </Button>
      ) : null}
    </Item>
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
    (value: string) => {
      const every = UPDATE_EVERY_OPTIONS.find((option) => option.value === value)?.value;
      if (every) sendPatch({ updateEvery: Number.parseInt(every, 10) });
    },
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
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>{t("settings.about.appVersion")}</ItemTitle>
            <ItemDescription>{t("settings.about.thisDevice")}</ItemDescription>
          </ItemContent>
          <span className="text-xs text-muted-foreground">{appVersionText}</span>
        </Item>
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
      <Item variant="outline">
        <ItemContent>
          <ItemTitle>{copy.versionTitle}</ItemTitle>
          <ItemDescription>{resolveVersionSubtitle(isZh, state?.update)}</ItemDescription>
        </ItemContent>
        <div className="flex flex-row items-center gap-2">
          <span className="text-xs text-muted-foreground">{currentVersion}</span>
          <Button
            variant={actionVariant}
            size="sm"
            onClick={handleVersionAction}
            data-testid="desktop-version-action-button"
            disabled={isUpdateBusy}
          >
            {resolveVersionActionLabel(isZh, updState)}
          </Button>
        </div>
      </Item>
      {whatsNewRow}
      <Item variant="outline">
        <ItemContent>
          <ItemTitle>{copy.autoUpdateTitle}</ItemTitle>
          <ItemDescription>{copy.autoUpdateHint}</ItemDescription>
        </ItemContent>
        <Switch
          checked={autoUpdateEnabled}
          onCheckedChange={handleAutoUpdateChange}
          aria-label={copy.autoUpdateTitle}
          data-testid="desktop-auto-update-toggle"
        />
      </Item>
      <Item variant="outline">
        <ItemContent>
          <ItemTitle>{copy.checkEveryTitle}</ItemTitle>
          <ItemDescription>{copy.checkEveryHint}</ItemDescription>
        </ItemContent>
        <Tabs value={updateEveryVal} onValueChange={handleUpdateEveryChange}>
          <TabsList>
            {UPDATE_EVERY_OPTIONS.map((option) => (
              <TabsTrigger key={option.value} value={option.value}>
                {option.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </Item>
      <Item variant="outline">
        <ItemContent>
          <ItemTitle>{copy.autoDownloadTitle}</ItemTitle>
          <ItemDescription>{copy.autoDownloadHint}</ItemDescription>
        </ItemContent>
        <Switch
          checked={autoDownloadEnabled}
          onCheckedChange={handleAutoDownloadChange}
          disabled={!autoUpdateEnabled}
          aria-label={copy.autoDownloadTitle}
          data-testid="desktop-auto-download-toggle"
        />
      </Item>
      <Item variant="outline">
        <ItemContent>
          <ItemTitle>{copy.autoRestartTitle}</ItemTitle>
          <ItemDescription>{copy.autoRestartHint}</ItemDescription>
        </ItemContent>
        <Switch
          checked={prefs.autoRestart}
          onCheckedChange={handleAutoRestartChange}
          disabled={!autoUpdateEnabled}
          aria-label={copy.autoRestartTitle}
          data-testid="desktop-auto-restart-toggle"
        />
      </Item>
      <Item variant="outline">
        <ItemContent>
          <ItemTitle>{copy.configFolderTitle}</ItemTitle>
          <ItemDescription>{copy.configFolderHint}</ItemDescription>
        </ItemContent>
        <div className="flex flex-row items-center gap-2">
          {state?.configFolder ? (
            <span className="text-xs text-muted-foreground">{state.configFolder}</span>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={handleOpenConfigFolder}
            data-testid="desktop-open-config-folder-button"
          >
            {copy.openText}
          </Button>
        </div>
      </Item>
      <DesktopCommandLineBlock
        isZh={isZh}
        cli={state?.cliStatus}
        onAddCLIToPath={handleAddCLIToPath}
      />
      {daemonSt ? (
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>{copy.daemonUrlTitle}</ItemTitle>
            <ItemDescription>{resolveDaemonDescription(isZh, daemonSt)}</ItemDescription>
          </ItemContent>
          <div className="flex flex-row items-center gap-2">
            <span className="text-xs text-muted-foreground">{`http://${daemonSt.addr}`}</span>
            {daemonSt.reason === "external-byspace" ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleTakeOverDaemon}
                data-testid="desktop-daemon-takeover-button"
              >
                {copy.takeOverText}
              </Button>
            ) : null}
          </div>
        </Item>
      ) : null}
      {diagnosticRow}
    </>
  );
}
