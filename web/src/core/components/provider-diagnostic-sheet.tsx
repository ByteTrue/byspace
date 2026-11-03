// Port of archive/expo-app:packages/app/src/components/provider-diagnostic-sheet.tsx: a provider's settings sheet: models, custom models, diagnostic, terminal tab; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/provider-diagnostic-sheet.py; edit it directly.
import * as Clipboard from "~/lib/clipboard";
import { AlertTriangle, Copy, FileText, Plus, RotateCw, Trash2 } from "lucide-react";
import type { TFunction } from "i18next";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Card, CardContent } from "~/components/ui/card";
import { CodeBlock, CodeBlockContent } from "~/components/ui/code-block";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { resolveProviderLabel } from "@/utils/provider-definitions";
import { TERMINAL_AGENT_HOOK_PROVIDERS } from "@/screens/settings/terminal-agent-hooks-config";
import type { TerminalAgentHookProviderId } from "@bytetrue/protocol/messages";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { ProviderTerminalIntegration } from "@/components/provider-terminal-integration";
import { formatTimeAgo } from "@/utils/time";
import { compareMatchScores, scoreTextFields } from "@bytetrue/protocol/search/text-match";
import type { AgentModelDefinition, AgentProvider } from "@bytetrue/protocol/agent-types";
import type { ProviderProfileModel } from "@bytetrue/protocol/provider-config";
import {
  resolveProviderDiscoveredModels,
  type ProviderDiscoveredModelsCache,
} from "@/components/provider-diagnostic-models";
import { useThemeObject } from "~/app/theme-object";
import { Input } from "~/components/ui/input";
import { ItemGroup } from "~/components/ui/item";

interface ProviderDiagnosticSheetProps {
  provider: string;
  visible: boolean;
  onClose: () => void;
  serverId: string;
}

const MODEL_ROW = "flex flex-row items-center gap-3 border-t px-4 py-2";
const MODEL_TITLE = "shrink-0 truncate text-sm leading-[normal] text-foreground";
const MONO_HINT =
  "shrink-0 truncate font-mono text-xs leading-[normal] text-muted-foreground select-text";

function rankModels<T>(items: T[], query: string, fields: (item: T) => string[]): T[] {
  if (!query.trim()) return items;
  const scored = items
    .map((item) => ({ item, score: scoreTextFields(query, fields(item)) }))
    .filter(
      (entry): entry is { item: T; score: NonNullable<typeof entry.score> } => entry.score !== null,
    );
  scored.sort((a, b) => compareMatchScores(a.score, b.score));
  return scored.map((entry) => entry.item);
}

function DiscoveredModelRow({ model }: { model: AgentModelDefinition }) {
  return (
    <div className={MODEL_ROW}>
      <span className={MODEL_TITLE}>{model.label}</span>
      <span className={MONO_HINT} data-pmono="">
        {model.id}
      </span>
      {model.description ? (
        <span className="min-w-0 flex-1 truncate text-xs leading-[normal] text-muted-foreground">
          {model.description}
        </span>
      ) : null}
    </div>
  );
}

function CustomModelRow({
  model,
  deleting,
  onDelete,
}: {
  model: ProviderProfileModel;
  deleting: boolean;
  onDelete: (modelId: string) => void;
}) {
  const { t } = useTranslation();
  const theme = useThemeObject();
  const handleDelete = useCallback(() => onDelete(model.id), [model.id, onDelete]);

  return (
    <div className={MODEL_ROW}>
      <span className={MODEL_TITLE}>{model.label}</span>
      <span className={MONO_HINT} data-pmono="">
        {model.id}
      </span>
      <div className="flex-1" />
      <Button
        variant="ghost"
        size="icon-sm"
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        aria-label={t("settings.providers.models.removeModel", { id: model.id })}
      >
        <Trash2 size={theme.iconSize.sm} color={theme.colors.destructive} />
      </Button>
    </div>
  );
}

function SectionHeader({ title, count, hint }: { title: string; count?: number; hint?: string }) {
  return (
    <div className="mb-2 ml-1 flex flex-row items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{title}</span>
      <div className="flex flex-row items-center gap-1">
        {count !== undefined ? (
          <span className="text-xs text-muted-foreground">{count}</span>
        ) : null}
        {count !== undefined && hint ? (
          <span className="text-xs text-muted-foreground">·</span>
        ) : null}
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
    </div>
  );
}

