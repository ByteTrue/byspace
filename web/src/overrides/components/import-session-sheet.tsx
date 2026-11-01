// Override of packages/app/src/components/import-session-sheet.tsx: importing a provider session started outside BySpace; DOM view.
// Generated from the Expo file by web/scripts/port/import-session-sheet.py.
// After changing either file, rerun it and then npm run format:files; do not edit by hand.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type {
  DaemonClient,
  FetchRecentProviderSessionEntry,
} from "@bytetrue/client/internal/daemon-client";
import type { AgentProvider } from "@bytetrue/protocol/agent-types";
import { ChevronDown, Inbox, Layers, RotateCw } from "lucide-react";
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
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostProjects } from "@/projects/host-projects";
import { useHostFeature } from "@/runtime/host-features";
import { useHosts } from "@/runtime/host-runtime";
import { i18n } from "@/i18n/i18next";
import {
  aggregateSessionEntries,
  ALL_FILTER_VALUE,
  buildProviderLabelMap,
  collectProviderErrorRows,
  computeEmptyState,
  type DirectoryProject,
  formatDirectoryLabel,
  getPromptPreview,
  getSessionTitle,
  hasMoreSessions,
  resolveDirectoryLabel,
  nextPageLimit,
  PER_PROVIDER_LIMIT,
  type ProviderErrorRow,
  resolveImportTarget,
  resolveProvidersToFetch,
  requiresImportSessionsHostUpgrade,
  sumFilteredAlreadyImportedCount,
} from "@/components/import-session-sheet-view-model";

const IMPORT_SHEET_SNAP_POINTS = ["70%", "92%"];
/** Long enough that a typed word is one request, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 200;

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
  /** The agent belongs to the workspace the sheet was opened from; open it here. */
  onImportedAgent?: (agentId: string) => void;
  /** The agent belongs to its own workspace; open that workspace and navigate. */
  onImported?: (agent: ImportedAgent) => void;
}

type RecentSessionsResponse = Awaited<
  ReturnType<RecentProviderSessionsClient["fetchRecentProviderSessions"]>
>;

type SessionsQueryKey = ReadonlyArray<string | number | null>;

function buildSessionsQueryKey(input: {
  cwd: string | null;
  query: string;
  limit: number;
  provider?: string;
}): SessionsQueryKey {
  return [
    "recent-provider-sessions",
    input.cwd,
    input.query,
    input.limit,
    ...(input.provider === undefined ? [] : [input.provider]),
  ];
}

