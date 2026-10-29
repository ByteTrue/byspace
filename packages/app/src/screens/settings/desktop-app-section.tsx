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

interface DesktopSettingsResponse {
  desktop?: boolean;
  platform?: string;
  settings?: DesktopPreferences;
  openAtLogin?: boolean;
  daemonStatus?: DaemonHostStatus;
  backupCount?: number;
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

function resolveAutoDownloadHint(isZh: boolean, enabled: boolean): string {
  if (isZh) {
    return enabled
      ? "发现新版本后立即在后台下载。使用按流量计费的网络或代理时可以关闭。"
      : "已关闭：发现新版本时仅在托盘菜单提示，点击「Download update」后才下载。";
  }
  return enabled
    ? "Downloads a newer version in the background as soon as it is found."
    : "Off: a newer version is shown in the tray menu and downloaded only when clicked.";
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

function resolveDesktopCopy(
  isZh: boolean,
  autoDownloadEnabled: boolean,
  backupCount: number,
  daemonSt: DaemonHostStatus | null,
) {
  if (isZh) {
    return {
      sectionTitle: "桌面客户端",
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

export function DesktopAppSection() {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage ?? i18n.language ?? "").toLowerCase().startsWith("zh");
  const [state, setState] = useState<DesktopSettingsResponse | null>(null);

  useEffect(() => {
    if (!isWailsDesktopContainer()) {
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/_byspace/desktop/settings", { method: "GET" });
        if (!res.ok) return;
        const data = (await res.json()) as DesktopSettingsResponse;
        if (!cancelled && data.desktop && data.settings) {
          setState(data);
        }
      } catch {
        // Ignore when not running inside the Wails desktop host
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

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
  const canTakeOver = Boolean(
    daemonSt && !daemonSt.inProcess && daemonSt.reason === "external-byspace",
  );
  const copy = resolveDesktopCopy(isZh, autoDownloadEnabled, state?.backupCount ?? 0, daemonSt);
  const selectedKeepAwakeLabel = resolveKeepAwakeLabel(isZh, keepAwake);

  return (
    <SettingsSection title={copy.sectionTitle}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
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
}));
