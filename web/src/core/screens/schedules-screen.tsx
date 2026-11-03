// Port of archive/expo-app:packages/app/src/screens/schedules-screen.tsx: the Schedules page; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/schedules.py; edit it directly.
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react";
import { useIsFocused } from "~/app/route-focus";
import { CalendarClock, Plus } from "lucide-react";
import { MenuHeader } from "@/components/headers/menu-header";
import { ExternalLink } from "@/components/ui/external-link";
import { HostFilter } from "@/components/hosts/host-filter";
import { ALL_HOSTS_OPTION_ID } from "@/components/hosts/host-picker";
import { ScheduleFormSheet } from "@/components/schedules/schedule-form-sheet";
import { SchedulesTable, type ScheduleRowView } from "@/components/schedules/schedules-table";
import { Button } from "@/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useProjects } from "@/hooks/use-projects";
import {
  useSchedules,
  type AggregateLoadState,
  type AggregatedSchedule,
  type ScheduleHostError,
} from "@/hooks/use-schedules";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import {
  resolveSchedule,
  type ScheduleBucket,
  type ScheduleTargetAgent,
} from "@/schedules/schedule-derivation";
import { resolveSchedulesScreenBodyState } from "@/screens/schedules-screen-state";
import { ICON_SIZE } from "@/styles/theme";
import {
  buildProjectNameByCwd,
  buildScheduleProjectTargets,
} from "@/schedules/schedule-project-targets";
import type { ScheduleSummary } from "@bytetrue/protocol/schedule/types";
import { cn } from "cn";

type FormState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; serverId: string; schedule: ScheduleSummary };

const STATUS_FILTER_OPTIONS: { value: ScheduleBucket; label: string; testID: string }[] = [
  { value: "runnable", label: "Active", testID: "schedules-filter-active" },
  { value: "ended", label: "Ended", testID: "schedules-filter-ended" },
];

const EMPTY_SCHEDULES: AggregatedSchedule[] = [];

export function SchedulesScreen(): ReactElement {
  const isFocused = useIsFocused();

  if (!isFocused) {
    return <div className={CONTAINER} />;
  }

  return <SchedulesScreenContent />;
}

