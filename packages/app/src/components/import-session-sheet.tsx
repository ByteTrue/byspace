import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, type PressableStateCallbackType, Text, View } from "react-native";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type {
  DaemonClient,
  FetchRecentProviderSessionEntry,
} from "@getpaseo/client/internal/daemon-client";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import { ChevronDown, Inbox, Layers, RotateCw } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import {
  SelectField,
  type SelectFieldDisplay,
  type SelectFieldOption,
} from "@/components/ui/select-field";
import { getProviderIcon } from "@/components/provider-icons";
import { formatTimeAgo } from "@/utils/time";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostFeature } from "@/runtime/host-features";
import { i18n } from "@/i18n/i18next";
import {
  aggregateSessionEntries,
  ALL_FILTER_VALUE,
  buildProviderLabelMap,
  collectErroredProviderLabels,
  computeEmptyState,
  getPromptPreview,
  getSessionTitle,
  PER_PROVIDER_LIMIT,
  resolveProvidersToFetch,
  requiresImportSessionsHostUpgrade,
  sumFilteredAlreadyImportedCount,
} from "@/components/import-session-sheet-view-model";

const IMPORT_SHEET_SNAP_POINTS = ["70%", "92%"];
const DISABLED_ACCESSIBILITY_STATE = { disabled: true };

type RecentProviderSessionsClient = Pick<
  DaemonClient,
  "fetchRecentProviderSessions" | "importAgent"
>;

type ImportedAgent = Awaited<ReturnType<RecentProviderSessionsClient["importAgent"]>>;

interface ImportSessionSheetProps {
  visible: boolean;
  client: RecentProviderSessionsClient | null;
  serverId: string | null;
  cwd?: string | null;
  workspaceId?: string | null;
  onClose: () => void;
  onImportedAgent?: (agentId: string) => void;
  onImported?: (agent: ImportedAgent) => void;
}

type RecentSessionsResponse = Awaited<
  ReturnType<RecentProviderSessionsClient["fetchRecentProviderSessions"]>
>;

interface SessionsQueryConfig {
  queryKey: ReadonlyArray<string | null>;
  enabled: boolean;
  queryFn: () => Promise<RecentSessionsResponse>;
}

interface ImportSessionRequest {
  providerId: string;
  providerHandleId: string;
  cwd?: string;
  source: "recent" | "manual";
}

interface ManualImportError {
  field: "provider" | "handle";
  message: string;
}

function shouldShowManualImport(args: {
  cwd: string | null | undefined;
  client: RecentProviderSessionsClient | null;
  supportsSnapshot: boolean;
  requiresHostUpgrade: boolean;
  providerCount: number;
}): boolean {
  const { cwd, client, supportsSnapshot, requiresHostUpgrade, providerCount } = args;
  return (
    Boolean(cwd) && Boolean(client) && supportsSnapshot && !requiresHostUpgrade && providerCount > 0
  );
}

function isRecentImportError(
  isError: boolean,
  source: ImportSessionRequest["source"] | undefined,
): boolean {
  return isError && source !== "manual";
}

function buildSessionsQueriesConfig(args: {
  providersToFetch: AgentProvider[] | null;
  sessionsQueryRoot: ReadonlyArray<string | null>;
  visible: boolean;
  client: RecentProviderSessionsClient | null;
  cwd: string | null | undefined;
  hostDisconnectedMessage?: string;
}): SessionsQueryConfig[] {
  const { providersToFetch, sessionsQueryRoot, visible, client, cwd, hostDisconnectedMessage } =
    args;
  if (providersToFetch === null) return [];
  const enabled = visible && Boolean(client);
  return providersToFetch.map((provider) => ({
    queryKey: [...sessionsQueryRoot, provider],
    enabled,
    queryFn: async () => {
      if (!client) {
        throw new Error(hostDisconnectedMessage ?? i18n.t("workspace.terminal.hostDisconnected"));
      }
      return await client.fetchRecentProviderSessions({
        ...(cwd ? { cwd } : {}),
        providers: [provider],
        limit: PER_PROVIDER_LIMIT,
      });
    },
  }));
}

interface SheetStatusMessagesProps {
  isClientReady: boolean;
  isSnapshotUnsupported: boolean;
  hasNoImportableProviders: boolean;
  isLoadingSessions: boolean;
  hasRows: boolean;
  allQueriesErrored: boolean;
  erroredProviderLabels: ReadonlyArray<string>;
  importErrored: boolean;
}

