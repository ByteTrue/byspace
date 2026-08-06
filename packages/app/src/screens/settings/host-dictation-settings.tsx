import type { TFunction } from "i18next";
import type { SpeechModelId, SpeechModelPayload } from "@bytetrue/byspace-protocol/messages";
import { Download, Trash2 } from "lucide-react-native";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";

type ModelAction = "download" | "select" | "delete";

function formatSize(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

function statusLabel(model: SpeechModelPayload, selected: boolean, t: TFunction): string {
  if (selected && model.state === "ready") return t("settings.host.dictation.status.inUse");
  if (model.state === "downloading") return t("settings.host.dictation.status.downloading");
  if (model.state === "ready") return t("settings.host.dictation.status.downloaded");
  if (model.state === "error") return t("settings.host.dictation.status.failed");
  if (model.state === "not_downloaded") return t("settings.host.dictation.status.notDownloaded");
  return model.state;
}

function modelDescription(model: SpeechModelPayload, t: TFunction): string {
  if (model.id === "fire-red-asr2-aed-int8") {
    return t("settings.host.dictation.models.fireRedDescription");
  }
  if (model.id === "sensevoice-small-int8") {
    return t("settings.host.dictation.models.senseVoiceDescription");
  }
  return model.description;
}

function SpeechModelRow({
  model,
  selected,
  pending,
  isFirst,
  onAction,
  t,
}: {
  model: SpeechModelPayload;
  selected: boolean;
  pending: boolean;
  isFirst: boolean;
  onAction: (modelId: SpeechModelId, action: ModelAction) => Promise<void>;
  t: TFunction;
}) {
  const select = useCallback(() => void onAction(model.id, "select"), [model.id, onAction]);
  const download = useCallback(() => void onAction(model.id, "download"), [model.id, onAction]);
  const remove = useCallback(() => void onAction(model.id, "delete"), [model.id, onAction]);
  const downloadable = model.state === "not_downloaded" || model.state === "error";

  return (
    <View
      style={[settingsStyles.row, !isFirst && settingsStyles.rowBorder, styles.modelRow]}
      testID={`speech-model-${model.id}`}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{model.label}</Text>
        <Text style={selected ? styles.selectedStatus : styles.meta}>
          {formatSize(model.sizeBytes)} · {statusLabel(model, selected, t)}
        </Text>
        <Text style={settingsStyles.rowHint}>{modelDescription(model, t)}</Text>
        {model.error ? <Text style={settingsStyles.rowError}>{model.error}</Text> : null}
      </View>
      <View style={styles.actions}>
        {model.state === "ready" && !selected ? (
          <Button
            size="sm"
            testID={`speech-model-action-${model.id}`}
            variant="outline"
            disabled={pending}
            loading={pending}
            onPress={select}
          >
            {t("settings.host.dictation.actions.use")}
          </Button>
        ) : null}
        {model.state !== "ready" ? (
          <Button
            size="sm"
            testID={`speech-model-action-${model.id}`}
            variant="outline"
            leftIcon={Download}
            disabled={!downloadable || pending}
            loading={pending || model.state === "downloading"}
            onPress={download}
          >
            {downloadable
              ? t("settings.host.dictation.actions.downloadAndUse")
              : statusLabel(model, selected, t)}
          </Button>
        ) : null}
        {model.state === "ready" ? (
          <Button
            size="sm"
            variant="ghost"
            leftIcon={Trash2}
            disabled={pending}
            accessibilityLabel={t("settings.host.dictation.actions.delete", {
              model: model.label,
            })}
            onPress={remove}
          />
        ) : null}
      </View>
    </View>
  );
}

export function HostDictationSettings({ serverId }: { serverId: string }) {
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const supported = useHostFeature(serverId, "speechModelSelection");
  const refinementSupported = useHostFeature(serverId, "dictationRefinement");
  const { config, patchConfig } = useDaemonConfig(serverId);
  const toast = useToast();
  const { t } = useTranslation();
  const [models, setModels] = useState<SpeechModelPayload[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<SpeechModelId | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingModelId, setPendingModelId] = useState<SpeechModelId | null>(null);

  const load = useCallback(async () => {
    if (!client || !connected || !supported) return;
    try {
      const result = await client.listSpeechModels();
      if (result.error) throw new Error(result.error);
      setModels(result.models);
      setSelectedModelId(result.selectedModelId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settings.host.dictation.loadError"));
    } finally {
      setLoading(false);
    }
  }, [client, connected, supported, t, toast]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const downloading = useMemo(
    () => models.some((model) => model.state === "downloading"),
    [models],
  );
  useEffect(() => {
    if (!downloading) return;
    const timer = setInterval(() => void load(), 1500);
    return () => clearInterval(timer);
  }, [downloading, load]);

  const mutate = useCallback(
    async (modelId: SpeechModelId, action: ModelAction) => {
      if (!client) return;
      setPendingModelId(modelId);
      try {
        let result;
        if (action === "download") result = await client.downloadSpeechModel(modelId);
        else if (action === "select") result = await client.selectSpeechModel(modelId);
        else result = await client.deleteSpeechModel(modelId);
        if (!result.accepted) {
          throw new Error(result.error ?? t("settings.host.dictation.operationError"));
        }
        await load();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("settings.host.dictation.operationError"),
        );
      } finally {
        setPendingModelId(null);
      }
    },
    [client, load, t, toast],
  );

  const handleRefinementChange = useCallback(
    (refineWithAgent: boolean) => {
      void patchConfig({ dictation: { refineWithAgent } });
    },
    [patchConfig],
  );

  let content: ReactNode;
  if (!supported) {
    content = <Text style={styles.emptyText}>{t("settings.host.dictation.updateHost")}</Text>;
  } else if (!connected) {
    content = <Text style={styles.emptyText}>{t("settings.host.dictation.disconnected")}</Text>;
  } else if (loading && models.length === 0) {
    content = <Text style={styles.emptyText}>{t("settings.host.dictation.loading")}</Text>;
  } else {
    content = models.map((model, index) => (
      <SpeechModelRow
        key={model.id}
        model={model}
        selected={selectedModelId === model.id}
        pending={pendingModelId === model.id}
        isFirst={index === 0}
        onAction={mutate}
        t={t}
      />
    ));
  }

  return (
    <SettingsSection title={t("settings.host.dictation.title")} testID="host-dictation-settings">
      <View style={settingsStyles.card}>
        {Array.isArray(content) ? content : <View style={styles.emptyRow}>{content}</View>}
      </View>
      {refinementSupported ? (
        <View style={settingsStyles.card} testID="dictation-refinement-card">
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>
                {t("settings.host.dictation.refinement.title")}
              </Text>
              <Text style={settingsStyles.rowHint}>
                {t("settings.host.dictation.refinement.hint")}
              </Text>
            </View>
            <Switch
              value={config?.dictation?.refineWithAgent ?? false}
              disabled={!connected}
              onValueChange={handleRefinementChange}
              accessibilityLabel={t("settings.host.dictation.refinement.accessibilityLabel")}
            />
          </View>
        </View>
      ) : null}
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  modelRow: {
    gap: theme.spacing[3],
    minHeight: 56,
  },
  meta: {
    marginTop: theme.spacing[1],
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  selectedStatus: {
    marginTop: theme.spacing[1],
    fontSize: theme.fontSize.xs,
    color: theme.colors.statusSuccess,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  emptyRow: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
