// Port of archive/expo-app:packages/app/src/screens/sessions-screen.tsx: the History page; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/sessions-screen.py; edit it directly.
import {
  useMemo,
  useState,
  useCallback,
  useEffect,
  type ChangeEvent,
  type ReactElement,
} from "react";
import { useIsFocused } from "~/app/route-focus";
import { router } from "~/app/navigation";
import { ChevronLeft, Import } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { AgentList } from "@/components/agent-list";
import { Search, X } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "~/components/ui/input-group";
import { HostFilter } from "@/components/hosts/host-filter";
import { ALL_HOSTS_OPTION_ID } from "@/components/hosts/host-picker";
import { type AgentHistoryHostError, useAgentHistory } from "@/hooks/use-agent-history";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useImportSession } from "@/hooks/use-import-session";
import { useHosts } from "@/runtime/host-runtime";
import { buildOpenProjectRoute } from "@/utils/host-routes";

/** Long enough that a typed word is one request, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 200;

const sessionsHostOptionTestID = (serverId: string) => `sessions-host-filter-item-${serverId}`;

/**
 * A host that failed while others answered. Without this the list silently
 * under-reports, and under a query "No sessions match" becomes a claim the app
 * has no basis for.
 */
function SessionHostErrorsBanner({
  errors,
  t,
}: {
  errors: AgentHistoryHostError[];
  t: TFunction;
}): ReactElement {
  return (
    <div className="px-3 pt-3 md:px-6">
      <div
        className="flex flex-col gap-1 rounded-[10px] border p-3"
        data-testid="sessions-host-errors"
      >
        {errors.map((error) => (
          <span key={error.serverId} className="text-xs leading-[normal] text-red-300">
            {t("sessions.hostLoadFailed", { host: error.serverName })}
          </span>
        ))}
      </div>
    </div>
  );
}

/** An empty list means something different once a query is narrowing it. */
function resolveEmptyText(input: {
  t: TFunction;
  isSearching: boolean;
  isAllHosts: boolean;
}): string {
  if (input.isSearching) return input.t("sessions.noMatches");
  if (input.isAllHosts) return input.t("sessions.empty");
  return "No sessions for this host";
}

export function SessionsScreen() {
  const isFocused = useIsFocused();

  if (!isFocused) {
    return <div className={CONTAINER} />;
  }

  return <SessionsScreenContent />;
}

