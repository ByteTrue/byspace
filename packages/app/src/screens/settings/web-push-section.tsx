import { useCallback, useEffect, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Platform, Text, View } from "react-native";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import {
  enableWebPush,
  getWebPushState,
  isWebPushSupported,
  revokePushNotifications,
  type WebPushState,
} from "@/push-notifications";
import { useHostRuntimeClient, useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";

/**
 * Browser notifications, one row per host: each daemon signs pushes with its own
 * VAPID key, so each is subscribed separately.
 */
export function WebPushSection() {
  const { t } = useTranslation();
  const hosts = useHosts();

  if (!isWebPushSupported()) {
    return (
      <SettingsSection title={t("settings.notifications.webPush.title")}>
        <Alert
          variant="info"
          title={t("settings.notifications.webPush.unsupported")}
          testID="web-push-unsupported"
        />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title={t("settings.notifications.webPush.title")}
      info={t("settings.notifications.webPush.description")}
    >
      {isIosBrowser() ? (
        <Alert
          variant="info"
          title={t("settings.notifications.webPush.iosHomeScreenHint")}
          testID="web-push-ios-hint"
        />
      ) : null}
      <View style={settingsStyles.card}>
        {hosts.map((host, index) => (
          <WebPushHostRow
            key={host.serverId}
            serverId={host.serverId}
            label={host.label}
            withBorder={index > 0}
          />
        ))}
      </View>
    </SettingsSection>
  );
}

function WebPushHostRow(props: { serverId: string; label: string; withBorder: boolean }) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(props.serverId);
  const isConnected = useHostRuntimeIsConnected(props.serverId);
  const [state, setState] = useState<WebPushState>("unavailable");
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      const next = await getWebPushState(client, props.serverId);
      if (!cancelled) {
        setState(next);
      }
    };
    void sync();
    return () => {
      cancelled = true;
    };
  }, [client, props.serverId, isConnected]);

  const handleEnable = useCallback(() => {
    if (!client) {
      return;
    }
    setIsBusy(true);
    const enable = async () => {
      try {
        setState(await enableWebPush({ client, serverId: props.serverId }));
      } catch {
        // Retryable: stay in "prompt" so the button remains.
        setState("prompt");
      } finally {
        setIsBusy(false);
      }
    };
    void enable();
  }, [client, props.serverId]);

  const handleDisable = useCallback(() => {
    setIsBusy(true);
    const disable = async () => {
      try {
        await revokePushNotifications({ client, serverId: props.serverId });
      } finally {
        setState(await getWebPushState(client, props.serverId));
        setIsBusy(false);
      }
    };
    void disable();
  }, [client, props.serverId]);

  const hint = stateHint(state, t);

  return (
    <View style={[settingsStyles.row, props.withBorder ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{props.label}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
      {state === "prompt" ? (
        <Button
          variant="outline"
          size="sm"
          onPress={handleEnable}
          disabled={!isConnected || isBusy}
          testID={`web-push-enable-${props.serverId}`}
        >
          {isBusy
            ? t("settings.notifications.webPush.enabling")
            : t("settings.notifications.webPush.enable")}
        </Button>
      ) : null}
      {state === "enabled" ? (
        <Button
          variant="outline"
          size="sm"
          onPress={handleDisable}
          disabled={isBusy}
          testID={`web-push-disable-${props.serverId}`}
        >
          {isBusy
            ? t("settings.notifications.webPush.disabling")
            : t("settings.notifications.webPush.disable")}
        </Button>
      ) : null}
    </View>
  );
}

function stateHint(state: WebPushState, t: TFunction): string {
  switch (state) {
    case "enabled":
      return t("settings.notifications.webPush.state.enabled");
    case "prompt":
      return t("settings.notifications.webPush.state.prompt");
    case "denied":
      return t("settings.notifications.webPush.state.denied");
    case "unavailable":
      return t("settings.notifications.webPush.state.unavailable");
    case "unsupported":
      return t("settings.notifications.webPush.state.unsupported");
  }
}

function isIosBrowser(): boolean {
  if (Platform.OS !== "web" || typeof navigator === "undefined") {
    return false;
  }
  // iPadOS reports itself as Macintosh, so touch support separates it from a Mac.
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}
