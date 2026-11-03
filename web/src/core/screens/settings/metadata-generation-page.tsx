// Port of packages/app/src/screens/settings/metadata-generation-page.tsx: the metadata generation model section; DOM view.
// Converted from the Expo file by web/scripts/port/agents-page-sections.py (tag archive/expo-app); edit it directly.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import { cn } from "cn";
import { useTranslation } from "react-i18next";
import type { AgentProvider } from "@bytetrue/protocol/agent-types";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { ExternalLink } from "@/components/ui/external-link";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { buildSelectableProviderSelectorProviders } from "@/provider-selection/provider-selection";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";

const METADATA_GENERATION_DOCS_URL =
  "https://github.com/ByteTrue/byspace/blob/main/public-docs/metadata-generation.md";
type SelectionMode = "automatic" | "preferred";

export function MetadataGenerationPage({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const { config, isLoading: isConfigLoading, patchConfig } = useDaemonConfig(serverId);
  const snapshot = useProvidersSnapshot(serverId);
  const providers = useMemo(
    () => buildSelectableProviderSelectorProviders(snapshot.entries),
    [snapshot.entries],
  );
  const configuredProviders = config?.metadataGeneration.providers;
  const configuredProvider = configuredProviders?.[0] ?? null;
  const savedMode: SelectionMode = configuredProvider ? "preferred" : "automatic";
  const [draftMode, setDraftMode] = useState<SelectionMode | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const mode = draftMode ?? savedMode;

  useEffect(() => {
    setDraftMode(null);
  }, [configuredProvider?.model, configuredProvider?.provider]);

  const modeOptions = useMemo(
    () => [
      { value: "automatic" as const, label: t("settings.metadataGeneration.automatic") },
      { value: "preferred" as const, label: t("settings.metadataGeneration.preferred") },
    ],
    [t],
  );

  const saveProviders = useCallback(
    async (providersPatch: { provider: string; model?: string }[]) => {
      setIsSaving(true);
      try {
        await patchConfig({ metadataGeneration: { providers: providersPatch } });
      } catch (error) {
        setDraftMode(null);
        Alert.alert(
          t("settings.metadataGeneration.saveError"),
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setIsSaving(false);
      }
    },
    [patchConfig, t],
  );

  const handleModeChange = useCallback(
    (next: SelectionMode) => {
      setDraftMode(next);
      if (next === "automatic") {
        void saveProviders([]);
      }
    },
    [saveProviders],
  );

  const handleModelSelect = useCallback(
    (provider: AgentProvider, model: string) => {
      setDraftMode("preferred");
      void saveProviders([
        { provider, ...(model ? { model } : {}) },
        ...(configuredProviders?.slice(1) ?? []),
      ]);
    },
    [configuredProviders, saveProviders],
  );

  const handleSelectorOpen = useCallback(() => {
    snapshot.refetchIfStale(configuredProvider?.provider);
  }, [configuredProvider?.provider, snapshot]);
  const handleRetryProvider = useCallback(
    (provider: AgentProvider) => snapshot.refresh([provider]),
    [snapshot],
  );
  const docsLink = useMemo(
    () => (
      <ExternalLink
        href={METADATA_GENERATION_DOCS_URL}
        label={t("settings.metadataGeneration.docs")}
      />
    ),
    [t],
  );

  if (isConfigLoading || !config) {
    return (
      <div className="flex min-h-[180px] items-center justify-center text-muted-foreground">
        <LoadingSpinner size="large" />
      </div>
    );
  }

  return (
    <SettingsSection
      title={t("settings.metadataGeneration.title")}
      info={t("settings.metadataGeneration.description")}
      trailing={docsLink}
      testID="metadata-generation-settings"
    >
      <div className={settingsStyles.card}>
        <div className={settingsStyles.row}>
          <div className={settingsStyles.rowContent}>
            <span className={settingsStyles.rowTitle}>
              {t("settings.metadataGeneration.selection")}
            </span>
            <span className={settingsStyles.rowHint}>
              {mode === "automatic"
                ? t("settings.metadataGeneration.automaticHint")
                : t("settings.metadataGeneration.preferredHint")}
            </span>
          </div>
          <SegmentedControl
            options={modeOptions}
            value={mode}
            onValueChange={handleModeChange}
            size="sm"
            testID="metadata-generation-mode"
          />
        </div>
        {mode === "preferred" ? (
          <div className={cn(settingsStyles.row, settingsStyles.rowBorder)}>
            <div className={settingsStyles.rowContent}>
              <span className={settingsStyles.rowTitle}>
                {t("settings.metadataGeneration.model")}
              </span>
              <span className={settingsStyles.rowHint}>
                {t("settings.metadataGeneration.fallbackHint")}
              </span>
            </div>
            <CombinedModelSelector
              providers={providers}
              selectedProvider={configuredProvider?.provider ?? ""}
              selectedModel={configuredProvider?.model ?? ""}
              onSelect={handleModelSelect}
              isLoading={snapshot.isLoading || snapshot.isFetching}
              onOpen={handleSelectorOpen}
              onRetryProvider={handleRetryProvider}
              isRetryingProvider={snapshot.isRefreshing}
              disabled={isSaving}
              serverId={serverId}
              // The section sits at the bottom of the Agents page; the combobox
              // has no web-side flip, so a bottom placement clips the option
              // list below the viewport.
              desktopPlacement="top-start"
              desktopMinWidth={360}
            />
          </div>
        ) : null}
      </div>
    </SettingsSection>
  );
}