function SessionsSearch({
  value,
  onChange,
  onClear,
}: {
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <InputGroup className="max-w-[420px] min-w-0 flex-1">
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput
        data-testid="sessions-search-input"
        value={value}
        onChange={onChange}
        placeholder={t("sessions.searchPlaceholder")}
        aria-label={t("sessions.searchPlaceholder")}
        autoCapitalize="none"
        autoCorrect="off"
        enterKeyHint="search"
      />
      {value.length > 0 ? (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            onClick={onClear}
            aria-label={t("sessions.actions.clearSearch")}
            data-testid="sessions-search-clear"
          >
            <X />
          </InputGroupButton>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
}

function SessionsScreenContent() {
  const { t } = useTranslation();
  const importSession = useImportSession();
  const hosts = useHosts();
  const [selectedHost, setSelectedHost] = useState(ALL_HOSTS_OPTION_ID);
  const [searchInput, setSearchInput] = useState("");
  const handleSearchInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setSearchInput(event.target.value),
    [],
  );
  const search = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS).trim();
  const historyServerId = selectedHost === ALL_HOSTS_OPTION_ID ? null : selectedHost;
  const {
    agents,
    hasMore,
    isInitialLoad,
    isLoadingMore,
    isError,
    isSearchSupported,
    isSearchTruncated,
    searchMatchesByAgentKey,
    hostErrors,
    loadMore,
    refreshAll,
  } = useAgentHistory({
    serverId: historyServerId,
    search,
  });
  const isSearching = isSearchSupported && search.length > 0;

  useEffect(() => {
    if (
      selectedHost !== ALL_HOSTS_OPTION_ID &&
      !hosts.some((host) => host.serverId === selectedHost)
    ) {
      setSelectedHost(ALL_HOSTS_OPTION_ID);
    }
  }, [hosts, selectedHost]);

  const [isManualRefresh, setIsManualRefresh] = useState(false);

  const handleRefresh = useCallback(() => {
    setIsManualRefresh(true);
    void refreshAll().finally(() => setIsManualRefresh(false));
  }, [refreshAll]);

  // `useAgentHistory` owns the order: recency at rest, relevance under a query.
  const emptyText = resolveEmptyText({
    t,
    isSearching,
    isAllHosts: selectedHost === ALL_HOSTS_OPTION_ID,
  });
  const showHostFilter = hosts.length > 1;
  const showFilterRow = showHostFilter || isSearchSupported;
  const showLoadError = isError && agents.length === 0;

  const handleBack = useCallback(() => {
    router.navigate(buildOpenProjectRoute());
  }, []);

  const handleClearSearch = useCallback(() => setSearchInput(""), []);

  const listFooterComponent = useMemo(() => {
    // A ranked result set has no next page — reaching a weaker match means
    // narrowing the query, so the footer says that instead of offering a button.
    if (isSearchTruncated) {
      return (
        <div className="flex flex-col items-center py-4">
          <span className="text-sm leading-[normal] text-muted-foreground">
            {t("sessions.tooManyMatches")}
          </span>
        </div>
      );
    }
    if (!hasMore) {
      return null;
    }
    return (
      <div className="flex flex-col items-center py-4">
        <Button variant="ghost" onClick={loadMore} disabled={isLoadingMore}>
          {isLoadingMore ? "Loading..." : t("sessions.actions.loadMore")}
        </Button>
      </div>
    );
  }, [hasMore, isLoadingMore, isSearchTruncated, loadMore, t]);

  return (
    <div className={CONTAINER}>
      <MenuHeader title={t("sessions.title")} />
      {showFilterRow ? (
        <div className="flex flex-row items-center gap-2 px-3 pt-4 md:px-6">
          {isSearchSupported ? (
            <SessionsSearch
              value={searchInput}
              onChange={handleSearchInput}
              onClear={handleClearSearch}
            />
          ) : null}
          {showHostFilter ? (
            <HostFilter
              hosts={hosts}
              selectedHost={selectedHost}
              onSelectHost={setSelectedHost}
              triggerTestID="sessions-host-filter-trigger"
              hostOptionTestID={sessionsHostOptionTestID}
            />
          ) : null}
        </div>
      ) : null}
      {hostErrors.length > 0 ? <SessionHostErrorsBanner errors={hostErrors} t={t} /> : null}
      {isInitialLoad ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Spinner className="size-8" />
        </div>
      ) : null}
      {!isInitialLoad && showLoadError ? (
        <div className={EMPTY_CONTAINER}>
          <span className={EMPTY_TEXT}>Unable to load sessions</span>
          <Button variant="ghost" onClick={handleRefresh}>
            Try again
          </Button>
        </div>
      ) : null}
      {!isInitialLoad && !showLoadError && agents.length === 0 ? (
        <div className={EMPTY_CONTAINER} data-testid="sessions-empty">
          <span className={EMPTY_TEXT}>{emptyText}</span>
          {isSearching ? (
            <Button variant="ghost" onClick={handleClearSearch}>
              {t("sessions.actions.clearSearch")}
            </Button>
          ) : (
            <Button variant="ghost" onClick={handleBack}>
              <ChevronLeft data-icon="inline-start" />
              Back
            </Button>
          )}
          <Button variant="ghost" onClick={importSession.open}>
            <Import data-icon="inline-start" />
            {t("importSession.title")}
          </Button>
        </div>
      ) : null}
      {!isInitialLoad && !showLoadError && agents.length > 0 ? (
        <AgentList
          agents={agents}
          showCheckoutInfo={false}
          isRefreshing={isManualRefresh}
          onRefresh={handleRefresh}
          listFooterComponent={listFooterComponent}
          showAttentionIndicator={false}
          showHostColumn
          searchMatchesByAgentKey={isSearching ? searchMatchesByAgentKey : undefined}
          flat={isSearching}
        />
      ) : null}
      {importSession.sheet}
    </div>
  );
}

const CONTAINER = "flex min-h-0 flex-1 flex-col bg-background";
const EMPTY_CONTAINER = "flex flex-1 flex-col items-center justify-center gap-6 p-6";
const EMPTY_TEXT = "text-sm leading-[normal] text-muted-foreground";