function AddCustomModelSubSheet({
  provider,
  serverId,
  visible,
  onClose,
  refresh,
}: {
  provider: string;
  serverId: string;
  visible: boolean;
  onClose: () => void;
  refresh: (providers?: AgentProvider[]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [input, setInput] = useState("");
  const handleInputInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setInput(event.target.value),
    [setInput],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const additionalModels = useMemo(
    () => config?.providers?.[provider]?.additionalModels ?? [],
    [config?.providers, provider],
  );
  const trimmed = input.trim();
  const canAdd = trimmed.length > 0 && !additionalModels.some((model) => model.id === trimmed);

  useEffect(() => {
    if (!visible) {
      setInput("");
      setError(null);
    }
  }, [visible]);

  const handleAdd = useCallback(() => {
    if (!canAdd) return;
    setError(null);
    setSaving(true);
    void patchConfig({
      providers: {
        [provider]: {
          additionalModels: [...additionalModels, { id: trimmed, label: trimmed }],
        },
      },
    })
      .then(() => refresh([provider]))
      .then(() => onClose())
      .catch((err) => {
        setError(err instanceof Error ? err.message : t("settings.providers.models.failedToSave"));
      })
      .finally(() => setSaving(false));
  }, [additionalModels, canAdd, onClose, patchConfig, provider, refresh, t, trimmed]);
  const handleAddEnter = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing) handleAdd();
    },
    [handleAdd],
  );

  const header = useMemo<SheetHeader>(
    () => ({ title: t("settings.providers.models.addCustomTitle") }),
    [t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      desktopMaxWidth={420}
      testID="add-custom-model-sheet"
    >
      <div className="flex flex-col gap-3">
        <span className="text-sm leading-[normal] font-medium text-foreground">
          {t("settings.providers.models.modelId")}
        </span>
        <Input
          defaultValue={input}
          key={`add-custom-${visible}`}
          onChange={handleInputInput}
          onKeyDown={handleAddEnter}
          placeholder={t("settings.providers.models.modelIdPlaceholder")}
          autoCapitalize="none"
          autoCorrect="off"
          enterKeyHint="done"
        />
        {error ? <span className="text-xs leading-[normal] text-destructive">{error}</span> : null}
        <div className="flex flex-row justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            {t("common.actions.cancel")}
          </Button>
          <Button variant="default" size="sm" onClick={handleAdd} disabled={!canAdd || saving}>
            {saving ? t("settings.providers.models.adding") : t("settings.providers.models.add")}
          </Button>
        </div>
      </div>
    </AdaptiveModalSheet>
  );
}

function DiagnosticSubSheet({
  provider,
  serverId,
  visible,
  onClose,
}: {
  provider: string;
  serverId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const theme = useThemeObject();
  const toast = useToast();
  const client = useHostRuntimeClient(serverId);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchDiagnostic = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    try {
      const result = await client.getProviderDiagnostic(provider);
      setDiagnostic(result.diagnostic);
    } catch (err) {
      setDiagnostic(
        err instanceof Error ? err.message : t("settings.providers.diagnostic.failedToFetch"),
      );
    } finally {
      setLoading(false);
    }
  }, [client, provider, t]);

  useEffect(() => {
    if (visible) {
      void fetchDiagnostic();
    } else {
      setDiagnostic(null);
    }
  }, [visible, fetchDiagnostic]);

  const handleRefreshPress = useCallback(() => {
    void fetchDiagnostic();
  }, [fetchDiagnostic]);

  const handleCopyPress = useCallback(() => {
    if (!diagnostic) return;
    void Clipboard.writeText(diagnostic)
      .then(() => toast.copied(t("settings.providers.diagnostic.copyLabel")))
      .catch(() => toast.error(t("settings.providers.diagnostic.copyFailed")));
  }, [diagnostic, t, toast]);

  const header = useMemo<SheetHeader>(
    () => ({
      title: t("settings.providers.diagnostic.title"),
      actions: (
        <div className="flex flex-row items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            onClick={handleCopyPress}
            disabled={!diagnostic}
            aria-label={t("settings.providers.diagnostic.copyAccessibility")}
          >
            <Copy size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            onClick={handleRefreshPress}
            disabled={loading}
            aria-label={
              loading
                ? t("settings.providers.diagnostic.refreshingAccessibility")
                : t("settings.providers.diagnostic.refreshAccessibility")
            }
          >
            {loading ? (
              <Spinner className="text-muted-foreground" />
            ) : (
              <RotateCw size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
            )}
          </Button>
        </div>
      ),
    }),
    [
      diagnostic,
      handleCopyPress,
      handleRefreshPress,
      loading,
      t,
      theme.colors.foregroundMuted,
      theme.iconSize.sm,
    ],
  );

  let body: React.ReactNode;
  if (loading && !diagnostic) {
    body = (
      <Card key={visible ? "visible" : "hidden"} size="sm">
        <CardContent className="flex flex-row items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          {t("settings.providers.diagnostic.running")}
        </CardContent>
      </Card>
    );
  } else if (diagnostic) {
    body = (
      <CodeBlock key={visible ? "visible" : "hidden"}>
        <CodeBlockContent className="max-h-[480px]">{diagnostic}</CodeBlockContent>
      </CodeBlock>
    );
  } else {
    body = (
      <Card key={visible ? "visible" : "hidden"} size="sm">
        <CardContent className="text-sm text-muted-foreground">
          {t("settings.providers.diagnostic.none")}
        </CardContent>
      </Card>
    );
  }

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      scrollable={false}
      testID="provider-diagnostic-sheet"
    >
      {body}
    </AdaptiveModalSheet>
  );
}