function SchedulesScreenContent(): ReactElement {
  const { loadState, hostErrors, isError, refetch } = useSchedules();
  const schedules = loadState.status === "loaded" ? loadState.data : EMPTY_SCHEDULES;
  const { agents } = useAggregatedAgents({ includeArchived: true });
  const { projects } = useProjects();
  const hosts = useHosts();
  const runtime = getHostRuntimeStore();
  const runtimeVersion = useSyncExternalStore(
    (onStoreChange) => runtime.subscribeAll(onStoreChange),
    () => runtime.getVersion(),
    () => runtime.getVersion(),
  );

  // Per-host agent-directory readiness from the runtime, not the aggregate agent
  // flag: the aggregate `isInitialLoad` flips false as soon as *any* host has
  // agents, so a still-loading host would falsely mark its agent-target
  // schedules "gone". `hasEverLoadedAgentDirectory` is true only once that
  // host's directory has loaded at least once.
  const agentDirReadyHosts = useMemo(() => {
    void runtimeVersion;
    const ready = new Set<string>();
    for (const host of hosts) {
      if (runtime.getSnapshot(host.serverId)?.hasEverLoadedAgentDirectory) {
        ready.add(host.serverId);
      }
    }
    return ready;
  }, [hosts, runtime, runtimeVersion]);

  const [form, setForm] = useState<FormState>({ mode: "closed" });
  const [selectedHost, setSelectedHost] = useState(ALL_HOSTS_OPTION_ID);
  const [statusFilter, setStatusFilter] = useState<ScheduleBucket>("runnable");

  useEffect(() => {
    if (
      selectedHost !== ALL_HOSTS_OPTION_ID &&
      !hosts.some((host) => host.serverId === selectedHost)
    ) {
      setSelectedHost(ALL_HOSTS_OPTION_ID);
    }
  }, [hosts, selectedHost]);

  const openCreate = useCallback(() => setForm({ mode: "create" }), []);
  const handleStatusFilterChange = useCallback((value: string) => {
    const option = STATUS_FILTER_OPTIONS.find((candidate) => candidate.value === value);
    if (option) setStatusFilter(option.value);
  }, []);
  const openEdit = useCallback((schedule: AggregatedSchedule) => {
    setForm({ mode: "edit", serverId: schedule.serverId, schedule });
  }, []);
  const closeForm = useCallback(() => setForm({ mode: "closed" }), []);

  const agentsByKey = useMemo(() => {
    const map = new Map<string, ScheduleTargetAgent>();
    for (const agent of agents) {
      map.set(`${agent.serverId}:${agent.id}`, { title: agent.title, provider: agent.provider });
    }
    return map;
  }, [agents]);

  const projectNameByCwd = useMemo(
    () => buildProjectNameByCwd(buildScheduleProjectTargets(projects)),
    [projects],
  );

  // Resolve every schedule's derived state and target line once, then partition
  // by the host and status filters. Sorted newest-first for a stable order
  // across hosts.
  const resolvedRows = useMemo(() => {
    const now = Date.now();
    return schedules.map((schedule) => ({
      schedule,
      resolved: resolveSchedule({
        schedule,
        serverId: schedule.serverId,
        now,
        agentsByKey,
        projectNameByCwd,
        agentDataLoaded: agentDirReadyHosts.has(schedule.serverId),
      }),
    }));
  }, [schedules, agentsByKey, projectNameByCwd, agentDirReadyHosts]);

  const visibleRows = useMemo<ScheduleRowView[]>(() => {
    const singleHost = hosts.length <= 1;
    return resolvedRows
      .filter(
        ({ schedule, resolved }) =>
          (selectedHost === ALL_HOSTS_OPTION_ID || schedule.serverId === selectedHost) &&
          resolved.bucket === statusFilter,
      )
      .sort((a, b) => Date.parse(b.schedule.createdAt) - Date.parse(a.schedule.createdAt))
      .map(({ schedule, resolved }) => ({
        schedule,
        targetLabel: resolved.target.label,
        provider: resolved.target.provider,
        state: resolved.state,
        serverName: schedule.serverName,
        singleHost,
      }));
  }, [resolvedRows, selectedHost, statusFilter, hosts.length]);

  const showLoadError = isError && loadState.status !== "loaded";
  const showHostFilter = hosts.length > 1;

  return (
    <div className={CONTAINER}>
      <MenuHeader title="Schedules" />
      <SchedulesScreenBody
        rows={visibleRows}
        loadState={loadState}
        hostErrors={hostErrors}
        showLoadError={showLoadError}
        statusFilter={statusFilter}
        onStatusFilterChange={handleStatusFilterChange}
        showHostFilter={showHostFilter}
        hosts={hosts}
        selectedHost={selectedHost}
        onSelectHost={setSelectedHost}
        onRetry={refetch}
        onCreate={openCreate}
        onEdit={openEdit}
      />
      <ScheduleFormSheet
        serverId={form.mode === "edit" ? form.serverId : undefined}
        visible={form.mode === "create" || form.mode === "edit"}
        onClose={closeForm}
        mode={form.mode === "edit" ? "edit" : "create"}
        schedule={form.mode === "edit" ? form.schedule : undefined}
      />
    </div>
  );
}

