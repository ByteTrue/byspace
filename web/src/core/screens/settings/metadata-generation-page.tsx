// Port of archive/expo-app:packages/app/src/screens/settings/metadata-generation-page.tsx: the metadata generation model section; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/agents-page-sections.py; edit it directly.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight } from "lucide-react";
import { Button } from "~/components/ui/button";
import type { AgentProvider } from "@bytetrue/protocol/agent-types";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { Spinner } from "~/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { buildSelectableProviderSelectorProviders } from "@/provider-selection/provider-selection";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { showAlert } from "~/lib/alert";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "~/components/ui/item";

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
        showAlert(
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
    (value: string) => {
      const next = modeOptions.find((option) => option.value === value)?.value;
      if (!next) return;
      setDraftMode(next);
      if (next === "automatic") {
        void saveProviders([]);
      }
    },
    [modeOptions, saveProviders],
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
      <Button variant="link" size="sm" asChild>
        <a href={METADATA_GENERATION_DOCS_URL} target="_blank" rel="noreferrer">
          {t("settings.metadataGeneration.docs")}
          <ArrowUpRight data-icon="inline-end" />
        </a>
      </Button>
    ),
    [t],
  );

  if (isConfigLoading || !config) {
    return (
      <div className="flex min-h-[180px] items-center justify-center text-muted-foreground">
        <Spinner className="size-8" />
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
      <ItemGroup>
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>{t("settings.metadataGeneration.selection")}</ItemTitle>
            <ItemDescription>
              {mode === "automatic"
                ? t("settings.metadataGeneration.automaticHint")
                : t("settings.metadataGeneration.preferredHint")}
            </ItemDescription>
          </ItemContent>
          <Tabs
            value={mode}
            onValueChange={handleModeChange}
            data-testid="metadata-generation-mode"
          >
            <TabsList>
              {modeOptions.map((option) => (
                <TabsTrigger key={option.value} value={option.value}>
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </Item>
        {mode === "preferred" ? (
          <Item variant="outline">
            <ItemContent>
              <ItemTitle>{t("settings.metadataGeneration.model")}</ItemTitle>
              <ItemDescription>{t("settings.metadataGeneration.fallbackHint")}</ItemDescription>
            </ItemContent>
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
          </Item>
        ) : null}
      </ItemGroup>
    </SettingsSection>
  );
}