interface ProviderModalBodyProps {
  discoveredCount: number;
  additionalCount: number;
  providerSnapshotRefreshing: boolean;
  providerErrorMessage: string | null;
  modelsRefreshing: boolean;
  searchActive: boolean;
  filteredDiscovered: AgentModelDefinition[];
  filteredCustom: ProviderProfileModel[];
  deletingModelId: string | null;
  onRefresh: () => void;
  onDeleteCustom: (modelId: string) => void;
  theme: { iconSize: { md: number }; colors: { foregroundMuted: string } };
}

interface ProviderSheetFooterInput {
  fetchedAtLabel: string | null;
  isCompact: boolean;
  modelsRefreshing: boolean;
  t: TFunction;
  onOpenAddSheet: () => void;
  onOpenDiagSheet: () => void;
  onRefreshModels: () => void;
}

function renderProviderSheetFooter({
  fetchedAtLabel,
  isCompact,
  modelsRefreshing,
  t,
  onOpenAddSheet,
  onOpenDiagSheet,
  onRefreshModels,
}: ProviderSheetFooterInput) {
  const buttonClassName = isCompact ? "self-stretch" : undefined;

  return (
    <div
      className={cn(
        "flex flex-1 gap-2",
        isCompact ? "flex-col" : "flex-row items-center justify-between",
      )}
    >
      {fetchedAtLabel || !isCompact ? (
        <span
          className={cn(
            "truncate text-xs leading-[normal] text-muted-foreground",
            !isCompact && "flex-1",
          )}
        >
          {fetchedAtLabel ? t("settings.providers.models.updated", { time: fetchedAtLabel }) : ""}
        </span>
      ) : null}
      <div className={cn("flex gap-2", isCompact ? "flex-col" : "flex-row items-center")}>
        <Button variant="secondary" size="sm" onClick={onOpenAddSheet} className={buttonClassName}>
          <Plus data-icon="inline-start" />
          {t("settings.providers.models.addModel")}
        </Button>
        <Button variant="secondary" size="sm" onClick={onOpenDiagSheet} className={buttonClassName}>
          <FileText data-icon="inline-start" />
          {t("settings.providers.diagnostic.button")}
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={onRefreshModels}
          className={buttonClassName}
          disabled={modelsRefreshing}
        >
          {modelsRefreshing ? null : <RotateCw data-icon="inline-start" />}
          {modelsRefreshing
            ? t("settings.providers.diagnostic.refreshing")
            : t("settings.providers.diagnostic.refresh")}
        </Button>
      </div>
    </div>
  );
}

