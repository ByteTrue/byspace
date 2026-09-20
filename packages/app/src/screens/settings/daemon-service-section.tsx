import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { Alert as InlineAlert } from "@/components/ui/alert";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";

const SERVICE_STATES = new Set([
  "not-installed",
  "installed-stopped",
  "installed-running-not-this-process",
  "managed-by-service",
  "unknown",
]);

interface ServiceView {
  state: string;
  label: string;
  linger?: boolean;
}

/**
 * Host settings toggle for daemon service hosting (issue 043). Only rendered for the
 * local daemon with the daemonServiceInstall capability: the install must run in the
 * daemon's own process with its install-origin context, so remote hosts never show
 * this switch.
 *
 * The switch reads the daemon-probed service state, never local memory. Unknown state
 * leaves the switch visible but off, with the unknown hint instead of a fake verdict.
 */
export function DaemonServiceSection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const serviceFeature = useHostFeature(serverId, "daemonServiceInstall");
  const { config } = useDaemonConfig(serverId);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const serviceView = useMemo(() => {
    const raw = (config as { service?: unknown } | undefined)?.service;
    if (
      raw &&
      typeof raw === "object" &&
      "state" in raw &&
      typeof (raw as { state: unknown }).state === "string" &&
      SERVICE_STATES.has((raw as { state: string }).state)
    ) {
      return raw as ServiceView;
    }
    return null;
  }, [config]);

  const managed = serviceView?.state === "managed-by-service";
  const stateKnown = serviceView !== null && serviceView.state !== "unknown";

  const handleToggle = useCallback(
    async (install: boolean) => {
      if (!client) return;
      setIsBusy(true);
      setError(null);
      try {
        await client.patchDaemonConfig({ service: { install } });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsBusy(false);
      }
    },
    [client],
  );

  if (serviceFeature !== true) {
    return null;
  }

  if (!isConnected) {
    return (
      <SettingsSection title={t("settings.host.daemon.service.sectionTitle")}>
        <View style={settingsStyles.card}>
          <Text style={settingsStyles.rowHint}>
            {t("settings.host.daemon.service.unavailable")}
          </Text>
        </View>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title={t("settings.host.daemon.service.sectionTitle")}>
      {error ? (
        <View style={stylesLocal.errorWrap}>
          <InlineAlert
            variant="error"
            title={t("settings.host.daemon.service.errorTitle")}
            description={error}
            testID="host-page-service-error"
          />
        </View>
      ) : null}
      <View style={settingsStyles.card} testID="host-page-service-card">
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.host.daemon.service.toggle.title")}
            </Text>
            <Text style={settingsStyles.rowHint}>
              {stateKnown
                ? t(`settings.host.daemon.service.state.${serviceView?.state}`)
                : t("settings.host.daemon.service.state.unknown")}
            </Text>
            {serviceView?.linger === false ? (
              <Text style={settingsStyles.rowHint}>
                {t("settings.host.daemon.service.lingerHint")}
              </Text>
            ) : null}
          </View>
          <Switch
            value={managed}
            disabled={isBusy}
            onValueChange={handleToggle}
            accessibilityLabel={t("settings.host.daemon.service.toggle.title")}
            testID="host-page-service-switch"
          />
        </View>
      </View>
    </SettingsSection>
  );
}

const stylesLocal = {
  errorWrap: { marginBottom: 8 } as const,
};