interface SessionsQueryConfig {
  queryKey: SessionsQueryKey;
  enabled: boolean;
  // A provider that cannot answer stays broken until the user asks again. React
  // Query's default retry would keep the header spinner turning and pile up
  // in-flight daemon requests behind a dead provider (#2512).
  retry: false;
  placeholderData: typeof keepPreviousData;
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

/** The manual form must not report progress for an import started from the session list. */
function isManualImportPending(mutation: {
  isPending: boolean;
  variables?: ImportSessionRequest | undefined;
}): boolean {
  return mutation.isPending && mutation.variables?.source === "manual";
}

/** A manual submit shows its own inline error, so it must not also light up the list-level banner. */
/**
 * The reason a recent-session import failed, or null when it did not.
 *
 * Returns the daemon's own message: it is the only place that knows whether the session is already
 * imported, the transcript is unreadable, or the provider CLI is missing. The banner used to show a
 * fixed string, which left the user guessing at all three.
 */
function recentImportError(mutation: {
  isError: boolean;
  variables?: ImportSessionRequest | undefined;
  error: unknown;
}): string | null {
  if (!mutation.isError || mutation.variables?.source === "manual") {
    return null;
  }
  return mutation.error instanceof Error ? mutation.error.message : "";
}

function buildSessionsQueriesConfig(args: {
  providersToFetch: AgentProvider[] | null;
  visible: boolean;
  client: RecentProviderSessionsClient | null;
  cwd: string | null;
  query: string;
  limit: number;
  hostDisconnectedMessage?: string;
}): SessionsQueryConfig[] {
  const { providersToFetch, visible, client, cwd, query, limit, hostDisconnectedMessage } = args;
  if (providersToFetch === null) return [];
  const enabled = visible && Boolean(client);
  return providersToFetch.map((provider) => ({
    queryKey: buildSessionsQueryKey({ cwd, query, limit, provider }),
    enabled,
    retry: false as const,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      if (!client) {
        throw new Error(hostDisconnectedMessage ?? i18n.t("workspace.terminal.hostDisconnected"));
      }
      return await client.fetchRecentProviderSessions({
        ...(cwd ? { cwd } : {}),
        providers: [provider],
        limit,
        ...(query ? { query } : {}),
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
  importErrorMessage: string | null;
}

function SheetStatusMessages({
  isClientReady,
  isSnapshotUnsupported,
  hasNoImportableProviders,
  isLoadingSessions,
  hasRows,
  importErrorMessage,
}: SheetStatusMessagesProps) {
  const { t } = useTranslation();
  if (!isClientReady) {
    return <span className={STATUS_TEXT}>{t("importSession.status.connectHost")}</span>;
  }
  if (isSnapshotUnsupported) {
    return <span className={STATUS_TEXT}>{t("importSession.status.updateHost")}</span>;
  }
  return (
    <>
      {hasNoImportableProviders ? (
        <span className={STATUS_TEXT}>{t("importSession.status.noProviders")}</span>
      ) : null}
      {isLoadingSessions && !hasRows ? (
        <div className="flex flex-row items-center gap-2 py-2 text-muted-foreground">
          <LoadingSpinner />
          <span className={STATUS_TEXT}>{t("importSession.status.loading")}</span>
        </div>
      ) : null}
      {importErrorMessage !== null ? (
        <span className={STATUS_TEXT}>
          {t("importSession.status.failedImport")}
          {importErrorMessage ? ` [${importErrorMessage}]` : ""}
        </span>
      ) : null}
    </>
  );
}

function ProviderErrorBanner({
  rows,
  onRetry,
}: {
  rows: ReadonlyArray<ProviderErrorRow>;
  onRetry: (provider: string) => void;
}) {
  return (
    <div
      className="mb-2 flex flex-col rounded-[10px] border px-3 py-1"
      data-testid="import-session-provider-errors"
    >
      {rows.map((row) => (
        <ProviderErrorBannerRow key={row.provider} row={row} onRetry={onRetry} />
      ))}
    </div>
  );
}

function ProviderErrorBannerRow({
  row,
  onRetry,
}: {
  row: ProviderErrorRow;
  onRetry: (provider: string) => void;
}) {
  const { t } = useTranslation();
  const handleRetry = useCallback(() => onRetry(row.provider), [onRetry, row.provider]);
  return (
    <div className="flex flex-row items-center justify-between gap-2">
      <span className="min-w-0 shrink text-xs leading-[normal] text-red-300">
        {t("importSession.status.failedProvider", { provider: row.label })}
      </span>
      <Button
        variant="ghost"
        size="xs"
        onPress={handleRetry}
        testID={`import-session-retry-${row.provider}`}
      >
        {t("common.actions.retry")}
      </Button>
    </div>
  );
}

function RefreshAction({ isRefreshing, onPress }: { isRefreshing: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={isRefreshing}
      aria-label={t("importSession.actions.refresh")}
      data-testid="import-session-refresh"
      className="mr-1 rounded-[10px] p-2 text-muted-foreground active:bg-muted"
    >
      <span className="flex size-4 items-center justify-center">
        {isRefreshing ? <LoadingSpinner /> : <RotateCw size={16} />}
      </span>
    </button>
  );
}

function ScopeSubtitle({
  hostLabel,
  isScoped,
  onShowAll,
}: {
  hostLabel: string;
  isScoped: boolean;
  onShowAll: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-row items-center gap-2">
      <span
        className="min-w-0 shrink truncate text-xs leading-[normal] text-muted-foreground"
        data-testid="import-session-scope"
      >
        {isScoped
          ? t("importSession.scope.workspace")
          : t("importSession.scope.host", { host: hostLabel })}
      </span>
      {isScoped ? (
        <Button
          variant="ghost"
          size="xs"
          onPress={onShowAll}
          testID="import-session-show-all"
          className="-mx-2"
        >
          {t("importSession.actions.showAll")}
        </Button>
      ) : null}
    </div>
  );
}

function SheetEmptyState({ title }: { title: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 px-4 py-8"
      data-testid="import-session-empty-state"
    >
      <div className="mb-1 text-muted-foreground opacity-60">
        <Inbox size={20} strokeWidth={1.5} />
      </div>
      <span className="text-center text-sm leading-[normal] text-foreground">{title}</span>
    </div>
  );
}

function ImportSessionSheetRow({
  serverId,
  entry,
  disabled,
  importing,
  folder,
  onImportSession,
}: {
  serverId: string | null;
  entry: FetchRecentProviderSessionEntry;
  disabled: boolean;
  importing: boolean;
  /** The row's directory, shown only when rows can come from more than one. */
  folder: string | null;
  onImportSession: (entry: FetchRecentProviderSessionEntry) => void;
}) {
  const { t } = useTranslation();
  const title = getSessionTitle(entry);
  const promptPreview = getPromptPreview(entry);
  const lastActivity = formatTimeAgo(new Date(entry.lastActivityAt));
  const ProviderIcon = getProviderIcon(entry.providerId, serverId);
  const handlePress = useCallback(() => {
    onImportSession(entry);
  }, [entry, onImportSession]);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={handlePress}
      className="-mx-2 flex flex-row items-start gap-2 rounded-[10px] p-2 text-left enabled:hover:bg-card enabled:active:bg-muted"
      data-testid={`import-session-session-${entry.providerId}-${entry.providerHandleId}`}
    >
      <span className="flex w-4 shrink-0 items-center justify-center pt-0.5 text-muted-foreground">
        <ProviderIcon size={16} color="currentColor" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-row items-baseline justify-between gap-2">
          <span className="min-w-0 flex-1 truncate text-sm leading-[normal] text-foreground">
            {title}
          </span>
          <span className="shrink-0 text-xs leading-[normal] text-muted-foreground">
            {importing ? t("importSession.row.importing") : lastActivity}
          </span>
        </span>
        <span className="line-clamp-2 text-sm leading-5 text-muted-foreground">
          {promptPreview}
        </span>
        {folder ? (
          <span
            className="truncate text-xs leading-[normal] text-muted-foreground"
            data-testid={`import-session-row-folder-${entry.providerId}-${entry.providerHandleId}`}
          >
            {folder}
          </span>
        ) : null}
      </span>
    </button>
  );
}

interface ManualImportFormProps {
  show: boolean;
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
  show,
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

  if (!show) return null;

  return (
    <div className="flex flex-col gap-3 pb-4" data-testid="import-session-manual-form">
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
    </div>
  );
}

function SessionRows({
  serverId,
  entries,
  disabled,
  importingSessionKey,
  resolveFolder,
  onImportSession,
}: {
  serverId: string | null;
  entries: ReadonlyArray<FetchRecentProviderSessionEntry>;
  disabled: boolean;
  importingSessionKey: string | null;
  resolveFolder: (entry: FetchRecentProviderSessionEntry) => string | null;
  onImportSession: (entry: FetchRecentProviderSessionEntry) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {entries.map((entry) => (
        <ImportSessionSheetRow
          key={`${entry.providerId}:${entry.providerHandleId}`}
          serverId={serverId}
          entry={entry}
          disabled={disabled}
          importing={importingSessionKey === `${entry.providerId}:${entry.providerHandleId}`}
          folder={resolveFolder(entry)}
          onImportSession={onImportSession}
        />
      ))}
    </div>
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
  const formControlSize = useIsCompactFormFactor() ? "md" : "sm";

  // "Show all" widens a workspace-scoped sheet to the whole host. The sheet's own
  // `cwd` stays the scope it was opened with, because that is what decides where
  // an imported agent lands.
  const [isShowingAllDirectories, setIsShowingAllDirectories] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [pageLimit, setPageLimit] = useState(PER_PROVIDER_LIMIT);
  const [selectedProvider, setSelectedProvider] = useState<string>(ALL_FILTER_VALUE);

  const scopeCwd = isShowingAllDirectories ? null : (cwd ?? null);
  const supportsSearch = useHostFeature(serverId, "importSessionSearch");
  const query = useDebouncedValue(supportsSearch ? searchInput : "", SEARCH_DEBOUNCE_MS).trim();

  useEffect(() => {
    if (visible) return;
    setIsShowingAllDirectories(false);
    setSearchInput("");
  }, [visible]);

  // A narrower or wider list starts at page one; keeping a grown limit would
  // fetch 200 rows for a query that matches three.
  useEffect(() => {
    setPageLimit(PER_PROVIDER_LIMIT);
  }, [query, scopeCwd]);

  const { entries: snapshotEntries, supportsSnapshot } = useProvidersSnapshot(serverId, {
    cwd: scopeCwd,
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

  const sessionsQueryRoot = useMemo(() => ["recent-provider-sessions", scopeCwd], [scopeCwd]);

  const queriesConfig = useMemo(
    () =>
      buildSessionsQueriesConfig({
        providersToFetch,
        visible,
        client,
        cwd: scopeCwd,
        query,
        limit: pageLimit,
        hostDisconnectedMessage: t("workspace.terminal.hostDisconnected"),
      }),
    [providersToFetch, visible, client, scopeCwd, query, pageLimit, t],
  );

  const queries = useQueries({ queries: queriesConfig });

  const aggregatedEntries = useMemo(() => aggregateSessionEntries(queries), [queries]);
  const totalAlreadyImportedCount = useMemo(
    () => sumFilteredAlreadyImportedCount(queries),
    [queries],
  );

  const filterProviders = useMemo(() => [...(providersToFetch ?? [])].sort(), [providersToFetch]);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterAnchorRef = useRef<HTMLDivElement | null>(null);
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

  const projectServerIds = useMemo(() => (serverId ? [serverId] : []), [serverId]);
  const hostProjects = useHostProjects(projectServerIds);
  const directoryProjects = useMemo<DirectoryProject[]>(
    () =>
      hostProjects.map((project) => ({
        rootPath: project.iconWorkingDir,
        name: project.projectName,
      })),
    [hostProjects],
  );

  // A scoped sheet only lists one directory, so naming it on every row is noise.
  const showRowFolders = scopeCwd === null;
  const resolveFolder = useCallback(
    (entry: FetchRecentProviderSessionEntry) =>
      showRowFolders
        ? formatDirectoryLabel(resolveDirectoryLabel(entry.cwd, directoryProjects))
        : null,
    [showRowFolders, directoryProjects],
  );

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
    return (
      <span className="flex text-muted-foreground">
        <ProviderIcon size={14} color="currentColor" />
      </span>
    );
  }, [manualProvider]);

  const filterOptionIcons = useMemo(() => {
    const map = new Map<string, React.ReactNode>();
    map.set(ALL_FILTER_VALUE, <Layers size={14} className="text-muted-foreground" />);
    for (const provider of filterProviders) {
      const ProviderIcon = getProviderIcon(provider, serverId);
      map.set(
        provider,
        <span className="flex text-muted-foreground">
          <ProviderIcon size={14} color="currentColor" />
        </span>,
      );
    }
    return map;
  }, [filterProviders, serverId]);

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
      const target = resolveImportTarget({
        entryCwd: request.cwd,
        workspaceCwd: cwd,
        workspaceId,
        isScopedListing: scopeCwd !== null,
      });
      const agent = await client.importAgent({
        providerId: request.providerId,
        providerHandleId: request.providerHandleId,
        cwd: request.cwd,
        ...(target.workspaceId ? { workspaceId: target.workspaceId } : {}),
      });
      return { agent, target };
    },
    onSuccess: ({ agent, target }) => {
      onClose();
      if (target.crossWorkspace) {
        onImported?.(agent);
      } else {
        onImportedAgent?.(agent.id);
      }
      void queryClient.invalidateQueries({
        queryKey: sessionsQueryRoot,
        refetchType: "none",
      });
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

  const providerErrorRows = useMemo(
    () => collectProviderErrorRows(providersToFetch, queries, providerLabelById),
    [queries, providersToFetch, providerLabelById],
  );

  // Every query settles, errors included, so this stops turning (#2512).
  const isRefreshing = queries.some((providerQuery) => providerQuery.isFetching);

  const handleRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: sessionsQueryRoot });
  }, [queryClient, sessionsQueryRoot]);

  const handleRetryProvider = useCallback(
    (provider: string) => {
      void queryClient.refetchQueries({
        queryKey: buildSessionsQueryKey({ cwd: scopeCwd, query, limit: pageLimit, provider }),
      });
    },
    [pageLimit, query, queryClient, scopeCwd],
  );

  const handleShowAll = useCallback(() => setIsShowingAllDirectories(true), []);
  const handleLoadMore = useCallback(() => setPageLimit(nextPageLimit), []);

  const hosts = useHosts();
  const hostLabel = useMemo(
    () => hosts.find((host) => host.serverId === serverId)?.label ?? serverId ?? "",
    [hosts, serverId],
  );

  const header = useMemo<SheetHeader>(
    () => ({
      title: t("importSession.title"),
      subtitle: (
        <ScopeSubtitle
          hostLabel={hostLabel}
          isScoped={scopeCwd !== null}
          onShowAll={handleShowAll}
        />
      ),
      ...(supportsSearch
        ? {
            search: {
              onChange: setSearchInput,
              placeholder: t("importSession.searchPlaceholder"),
              // The compact sheet keeps its content mounted while hidden, so the
              // field has to be told to drop the text the state already dropped.
              resetKey: visible ? "open" : "closed",
              testID: "import-session-search",
            },
          }
        : {}),
      actions: <RefreshAction isRefreshing={isRefreshing} onPress={handleRefresh} />,
    }),
    [handleRefresh, handleShowAll, hostLabel, isRefreshing, scopeCwd, supportsSearch, t, visible],
  );

  const isSnapshotUnsupported = requiresHostUpgrade;
  const isWaitingForSnapshot = supportsSnapshot && snapshotEntries === undefined;
  const hasNoImportableProviders = providersToFetch !== null && providersToFetch.length === 0;
  const isQueryingProviders = queries.length > 0;
  const isLoadingSessions =
    isWaitingForSnapshot ||
    (isQueryingProviders &&
      queries.some((providerQuery) => providerQuery.isLoading || providerQuery.isPending));
  const allQueriesErrored =
    isQueryingProviders && queries.every((providerQuery) => providerQuery.isError);
  const allQueriesSettled =
    isQueryingProviders &&
    queries.every((providerQuery) => !providerQuery.isLoading && !providerQuery.isPending);
  const { showEmptyState, emptyStateTitle } = computeEmptyState({
    isLoadingSessions,
    allQueriesErrored,
    isQueryingProviders,
    allQueriesSettled,
    selectedProvider,
    hasQuery: query.length > 0,
    aggregatedCount: aggregatedEntries.length,
    visibleCount: visibleEntries.length,
    totalAlreadyImportedCount,
    providerLabelById,
  });
  const showFilter = filterProviders.length > 1;
  const showLoadMore = hasMoreSessions(queries, pageLimit);

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
      <ManualImportForm
        show={showManualImport}
        options={manualProviderOptions}
        provider={manualProvider}
        selectedDisplay={manualProviderDisplay}
        providerLeading={manualProviderLeading}
        isPending={isManualImportPending(importMutation)}
        error={manualError}
        controlSize={formControlSize}
        resetKey={visible ? "open" : "closed"}
        onProviderChange={handleManualProviderChange}
        onHandleChange={handleManualHandleChange}
        onSubmit={handleManualSubmit}
      />
      {showFilter ? (
        <div ref={filterAnchorRef} className="flex flex-col pb-2">
          <button
            type="button"
            onClick={handleFilterOpen}
            className="flex max-w-full flex-row items-center gap-1.5 self-start rounded-lg border bg-card px-3 py-1.5 text-muted-foreground hover:bg-muted active:bg-(--surface-3)"
            data-testid="import-session-filter-trigger"
            aria-label={`Filter: ${selectedProviderLabel}`}
          >
            {filterOptionIcons.get(selectedProvider)}
            <span className="min-w-0 shrink truncate text-sm leading-[normal] font-medium text-foreground">
              {selectedProviderLabel}
            </span>
            <ChevronDown size={14} />
          </button>
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
        </div>
      ) : null}
      <SheetStatusMessages
        isClientReady={Boolean(client)}
        isSnapshotUnsupported={isSnapshotUnsupported}
        hasNoImportableProviders={hasNoImportableProviders}
        isLoadingSessions={isLoadingSessions}
        hasRows={visibleEntries.length > 0}
        importErrorMessage={recentImportError(importMutation)}
      />
      {providerErrorRows.length > 0 ? (
        <ProviderErrorBanner rows={providerErrorRows} onRetry={handleRetryProvider} />
      ) : null}
      {visibleEntries.length > 0 ? (
        <SessionRows
          serverId={serverId}
          entries={visibleEntries}
          disabled={importMutation.isPending}
          importingSessionKey={importingSessionKey}
          resolveFolder={resolveFolder}
          onImportSession={handleImportSession}
        />
      ) : null}
      {showLoadMore ? (
        <div className="flex flex-col items-center pt-2">
          <Button
            variant="ghost"
            onPress={handleLoadMore}
            disabled={isRefreshing}
            testID="import-session-load-more"
          >
            {t("importSession.actions.loadMore")}
          </Button>
        </div>
      ) : null}
      {showEmptyState ? <SheetEmptyState title={emptyStateTitle} /> : null}
    </AdaptiveModalSheet>
  );
}

const STATUS_TEXT = "text-sm leading-[normal] text-muted-foreground";