function ProviderModalBody(props: ProviderModalBodyProps) {
  const { t } = useTranslation();
  const {
    discoveredCount,
    additionalCount,
    providerSnapshotRefreshing,
    providerErrorMessage,
    modelsRefreshing,
    searchActive,
    filteredDiscovered,
    filteredCustom,
    deletingModelId,
    onRefresh,
    onDeleteCustom,
    theme,
  } = props;

  if (discoveredCount === 0 && additionalCount === 0 && providerSnapshotRefreshing) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <Spinner className="text-muted-foreground" />
        <span className="text-sm leading-[normal] text-muted-foreground">
          {t("settings.providers.models.loading")}
        </span>
      </div>
    );
  }
  if (discoveredCount === 0 && additionalCount === 0 && providerErrorMessage) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <AlertTriangle size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
        <span className="text-sm leading-[normal] text-muted-foreground text-center">
          {providerErrorMessage}
        </span>
        <Button variant="default" size="sm" onClick={onRefresh} disabled={modelsRefreshing}>
          {modelsRefreshing
            ? t("settings.providers.models.retrying")
            : t("settings.providers.models.retry")}
        </Button>
      </div>
    );
  }
  if (filteredDiscovered.length === 0 && filteredCustom.length === 0 && searchActive) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <span className="text-sm leading-[normal] text-muted-foreground">
          {t("settings.providers.models.noSearchMatches")}
        </span>
      </div>
    );
  }
  if (discoveredCount === 0 && additionalCount === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <span className="text-sm leading-[normal] text-muted-foreground">
          {t("settings.providers.models.noneDetected")}
        </span>
      </div>
    );
  }
  return (
    <>
      {filteredDiscovered.length > 0 ? (
        <div className="mb-4 flex flex-col">
          <SectionHeader
            title={t("settings.providers.models.discovered")}
            count={filteredDiscovered.length}
          />
          <ItemGroup>
            {filteredDiscovered.map((model) => (
              <DiscoveredModelRow key={model.id} model={model} />
            ))}
          </ItemGroup>
        </div>
      ) : null}
      {filteredCustom.length > 0 ? (
        <div className="mb-4 flex flex-col">
          <SectionHeader
            title={t("settings.providers.models.custom")}
            count={filteredCustom.length}
          />
          <ItemGroup>
            {filteredCustom.map((model) => (
              <CustomModelRow
                key={model.id}
                model={model}
                deleting={deletingModelId === model.id}
                onDelete={onDeleteCustom}
              />
            ))}
          </ItemGroup>
        </div>
      ) : null}
    </>
  );
}