function SheetStatusMessages({
  isClientReady,
  isSnapshotUnsupported,
  hasNoImportableProviders,
  isLoadingSessions,
  hasRows,
  allQueriesErrored,
  erroredProviderLabels,
  importErrored,
}: SheetStatusMessagesProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  if (!isClientReady) {
    return <Text style={styles.statusText}>{t("importSession.status.connectHost")}</Text>;
  }
  if (isSnapshotUnsupported) {
    return <Text style={styles.statusText}>{t("importSession.status.updateHost")}</Text>;
  }
  return (
    <>
      {hasNoImportableProviders ? (
        <Text style={styles.statusText}>{t("importSession.status.noProviders")}</Text>
      ) : null}
      {isLoadingSessions && !hasRows ? (
        <View style={styles.statusRow}>
          <LoadingSpinner color={theme.colors.foregroundMuted} />
          <Text style={styles.statusText}>{t("importSession.status.loading")}</Text>
        </View>
      ) : null}
      {allQueriesErrored ? (
        <Text style={styles.statusText}>{t("importSession.status.failedAll")}</Text>
      ) : null}
      {!allQueriesErrored && erroredProviderLabels.length > 0 ? (
        <Text style={styles.statusText}>
          {t("importSession.status.failedProviders", {
            providers: erroredProviderLabels.join(", "),
          })}
        </Text>
      ) : null}
      {importErrored ? (
        <Text style={styles.statusText}>{t("importSession.status.failedImport")}</Text>
      ) : null}
    </>
  );
}

function RefreshAction({ isRefreshing, onPress }: { isRefreshing: boolean; onPress: () => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.refreshButton,
      pressed && styles.refreshButtonPressed,
    ],
    [],
  );
  return (
    <Pressable
      onPress={onPress}
      disabled={isRefreshing}
      accessibilityLabel={t("importSession.actions.refresh")}
      accessibilityRole="button"
      testID="import-session-refresh"
      style={pressableStyle}
    >
      <View style={styles.refreshIconSlot}>
        {isRefreshing ? (
          <LoadingSpinner color={theme.colors.foregroundMuted} />
        ) : (
          <RotateCw size={16} color={theme.colors.foregroundMuted} />
        )}
      </View>
    </Pressable>
  );
}

function SheetEmptyState({ title }: { title: string }) {
  const { theme } = useUnistyles();
  return (
    <View style={styles.emptyState} testID="import-session-empty-state">
      <View style={styles.emptyStateIcon}>
        <Inbox size={theme.iconSize.lg} color={theme.colors.foregroundMuted} strokeWidth={1.5} />
      </View>
      <Text style={styles.emptyStateTitle}>{title}</Text>
    </View>
  );
}