function SchedulesScreenBody({
  rows,
  loadState,
  hostErrors,
  showLoadError,
  statusFilter,
  onStatusFilterChange,
  showHostFilter,
  hosts,
  selectedHost,
  onSelectHost,
  onRetry,
  onCreate,
  onEdit,
}: {
  rows: ScheduleRowView[];
  loadState: AggregateLoadState<AggregatedSchedule>;
  hostErrors: ScheduleHostError[];
  showLoadError: boolean;
  statusFilter: ScheduleBucket;
  onStatusFilterChange: (value: string) => void;
  showHostFilter: boolean;
  hosts: ReturnType<typeof useHosts>;
  selectedHost: string;
  onSelectHost: (serverId: string) => void;
  onRetry: () => void;
  onCreate: () => void;
  onEdit: (schedule: AggregatedSchedule) => void;
}): ReactElement {
  const bodyState = resolveSchedulesScreenBodyState({ loadState, showLoadError });

  if (bodyState.kind === "loading") {
    return (
      <div className={cn(CENTERED, "text-muted-foreground")}>
        <Spinner className="size-8" />
      </div>
    );
  }

  if (bodyState.kind === "load-error") {
    return (
      <div className={CENTERED}>
        <span className={MUTED_TEXT}>Unable to load schedules</span>
        <Button variant="ghost" onPress={onRetry} testID="schedules-retry">
          Try again
        </Button>
      </div>
    );
  }

  if (bodyState.kind === "empty") {
    return (
      <div className={CENTERED}>
        {hostErrors.length > 0 ? <ScheduleHostErrorsBanner errors={hostErrors} /> : null}
        <SchedulesEmptyState onCreate={onCreate} testID="schedules-empty" />
      </div>
    );
  }

  let schedulesContent: ReactElement;
  if (rows.length > 0) {
    schedulesContent = <SchedulesTable rows={rows} onEditSchedule={onEdit} />;
  } else if (statusFilter === "ended") {
    schedulesContent = <SchedulesEndedEmptyState />;
  } else {
    schedulesContent = (
      <div className={FILTER_EMPTY}>
        <SchedulesEmptyState onCreate={onCreate} testID="schedules-empty" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-row items-center justify-between gap-3 px-3 pt-4 md:px-6">
        <div className="flex shrink flex-row flex-wrap items-center gap-3">
          {showHostFilter ? (
            <HostFilter
              hosts={hosts}
              selectedHost={selectedHost}
              onSelectHost={onSelectHost}
              triggerTestID="schedules-host-filter-trigger"
            />
          ) : null}
          <Tabs
            value={statusFilter}
            onValueChange={onStatusFilterChange}
            data-testid="schedules-status-filter"
          >
            <TabsList>
              {STATUS_FILTER_OPTIONS.map((option) => (
                <TabsTrigger key={option.value} value={option.value} data-testid={option.testID}>
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <Button
          variant="outline"
          leftIcon={Plus}
          onPress={onCreate}
          size="sm"
          testID="schedules-new"
        >
          New schedule
        </Button>
      </div>
      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-width:none]"
        data-testid="schedules-list"
      >
        <div className="flex grow flex-col gap-3 pt-4 pb-6">
          {hostErrors.length > 0 ? <ScheduleHostErrorsBanner errors={hostErrors} /> : null}
          {schedulesContent}
        </div>
      </div>
    </div>
  );
}

function SchedulesEmptyState({
  onCreate,
  testID,
}: {
  onCreate: () => void;
  testID?: string;
}): ReactElement {
  return (
    <div className="flex w-full max-w-[420px] flex-col items-center gap-4" data-testid={testID}>
      <CalendarClock size={ICON_SIZE.lg} className="text-muted-foreground" />
      <div className="flex flex-col items-center gap-2">
        <span className={EMPTY_TITLE}>No active schedules</span>
        <span className={MUTED_TEXT}>Schedules run agents on a cadence.</span>
        <ExternalLink
          href="https://github.com/ByteTrue/byspace/blob/main/public-docs/schedules.md"
          label="See docs"
        />
      </div>
      <Button variant="outline" leftIcon={Plus} onPress={onCreate} testID="schedules-empty-new">
        New schedule
      </Button>
    </div>
  );
}

function SchedulesEndedEmptyState(): ReactElement {
  return (
    <div className={FILTER_EMPTY}>
      <div className="flex flex-col items-center gap-3">
        <CalendarClock size={ICON_SIZE.lg} className="text-muted-foreground" />
        <span className={EMPTY_TITLE}>No ended schedules</span>
      </div>
    </div>
  );
}

function ScheduleHostErrorsBanner({ errors }: { errors: ScheduleHostError[] }): ReactElement {
  return (
    <div className="px-3 md:px-6">
      <div
        className="flex flex-col gap-1 rounded-[10px] border p-3"
        data-testid="schedules-host-errors"
      >
        {errors.map((error) => (
          <span key={error.serverId} className="text-xs leading-[normal] text-red-300">
            {`${error.serverName}: Could not load schedules`}
          </span>
        ))}
      </div>
    </div>
  );
}

const CONTAINER = "flex min-h-0 flex-1 flex-col bg-background";
const CENTERED = "flex flex-1 flex-col items-center justify-center gap-6 p-6";
const FILTER_EMPTY = "flex grow flex-col items-center justify-center px-3 py-6 md:px-6";
const EMPTY_TITLE = "text-center text-sm leading-[normal] font-normal text-foreground";
const MUTED_TEXT = "text-center text-sm leading-[normal] text-muted-foreground";