export function ProviderDiagnosticSheet({
  provider,
  visible,
  onClose,
  serverId,
}: ProviderDiagnosticSheetProps) {
  const { t } = useTranslation();
  const theme = useThemeObject();
  const isCompact = useIsCompactFormFactor();
  const { entries: snapshotEntries, refresh, isRefreshing } = useProvidersSnapshot(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"agent" | "terminal">("agent");
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [diagSheetOpen, setDiagSheetOpen] = useState(false);
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);

  const providerLabel = resolveProviderLabel(provider, snapshotEntries);
  const providerEntry = useMemo(
    () => snapshotEntries?.find((entry) => entry.provider === provider),
    [snapshotEntries, provider],
  );
  const additionalModels = useMemo(
    () => config?.providers?.[provider]?.additionalModels ?? [],
    [config?.providers, provider],
  );
  const providerSnapshotRefreshing = providerEntry?.status === "loading";
  const providerErrorMessage =
    providerEntry?.status === "error"
      ? (providerEntry.error ?? t("settings.providers.diagnostic.unknownError"))
      : null;
  const modelsRefreshing = isRefreshing || providerSnapshotRefreshing;

  const stableDiscoveredRef = useRef<ProviderDiscoveredModelsCache | null>(null);
  const currentModels = providerEntry?.models;
  const { models: discoveredModels, cache: nextDiscoveredCache } = resolveProviderDiscoveredModels({
    serverId,
    provider,
    currentModels,
    providerSnapshotRefreshing,
    previousCache: stableDiscoveredRef.current,
  });
  stableDiscoveredRef.current = nextDiscoveredCache;

  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setClockTick((tick) => tick + 1), 10_000);
    return () => clearInterval(id);
  }, [visible]);
  const fetchedAtLabel = useMemo(() => {
    if (!providerEntry?.fetchedAt) return null;
    void clockTick;
    return formatTimeAgo(new Date(providerEntry.fetchedAt));
  }, [providerEntry?.fetchedAt, clockTick]);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setTab("agent");
      setAddSheetOpen(false);
      setDiagSheetOpen(false);
    }
  }, [visible]);

  const q = query.trim();
  const filteredDiscovered = useMemo(
    () => rankModels(discoveredModels, q, (m) => [m.label, m.id, m.description ?? ""]),
    [discoveredModels, q],
  );
  const filteredCustom = useMemo(
    () => rankModels(additionalModels, q, (m) => [m.label, m.id]),
    [additionalModels, q],
  );

  const handleRefreshModels = useCallback(() => {
    void refresh([provider]);
  }, [provider, refresh]);

  const handleOpenAddSheet = useCallback(() => setAddSheetOpen(true), []);
  const handleCloseAddSheet = useCallback(() => setAddSheetOpen(false), []);
  const handleOpenDiagSheet = useCallback(() => setDiagSheetOpen(true), []);
  const handleCloseDiagSheet = useCallback(() => setDiagSheetOpen(false), []);

  const handleDeleteCustom = useCallback(
    (modelId: string) => {
      setDeletingModelId(modelId);
      void patchConfig({
        providers: {
          [provider]: {
            additionalModels: additionalModels.filter((model) => model.id !== modelId),
          },
        },
      })
        .then(() => refresh([provider]))
        .finally(() => {
          setDeletingModelId((current) => (current === modelId ? null : current));
        });
    },
    [additionalModels, patchConfig, provider, refresh],
  );

  const isTerminalProvider = useMemo(
    () =>
      TERMINAL_AGENT_HOOK_PROVIDERS.some(
        (candidate) => candidate.id === (provider as TerminalAgentHookProviderId),
      ),
    [provider],
  );

  // The switcher lives in the header next to the provider name, not as a bar
  // above the body: the sheet is the provider's page, and the tab is which face
  // of that one provider you are looking at. It sits before the close button,
  // which is the only other thing the header owes the user.
  const tabOptions = useMemo(
    () => [
      { value: "agent" as const, label: t("settings.providers.tabs.agent") },
      { value: "terminal" as const, label: t("settings.providers.tabs.terminal") },
    ],
    [t],
  );
  const handleTabChange = useCallback(
    (value: string) => {
      const next = tabOptions.find((option) => option.value === value)?.value;
      if (next) setTab(next);
    },
    [tabOptions],
  );
  const sheetHeader = useMemo<SheetHeader>(
    () => ({
      title: providerLabel,
      actions: isTerminalProvider ? (
        <Tabs value={tab} onValueChange={handleTabChange} data-testid="provider-sheet-tabs">
          <TabsList>
            {tabOptions.map((option) => (
              <TabsTrigger key={option.value} value={option.value}>
                {option.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : undefined,
      search:
        tab === "agent"
          ? {
              onChange: setQuery,
              placeholder: t("settings.providers.models.searchPlaceholder"),
              testID: "provider-settings-search",
            }
          : undefined,
    }),
    [providerLabel, isTerminalProvider, tab, tabOptions, handleTabChange, t],
  );

  return (
    <>
      <AdaptiveModalSheet
        header={sheetHeader}
        visible={visible}
        onClose={onClose}
        testID="provider-settings-sheet"
        footer={
          tab === "agent"
            ? renderProviderSheetFooter({
                fetchedAtLabel,
                isCompact,
                modelsRefreshing,
                t,
                onOpenAddSheet: handleOpenAddSheet,
                onOpenDiagSheet: handleOpenDiagSheet,
                onRefreshModels: handleRefreshModels,
              })
            : undefined
        }
        // Fixed height across both faces: the Agent tab is a long model list and
        // the Terminal tab is two rows, so a content-sized card visibly resized
        // and re-centred when the switcher was used. It matches the sheet's own
        // open detent so desktop and compact agree on how tall a provider is.
        desktopHeight={DESKTOP_SHEET_HEIGHT}
      >
        {isTerminalProvider && tab === "terminal" ? (
          <ProviderTerminalIntegration
            serverId={serverId}
            provider={provider as TerminalAgentHookProviderId}
          />
        ) : (
          <ProviderModalBody
            discoveredCount={discoveredModels.length}
            additionalCount={additionalModels.length}
            providerSnapshotRefreshing={providerSnapshotRefreshing}
            providerErrorMessage={providerErrorMessage}
            modelsRefreshing={modelsRefreshing}
            searchActive={Boolean(q)}
            filteredDiscovered={filteredDiscovered}
            filteredCustom={filteredCustom}
            deletingModelId={deletingModelId}
            onRefresh={handleRefreshModels}
            onDeleteCustom={handleDeleteCustom}
            theme={theme}
          />
        )}
      </AdaptiveModalSheet>
      <AddCustomModelSubSheet
        provider={provider}
        serverId={serverId}
        visible={addSheetOpen}
        onClose={handleCloseAddSheet}
        refresh={refresh}
      />
      <DiagnosticSubSheet
        provider={provider}
        serverId={serverId}
        visible={diagSheetOpen}
        onClose={handleCloseDiagSheet}
      />
    </>
  );
}

// Open and expanded detents for the compact bottom sheet. The desktop card
// pins to the first one so both faces of the sheet keep one height (see the
// `desktopHeight` note on the sheet below).
const DESKTOP_SHEET_HEIGHT = "65%";