function ImportSessionSheetRow({
  entry,
  disabled,
  importing,
  showCwd,
  onImportSession,
}: {
  entry: FetchRecentProviderSessionEntry;
  disabled: boolean;
  importing: boolean;
  showCwd: boolean;
  onImportSession: (entry: FetchRecentProviderSessionEntry) => void;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const title = getSessionTitle(entry);
  const promptPreview = getPromptPreview(entry);
  const lastActivity = formatTimeAgo(new Date(entry.lastActivityAt));
  const ProviderIcon = getProviderIcon(entry.providerId);
  const accessibilityState = useMemo(
    () => (disabled ? DISABLED_ACCESSIBILITY_STATE : undefined),
    [disabled],
  );
  const handlePress = useCallback(() => {
    onImportSession(entry);
  }, [entry, onImportSession]);
  const pressableStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      Boolean(hovered) && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [],
  );

  return (
    <Pressable
      disabled={disabled}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      style={pressableStyle}
      testID={`import-session-session-${entry.providerId}-${entry.providerHandleId}`}
    >
      <View style={styles.rowIconWrap}>
        <ProviderIcon size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
      </View>
      <View style={styles.rowContent}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.rowMeta}>
            {importing ? t("importSession.row.importing") : lastActivity}
          </Text>
        </View>
        <Text style={styles.rowPreview} numberOfLines={2}>
          {promptPreview}
        </Text>
        {showCwd && entry.cwd ? (
          <Text style={styles.rowCwd} numberOfLines={1}>
            {entry.cwd}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

interface ManualImportFormProps {
  options: SelectFieldOption<AgentProvider>[];
  provider: AgentProvider | null;
  selectedDisplay: SelectFieldDisplay | null;
  providerLeading?: React.ReactNode;
  isPending: boolean;
  error: ManualImportError | null;
  controlSize: "sm" | "md";
  resetKey: string;
  onProviderChange: (value: AgentProvider, display: SelectFieldDisplay) => void;
  onHandleChange: (value: string) => void;
  onSubmit: () => void;
}

function ManualImportForm({
  options,
  provider,
  selectedDisplay,
  providerLeading,
  isPending,
  error,
  controlSize,
  resetKey,
  onProviderChange,
  onHandleChange,
  onSubmit,
}: ManualImportFormProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.manualForm} testID="import-session-manual-form">
      <SelectField
        label={t("importSession.manual.providerLabel")}
        value={provider}
        selectedDisplay={selectedDisplay}
        options={options}
        onChange={onProviderChange}
        placeholder={t("importSession.manual.providerPlaceholder")}
        emptyText={t("importSession.manual.providerEmpty")}
        disabled={isPending}
        error={error?.field === "provider" ? error.message : null}
        searchable={false}
        size={controlSize}
        triggerLeading={providerLeading}
        testID="import-session-manual-provider-field"
        triggerTestID="import-session-manual-provider-trigger"
      />
      <Field
        label={t("importSession.manual.handleLabel")}
        error={error?.field === "handle" ? error.message : null}
        testID="import-session-manual-handle-field"
      >
        <FormTextInput
          size={controlSize}
          testID="import-session-manual-handle"
          initialValue=""
          resetKey={resetKey}
          placeholder={t("importSession.manual.handlePlaceholder")}
          accessibilityLabel={t("importSession.manual.handleLabel")}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={onHandleChange}
          onSubmitEditing={onSubmit}
          editable={!isPending}
        />
      </Field>
      <Button
        variant="default"
        size={controlSize}
        disabled={isPending}
        loading={isPending}
        onPress={onSubmit}
        testID="import-session-manual-submit"
      >
        {isPending ? t("importSession.row.importing") : t("importSession.title")}
      </Button>
    </View>
  );
}

export function ImportSessionSheet({
  visible,
  client,
  serverId,
  cwd,
  workspaceId,
  onClose,
  onImportedAgent,
  onImported,
}: ImportSessionSheetProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { theme } = useUnistyles();
  const formControlSize = useIsCompactFormFactor() ? "md" : "sm";

  const { entries: snapshotEntries, supportsSnapshot } = useProvidersSnapshot(serverId, {
    cwd,
    enabled: visible,
  });
  const supportsWorkspaceTarget = useHostFeature(serverId, "importSessionWorkspaceTarget");
  const requiresHostUpgrade = requiresImportSessionsHostUpgrade({
    supportsSnapshot,
    workspaceId,
    supportsWorkspaceTarget,
  });

  const providersToFetch = useMemo(
    () => (requiresHostUpgrade ? null : resolveProvidersToFetch(supportsSnapshot, snapshotEntries)),
    [requiresHostUpgrade, supportsSnapshot, snapshotEntries],
  );

  const providerLabelById = useMemo(
    () => buildProviderLabelMap(snapshotEntries),
    [snapshotEntries],
  );

  const sessionsQueryRoot = useMemo(
    () => ["recent-provider-sessions", cwd ?? null] as const,
    [cwd],
  );

  const queriesConfig = useMemo(
    () =>
      buildSessionsQueriesConfig({
        providersToFetch,
        sessionsQueryRoot,
        visible,
        client,
        cwd,
        hostDisconnectedMessage: t("workspace.terminal.hostDisconnected"),
      }),
    [providersToFetch, sessionsQueryRoot, visible, client, cwd, t],
  );

  const queries = useQueries({ queries: queriesConfig });

  const aggregatedEntries = useMemo(() => aggregateSessionEntries(queries), [queries]);
  const totalAlreadyImportedCount = useMemo(
    () => sumFilteredAlreadyImportedCount(queries),
    [queries],
  );

  const filterProviders = useMemo(() => [...(providersToFetch ?? [])].sort(), [providersToFetch]);

  const [selectedProvider, setSelectedProvider] = useState<string>(ALL_FILTER_VALUE);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterAnchorRef = useRef<View>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const [manualProvider, setManualProvider] = useState<AgentProvider | null>(null);
  const [manualProviderDisplay, setManualProviderDisplay] = useState<SelectFieldDisplay | null>(
    null,
  );
  const [manualHandleId, setManualHandleId] = useState("");
  const [manualError, setManualError] = useState<ManualImportError | null>(null);

  useEffect(() => {
    if (
      !visible ||
      (selectedProvider !== ALL_FILTER_VALUE && !filterProviders.includes(selectedProvider))
    ) {
      setSelectedProvider(ALL_FILTER_VALUE);
    }
  }, [visible, filterProviders, selectedProvider]);

  useEffect(() => {
    if (!visible) {
      setManualProvider(null);
      setManualProviderDisplay(null);
      setManualHandleId("");
      setManualError(null);
      return;
    }
    if (!manualProvider || !filterProviders.includes(manualProvider)) {
      const nextProvider = filterProviders[0] ?? null;
      setManualProvider(nextProvider);
      setManualProviderDisplay(
        nextProvider ? { label: providerLabelById.get(nextProvider) ?? nextProvider } : null,
      );
    } else if (!manualProviderDisplay) {
      setManualProviderDisplay({
        label: providerLabelById.get(manualProvider) ?? manualProvider,
      });
    }
  }, [visible, filterProviders, manualProvider, manualProviderDisplay, providerLabelById]);

  const visibleEntries = useMemo(() => {
    if (selectedProvider === ALL_FILTER_VALUE) return aggregatedEntries;
    return aggregatedEntries.filter((entry) => entry.providerId === selectedProvider);
  }, [aggregatedEntries, selectedProvider]);

  const filterComboboxOptions = useMemo<ComboboxOption[]>(
    () => [
      { id: ALL_FILTER_VALUE, label: t("importSession.filters.all") },
      ...filterProviders.map((provider) => ({
        id: provider,
        label: providerLabelById.get(provider) ?? provider,
      })),
    ],
    [filterProviders, providerLabelById, t],
  );

  const selectedProviderLabel = useMemo(
    () =>
      filterComboboxOptions.find((opt) => opt.id === selectedProvider)?.label ??
      t("importSession.filters.all"),
    [filterComboboxOptions, selectedProvider, t],
  );

  const manualProviderOptions = useMemo<SelectFieldOption<AgentProvider>[]>(
    () =>
      filterProviders.map((provider) => ({
        id: provider,
        value: provider,
        label: providerLabelById.get(provider) ?? provider,
        testID: `import-session-manual-provider-${provider}`,
      })),
    [filterProviders, providerLabelById],
  );

  const handleFilterOpen = useCallback(() => setIsFilterOpen(true), []);

  const filterTriggerStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.filterTrigger,
      Boolean(hovered) && styles.filterTriggerHovered,
      pressed && styles.filterTriggerPressed,
    ],
    [],
  );

  const handleFilterSelect = useCallback((id: string) => {
    setSelectedProvider(id);
    setIsFilterOpen(false);
  }, []);

  const handleManualProviderChange = useCallback(
    (provider: AgentProvider, display: SelectFieldDisplay) => {
      setManualProvider(provider);
      setManualProviderDisplay(display);
      setManualError(null);
    },
    [],
  );

  const handleManualHandleChange = useCallback((value: string) => {
    setManualHandleId(value);
    setManualError(null);
  }, []);

  const manualProviderLeading = useMemo(() => {
    if (!manualProvider) return null;
    const ProviderIcon = getProviderIcon(manualProvider);
    return <ProviderIcon size={14} color={theme.colors.foregroundMuted} />;
  }, [manualProvider, theme.colors.foregroundMuted]);

  const filterOptionIcons = useMemo(() => {
    const map = new Map<string, React.ReactNode>();
    map.set(ALL_FILTER_VALUE, <Layers size={14} color={theme.colors.foregroundMuted} />);
    for (const provider of filterProviders) {
      const ProviderIcon = getProviderIcon(provider);
      map.set(provider, <ProviderIcon size={14} color={theme.colors.foregroundMuted} />);
    }
    return map;
  }, [filterProviders, theme.colors.foregroundMuted]);

  const renderFilterOption = useCallback(
    ({
      option,
      selected,
      active,
      onPress,
    }: {
      option: ComboboxOption;
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }) => (
      <ComboboxItem
        label={option.label}
        selected={selected}
        active={active}
        onPress={onPress}
        leadingSlot={filterOptionIcons.get(option.id)}
      />
    ),
    [filterOptionIcons],
  );

  const importMutation = useMutation({
    mutationFn: async ({ source: _source, ...request }: ImportSessionRequest) => {
      if (!client) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      if (!request.cwd) {
        throw new Error(t("importSession.manual.workspaceRequired"));
      }
      return await client.importAgent({
        providerId: request.providerId,
        providerHandleId: request.providerHandleId,
        cwd: request.cwd,
        ...(workspaceId ? { workspaceId } : {}),
      });
    },
    onSuccess: async (agent) => {
      await queryClient.invalidateQueries({ queryKey: sessionsQueryRoot });
      onClose();
      onImportedAgent?.(agent.id);
      onImported?.(agent);
    },
    onError: (error, request) => {
      if (request.source !== "manual" || !visibleRef.current) return;
      const message = error instanceof Error ? error.message.trim() : "";
      setManualError({
        field: "handle",
        message: message || t("importSession.manual.fallbackFailure"),
      });
    },
  });

  const importingSessionKey =
    importMutation.isPending && importMutation.variables
      ? `${importMutation.variables.providerId}:${importMutation.variables.providerHandleId}`
      : null;

  const handleImportSession = useCallback(
    (entry: FetchRecentProviderSessionEntry) => {
      if (importMutation.isPending) return;
      setManualError(null);
      importMutation.mutate({
        source: "recent",
        providerId: entry.providerId,
        providerHandleId: entry.providerHandleId,
        cwd: entry.cwd,
      });
    },
    [importMutation],
  );

  const handleManualSubmit = useCallback(() => {
    if (importMutation.isPending) return;
    const providerId = manualProvider;
    const providerHandleId = manualHandleId.trim();
    if (!providerId) {
      setManualError({
        field: "provider",
        message: t("importSession.manual.providerPlaceholder"),
      });
      return;
    }
    if (!providerHandleId) {
      setManualError({ field: "handle", message: t("importSession.manual.handleRequired") });
      return;
    }
    if (!cwd) {
      setManualError({ field: "handle", message: t("importSession.manual.workspaceRequired") });
      return;
    }
    setManualError(null);
    importMutation.mutate({
      source: "manual",
      providerId,
      providerHandleId,
      cwd,
    });
  }, [cwd, importMutation, manualHandleId, manualProvider, t]);

  const erroredProviderLabels = useMemo(
    () => collectErroredProviderLabels(providersToFetch, queries, providerLabelById),
    [queries, providersToFetch, providerLabelById],
  );

  const isRefreshing = queries.some((query) => query.isFetching);

  const handleRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: sessionsQueryRoot });
  }, [queryClient, sessionsQueryRoot]);

  const header = useMemo<SheetHeader>(
    () => ({
      title: t("importSession.title"),
      actions: <RefreshAction isRefreshing={isRefreshing} onPress={handleRefresh} />,
    }),
    [isRefreshing, handleRefresh, t],
  );

  const isSnapshotUnsupported = requiresHostUpgrade;
  const isWaitingForSnapshot = supportsSnapshot && snapshotEntries === undefined;
  const hasNoImportableProviders = providersToFetch !== null && providersToFetch.length === 0;
  const isQueryingProviders = queries.length > 0;
  const isLoadingSessions =
    isWaitingForSnapshot ||
    (isQueryingProviders && queries.some((query) => query.isLoading || query.isPending));
  const allQueriesErrored = isQueryingProviders && queries.every((query) => query.isError);
  const allQueriesSettled =
    isQueryingProviders && queries.every((query) => !query.isLoading && !query.isPending);
  const { showEmptyState, emptyStateTitle } = computeEmptyState({
    isLoadingSessions,
    allQueriesErrored,
    isQueryingProviders,
    allQueriesSettled,
    selectedProvider,
    aggregatedCount: aggregatedEntries.length,
    visibleCount: visibleEntries.length,
    totalAlreadyImportedCount,
    providerLabelById,
  });
  const showFilter = filterProviders.length > 1;
  const showManualImport = shouldShowManualImport({
    cwd,
    client,
    supportsSnapshot,
    requiresHostUpgrade,
    providerCount: manualProviderOptions.length,
  });

  useEffect(() => {
    if (visible && !showManualImport) {
      setManualHandleId("");
      setManualError(null);
    }
  }, [visible, showManualImport]);

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={onClose}
      header={header}
      testID="import-session-sheet"
      desktopMaxWidth={560}
      snapPoints={IMPORT_SHEET_SNAP_POINTS}
    >
      {showManualImport ? (
        <ManualImportForm
          options={manualProviderOptions}
          provider={manualProvider}
          selectedDisplay={manualProviderDisplay}
          providerLeading={manualProviderLeading}
          isPending={importMutation.isPending}
          error={manualError}
          controlSize={formControlSize}
          resetKey={visible ? "open" : "closed"}
          onProviderChange={handleManualProviderChange}
          onHandleChange={handleManualHandleChange}
          onSubmit={handleManualSubmit}
        />
      ) : null}
      {showFilter ? (
        <View ref={filterAnchorRef} collapsable={false} style={styles.filterTriggerWrap}>
          <Pressable
            onPress={handleFilterOpen}
            style={filterTriggerStyle}
            testID="import-session-filter-trigger"
            accessibilityRole="button"
            accessibilityLabel={`Filter: ${selectedProviderLabel}`}
          >
            {selectedProvider === ALL_FILTER_VALUE ? (
              <Layers size={14} color={theme.colors.foregroundMuted} />
            ) : (
              (() => {
                const ProviderIcon = getProviderIcon(selectedProvider);
                return <ProviderIcon size={14} color={theme.colors.foregroundMuted} />;
              })()
            )}
            <Text style={styles.filterTriggerText} numberOfLines={1}>
              {selectedProviderLabel}
            </Text>
            <ChevronDown size={14} color={theme.colors.foregroundMuted} />
          </Pressable>
          <Combobox
            options={filterComboboxOptions}
            value={selectedProvider}
            onSelect={handleFilterSelect}
            renderOption={renderFilterOption}
            searchable={false}
            title="Filter by provider"
            open={isFilterOpen}
            onOpenChange={setIsFilterOpen}
            anchorRef={filterAnchorRef}
            desktopPlacement="bottom-start"
            desktopPreventInitialFlash
          />
        </View>
      ) : null}
      <SheetStatusMessages
        isClientReady={Boolean(client)}
        isSnapshotUnsupported={isSnapshotUnsupported}
        hasNoImportableProviders={hasNoImportableProviders}
        isLoadingSessions={isLoadingSessions}
        hasRows={visibleEntries.length > 0}
        allQueriesErrored={allQueriesErrored}
        erroredProviderLabels={erroredProviderLabels}
        importErrored={isRecentImportError(
          importMutation.isError,
          importMutation.variables?.source,
        )}
      />
      {visibleEntries.length > 0 ? (
        <View style={styles.list}>
          {visibleEntries.map((entry) => (
            <ImportSessionSheetRow
              key={`${entry.providerId}:${entry.providerHandleId}`}
              entry={entry}
              disabled={importMutation.isPending}
              importing={importingSessionKey === `${entry.providerId}:${entry.providerHandleId}`}
              showCwd={!cwd}
              onImportSession={handleImportSession}
            />
          ))}
        </View>
      ) : null}
      {showEmptyState ? <SheetEmptyState title={emptyStateTitle} /> : null}
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  manualForm: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[4],
  },
  filterTriggerWrap: {
    paddingBottom: theme.spacing[2],
  },
  filterTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    alignSelf: "flex-start",
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  filterTriggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
  filterTriggerPressed: {
    backgroundColor: theme.colors.surface3,
  },
  filterTriggerText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  list: {
    gap: theme.spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    marginHorizontal: -theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface1,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  rowIconWrap: {
    width: theme.iconSize.md,
    paddingTop: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  rowTitle: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  rowMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  rowPreview: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: 20,
  },
  rowCwd: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  statusText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[8],
    paddingHorizontal: theme.spacing[4],
  },
  emptyStateIcon: {
    opacity: 0.6,
    marginBottom: theme.spacing[1],
  },
  emptyStateTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  refreshButton: {
    padding: theme.spacing[2],
    marginRight: theme.spacing[1],
    borderRadius: theme.borderRadius.lg,
  },
  refreshButtonPressed: {
    backgroundColor: theme.colors.surface2,
  },
  refreshIconSlot: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
}));
