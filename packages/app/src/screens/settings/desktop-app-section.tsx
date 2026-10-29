import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Switch } from "@/components/ui/switch";
import { isWeb } from "@/constants/platform";
import { settingsStyles } from "@/styles/settings";

interface DesktopPreferences {
  lightweight: boolean;
  noAutoUpdate: boolean;
  noAutoDownload: boolean;
  autoRestart: boolean;
}

interface DesktopSettingsResponse {
  desktop?: boolean;
  settings?: DesktopPreferences;
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

export function DesktopAppSection() {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage ?? i18n.language ?? "").toLowerCase().startsWith("zh");
  const [prefs, setPrefs] = useState<DesktopPreferences | null>(null);

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
          setPrefs(data.settings);
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

  const updatePref = useCallback((patch: Partial<DesktopPreferences>) => {
    setPrefs((prev) => (prev ? { ...prev, ...patch } : prev));
    async function save() {
      try {
        const res = await fetch("/_byspace/desktop/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) return;
        const data = (await res.json()) as DesktopSettingsResponse;
        if (data.settings) {
          setPrefs(data.settings);
        }
      } catch {
        // Ignore transient write errors
      }
    }
    void save();
  }, []);

  const handleLightweightChange = useCallback(
    (value: boolean) => updatePref({ lightweight: value }),
    [updatePref],
  );
  const handleAutoUpdateChange = useCallback(
    (value: boolean) => updatePref({ noAutoUpdate: !value }),
    [updatePref],
  );
  const handleAutoDownloadChange = useCallback(
    (value: boolean) => updatePref({ noAutoDownload: !value }),
    [updatePref],
  );
  const handleAutoRestartChange = useCallback(
    (value: boolean) => updatePref({ autoRestart: value }),
    [updatePref],
  );

  if (!prefs) {
    return null;
  }

  const autoUpdateEnabled = !prefs.noAutoUpdate;
  const autoDownloadEnabled = !prefs.noAutoDownload;

  const sectionTitle = isZh ? "桌面客户端" : "Desktop App";
  const lightweightLabel = isZh ? "轻量模式" : "Lightweight mode";
  const lightweightHint = isZh
    ? "窗口关闭退驻托盘满 1 分钟后自动释放 WebView 渲染进程以节省内存，下次打开时重新加载。"
    : "Releases the window's WebView process after it stays closed in the tray for a minute, and recreates it on the next open.";
  const autoUpdateLabel = isZh ? "自动检查更新" : "Automatic updates";
  const autoUpdateHint = isZh
    ? "后台自动检查是否有新版本发布。"
    : "Checks for a newer BySpace release in the background.";
  const autoDownloadLabel = isZh ? "自动下载更新" : "Download updates automatically";
  const autoDownloadHint = resolveAutoDownloadHint(isZh, autoDownloadEnabled);
  const autoRestartLabel = isZh ? "空闲时自动安装更新" : "Restart automatically when idle";
  const autoRestartHint = isZh
    ? "新版本下载好后，当窗口未在前台聚焦且没有 Agent 运行时自动完成安装并重启。"
    : "Once an update is downloaded, installs and restarts into it when the window is unfocused and no agent is running.";

  return (
    <SettingsSection title={sectionTitle}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{lightweightLabel}</Text>
            <Text style={settingsStyles.rowHint}>{lightweightHint}</Text>
          </View>
          <Switch
            value={prefs.lightweight}
            onValueChange={handleLightweightChange}
            accessibilityLabel={lightweightLabel}
            testID="desktop-lightweight-toggle"
          />
        </View>
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{autoUpdateLabel}</Text>
            <Text style={settingsStyles.rowHint}>{autoUpdateHint}</Text>
          </View>
          <Switch
            value={autoUpdateEnabled}
            onValueChange={handleAutoUpdateChange}
            accessibilityLabel={autoUpdateLabel}
            testID="desktop-auto-update-toggle"
          />
        </View>
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{autoDownloadLabel}</Text>
            <Text style={settingsStyles.rowHint}>{autoDownloadHint}</Text>
          </View>
          <Switch
            value={autoDownloadEnabled}
            onValueChange={handleAutoDownloadChange}
            disabled={!autoUpdateEnabled}
            accessibilityLabel={autoDownloadLabel}
            testID="desktop-auto-download-toggle"
          />
        </View>
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{autoRestartLabel}</Text>
            <Text style={settingsStyles.rowHint}>{autoRestartHint}</Text>
          </View>
          <Switch
            value={prefs.autoRestart}
            onValueChange={handleAutoRestartChange}
            disabled={!autoUpdateEnabled}
            accessibilityLabel={autoRestartLabel}
            testID="desktop-auto-restart-toggle"
          />
        </View>
      </View>
    </SettingsSection>
  );
}
