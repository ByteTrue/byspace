import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { SelectField } from "@/components/ui/select-field";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { DetectedShell } from "@getpaseo/protocol/messages";

const AUTO_SHELL_VALUE = "__auto__";

interface DefaultShellSectionProps {
  serverId: string;
}

interface ShellSelectValue {
  /** null = auto (follow the daemon's default resolution). */
  path: string | null;
}

export function DefaultShellSection({ serverId }: DefaultShellSectionProps) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const client = useHostRuntimeClient(serverId);
  const isSupported = useHostFeature(serverId, "terminalShellConfig");
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [detected, setDetected] = useState<DetectedShell[]>([]);
  const [resolvedDefault, setResolvedDefault] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const configured = config?.terminalDefaultShell ?? null;

  useEffect(() => {
    if (!isConnected || !isSupported || !client) {
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    const run = async () => {
      try {
        const result = await client.detectTerminalShells();
        if (cancelled) return;
        setDetected(result.shells);
        setResolvedDefault(result.resolvedDefault);
      } catch {
        if (!cancelled) setDetected([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [client, isConnected, isSupported]);

  const options = useMemo(
    () => [
      {
        id: AUTO_SHELL_VALUE,
        value: { path: null } as ShellSelectValue,
        label: t("settings.host.terminalDefaultShell.autoOption"),
        description: resolvedDefault ?? undefined,
      },
      ...detected.map((shell) => ({
        id: shell.path,
        value: { path: shell.path } as ShellSelectValue,
        label: shell.name,
        description: shell.path,
      })),
    ],
    [detected, resolvedDefault, t],
  );

  const selectedValue = useMemo<ShellSelectValue | null>(
    () => ({ path: configured }),
    [configured],
  );

  const selectedDisplay = useMemo(() => {
    if (configured === null) {
      return { label: t("settings.host.terminalDefaultShell.autoOption") };
    }
    const match = detected.find((shell) => shell.path === configured);
    return { label: match?.name ?? configured, description: match?.path ?? configured };
  }, [configured, detected, t]);

  const handleChange = useCallback(
    async (value: ShellSelectValue) => {
      setIsSaving(true);
      setSaveError(null);
      try {
        // null clears the configured shell ("Auto"); the daemon persists null
        // and resolves absent/null back to auto on read.
        await patchConfig({ terminalDefaultShell: value.path });
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : null);
      } finally {
        setIsSaving(false);
      }
    },
    [patchConfig],
  );

  const handleSelectChange = useCallback(
    (value: ShellSelectValue) => {
      void handleChange(value);
    },
    [handleChange],
  );

  const getValueKey = useCallback((value: ShellSelectValue) => value.path ?? AUTO_SHELL_VALUE, []);

  if (!isConnected) {
    return null;
  }

  if (!isSupported) {
    return null;
  }

  return (
    <SettingsSection
      title={t("settings.host.terminalDefaultShell.sectionTitle")}
      testID="terminal-default-shell-section"
    >
      <View style={settingsStyles.card} testID="terminal-default-shell-card">
        <View style={styles.fieldWrapper}>
          <SelectField<ShellSelectValue>
            label={t("settings.host.terminalDefaultShell.label")}
            hint={
              configured
                ? t("settings.host.terminalDefaultShell.configuredHint")
                : t("settings.host.terminalDefaultShell.autoHint")
            }
            value={selectedValue}
            selectedDisplay={selectedDisplay}
            options={options}
            onChange={handleSelectChange}
            placeholder={t("settings.host.terminalDefaultShell.autoOption")}
            emptyText={t("settings.host.terminalDefaultShell.empty")}
            loading={isLoading || isSaving}
            disabled={isSaving}
            getValueKey={getValueKey}
            testID="terminal-default-shell-field"
            triggerTestID="terminal-default-shell-trigger"
          />
          {saveError ? (
            <Text style={styles.errorText} testID="terminal-default-shell-error">
              {saveError}
            </Text>
          ) : null}
        </View>
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  fieldWrapper: {
    padding: theme.spacing[4],
    gap: theme.spacing[2],
  },
  errorText: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
}));
