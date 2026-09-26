import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ArrowLeft, Blocks, LayoutDashboard, Plus, Users } from "lucide-react-native";

import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useIsCompactFormFactor } from "@/constants/layout";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useWorkers } from "@/hooks/use-workers";
import type {
  AggregatedWorker,
  AggregatedWorkerTask,
  WorkerTemplateOption,
} from "@/workers/aggregated-workers";

/** A template tagged with its host; only the local shape is used here. */
type AggregatedWorkerTemplate = WorkerTemplateOption;
import {
  countWorkerTasks,
  describeRosterActivity,
  selectAttentionTasks,
} from "@/workers/dashboard-derived";
import { WorkerDetailSection } from "@/workers/worker-detail-section";
import { WorkerFilterBar } from "@/workers/worker-filter-bar";
import {
  availableRoles,
  DEFAULT_WORKER_FILTERS,
  selectVisibleWorkers,
  type WorkerFilters,
  type WorkerSort,
  type WorkerStatusFilter,
} from "@/workers/worker-filters";
import { WorkerGroupsSection } from "@/workers/worker-groups-section";
import { ICON_SIZE } from "@/styles/theme";

/**
 * The workers console: a separate product surface with its own shell.
 *
 * It does not mount inside the app's workspace sidebar. That sidebar answers
 * "which workspace am I in"; this surface spans every connected host and has its
 * own vocabulary (workers, tasks, capabilities). Showing both at once would put
 * two unrelated navigation models on screen, so this page owns its whole
 * viewport and offers one way back.
 *
 * The layout follows the reference product: a fixed sidebar of grouped
 * destinations beside a scrolling content area with a title block.
 */

type Section = "dashboard" | "management" | "capabilities";

/** Shared empties, so a state with nothing to report does not allocate. */
const EMPTY_ACTIVITY: never[] = [];
const EMPTY_ACTIVITY_MAP = new Map<string, never[]>();

/**
 * The roster and the groups are two views of the same subject, so they share a
 * page and a segmented control. The reference product does this; two separate
 * destinations implied they were unrelated.
 */
type ManagementView = "workers" | "groups";

const NAV_GROUPS: { title: string; items: { id: Section; label: string; icon: typeof Users }[] }[] =
  [
    {
      title: "Work management",
      items: [
        { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
        { id: "management", label: "Worker management", icon: Users },
      ],
    },
    {
      title: "Workers & capabilities",
      items: [{ id: "capabilities", label: "Capabilities & resources", icon: Blocks }],
    },
  ];

export function WorkersConsole({ onExit }: { onExit: () => void }): ReactElement {
  const isCompact = useIsCompactFormFactor();
  const [section, setSection] = useState<Section>("dashboard");
  const [managementView, setManagementView] = useState<ManagementView>("workers");
  /**
   * The worker whose detail is open, keyed by host and id.
   *
   * Held here rather than as a route because the console is a single page that
   * does not mount in the app shell; a worker detail is a different view of it,
   * not a different place.
   */
  const [openWorkerKey, setOpenWorkerKey] = useState<string | null>(null);
  const openManagement = useCallback(() => setSection("management"), []);
  const { loadState, hostErrors, refetch, isRefetching } = useWorkers();

  const workers = loadState.status === "loaded" ? loadState.workers : [];
  const templates = loadState.status === "loaded" ? loadState.templates : [];
  const tasks = loadState.status === "loaded" ? loadState.tasks : [];
  const groups = loadState.status === "loaded" ? loadState.groups : [];
  const activity = loadState.status === "loaded" ? loadState.activity : EMPTY_ACTIVITY_MAP;

  // Counts sit on the roster and group rows only; a count on the other entries
  // would be a number with nothing behind it.
  const sectionCounts = useMemo<Partial<Record<Section, number>>>(
    () => ({ management: workers.length + groups.length }),
    [workers.length, groups.length],
  );

  const managementViews = useMemo(
    () => [
      {
        value: "workers" as const,
        label: `Workers (${workers.length})`,
        testID: "console-view-workers",
      },
      {
        value: "groups" as const,
        label: `Groups (${groups.length})`,
        testID: "console-view-groups",
      },
    ],
    [workers.length, groups.length],
  );

  const openWorker =
    workers.find((worker) => `${worker.serverId}:${worker.id}` === openWorkerKey) ?? null;
  const closeWorker = useCallback(() => setOpenWorkerKey(null), []);

  const managementViewSwitch = useMemo(
    () => (
      <SegmentedControl
        options={managementViews}
        value={managementView}
        onValueChange={setManagementView}
        testID="console-management-view"
      />
    ),
    [managementViews, managementView],
  );

  // Resolved before render rather than as a nested conditional: a worker detail
  // replaces the page's content, and reading that as one value is clearer than
  // three chained ternaries.
  let managementPane: ReactElement;
  if (openWorker) {
    managementPane = (
      <WorkerDetailSection
        worker={openWorker}
        tasks={tasks}
        activityDays={activity.get(`${openWorker.serverId}:${openWorker.id}`) ?? EMPTY_ACTIVITY}
        onBack={closeWorker}
        onTaskCreated={refetch}
      />
    );
  } else if (managementView === "workers") {
    managementPane = (
      <ManagementSection
        workers={workers}
        templates={templates}
        tasks={tasks}
        isRefetching={isRefetching}
        onCreated={refetch}
        viewSwitch={managementViewSwitch}
        onOpenWorker={setOpenWorkerKey}
      />
    );
  } else {
    managementPane = (
      <WorkerGroupsSection
        groups={groups}
        workers={workers}
        tasks={tasks}
        onChanged={refetch}
        viewSwitch={managementViewSwitch}
      />
    );
  }

  // A fixed-width column beside the content needs room for both. Below that,
  // the same destinations become a horizontal strip so the content keeps the
  // full width instead of collapsing to a few characters per line.
  return (
    <View style={isCompact ? styles.rootCompact : styles.root}>
      <View style={isCompact ? styles.sidebarCompact : styles.sidebar}>
        <View style={styles.sidebarHeader}>
          <Pressable
            onPress={onExit}
            style={styles.exitButton}
            testID="workers-console-exit"
            accessibilityRole="button"
            accessibilityLabel="Back to BySpace"
          >
            <ArrowLeft size={ICON_SIZE.md} />
            <Text style={styles.exitLabel}>BySpace</Text>
          </Pressable>
        </View>
        <ScrollView
          style={isCompact ? styles.sidebarScrollCompact : styles.sidebarScroll}
          contentContainerStyle={isCompact ? styles.sidebarContentCompact : styles.sidebarContent}
          horizontal={isCompact}
        >
          {NAV_GROUPS.map((group) => (
            <View key={group.title} style={isCompact ? styles.navGroupCompact : styles.navGroup}>
              <Text style={isCompact ? styles.navGroupTitleCompact : styles.navGroupTitle}>
                {group.title}
              </Text>
              {group.items.map((item) => (
                <NavRow
                  key={item.id}
                  item={item}
                  active={item.id === section}
                  onSelect={setSection}
                  count={sectionCounts[item.id]}
                  compact={isCompact}
                />
              ))}
            </View>
          ))}
        </ScrollView>
      </View>

      <View style={styles.main}>
        {loadState.status === "loading" || loadState.status === "connecting" ? (
          <View style={styles.centered}>
            <LoadingSpinner size="large" color={styles.spinnerColor.color} />
          </View>
        ) : (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            <HostErrors errors={hostErrors} />
            {section === "dashboard" ? (
              <DashboardSection tasks={tasks} workers={workers} onOpenManagement={openManagement} />
            ) : null}
            {section === "management" ? <View style={styles.section}>{managementPane}</View> : null}
            {section === "capabilities" ? <CapabilitiesSection /> : null}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

function NavRow({
  item,
  active,
  count,
  onSelect,
  compact,
}: {
  item: { id: Section; label: string; icon: typeof Users };
  active: boolean;
  count?: number;
  onSelect: (id: Section) => void;
  /** Laid out in a horizontal strip rather than a column. */
  compact: boolean;
}): ReactElement {
  const Icon = item.icon;
  const handlePress = useCallback(() => onSelect(item.id), [item.id, onSelect]);
  const accessibilityState = useMemo(() => ({ selected: active }), [active]);
  return (
    <Pressable
      onPress={handlePress}
      style={NAV_ROW_STYLES[`${compact ? "compact" : "wide"}:${active ? "active" : "idle"}`]}
      testID={`workers-console-nav-${item.id}`}
      accessibilityRole="button"
      accessibilityLabel={item.label}
      accessibilityState={accessibilityState}
    >
      <Icon size={ICON_SIZE.md} />
      <Text style={active ? styles.navRowLabelActive : styles.navRowLabel}>{item.label}</Text>
      {count !== undefined && count > 0 ? <Text style={styles.navRowCount}>{count}</Text> : null}
    </Pressable>
  );
}

function DashboardSection({
  tasks,
  workers,
  onOpenManagement,
}: {
  tasks: AggregatedWorkerTask[];
  workers: AggregatedWorker[];
  onOpenManagement: () => void;
}): ReactElement {
  const counts = useMemo(() => countWorkerTasks(tasks), [tasks]);
  const attention = useMemo(() => selectAttentionTasks(tasks), [tasks]);
  const activity = describeRosterActivity(counts);

  const actionRequired = useMemo(() => [...attention.unblock, ...attention.review], [attention]);

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Start with the work: see what workers have done, take required actions, and review their results."
      />
      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>Task records</Text>
          <Text style={styles.panelMeta}>{activity}</Text>
        </View>
        <View style={styles.statRow}>
          <StatCard label="Total tasks" value={counts.total} />
          <StatCard label="Active tasks" value={counts.active} />
          <StatCard label="Action required" value={counts.actionRequired} />
          <StatCard label="Ended tasks" value={counts.ended} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Needs attention</Text>
        <View style={styles.tabRow}>
          <Text style={styles.tabActive}>{`Action required (${counts.actionRequired})`}</Text>
          <Text style={styles.tab}>{`Review results (${attention.review.length})`}</Text>
        </View>
        {actionRequired.length === 0 ? (
          <EmptyPanel
            title="Nothing needs you"
            body="Tasks waiting for your confirmation, answer, or additional information will appear here."
          />
        ) : (
          actionRequired.map((task) => <TaskRow key={task.taskId} task={task} />)
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>All tasks</Text>
        {tasks.length === 0 ? (
          <EmptyPanel
            title="No tasks"
            body={
              workers.length === 0
                ? "Create a worker first, then hand it something to do."
                : "Hand a worker a task and it will show up here."
            }
          />
        ) : (
          tasks.map((task) => <TaskRow key={task.taskId} task={task} />)
        )}
      </View>

      {workers.length === 0 ? (
        <View style={styles.section}>
          <Button variant="secondary" onPress={onOpenManagement} testID="dashboard-open-management">
            Create your first worker
          </Button>
        </View>
      ) : null}
    </>
  );
}

function StatCard({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function TaskRow({ task }: { task: AggregatedWorkerTask }): ReactElement {
  return (
    <View style={styles.taskRow} testID={`task-row-${task.taskId}`}>
      <View style={styles.taskMain}>
        <Text style={styles.taskTitle}>{task.title}</Text>
        <Text style={styles.taskMeta}>{task.state.replace(/_/g, " ")}</Text>
      </View>
    </View>
  );
}

function ManagementSection({
  workers,
  templates,
  tasks,
  isRefetching,
  onCreated,
  viewSwitch,
  onOpenWorker,
}: {
  workers: AggregatedWorker[];
  templates: AggregatedWorkerTemplate[];
  tasks: AggregatedWorkerTask[];
  isRefetching: boolean;
  onCreated: () => void;
  /** The Workers/Groups switch, rendered under the page title. */
  viewSwitch: ReactElement;
  /** Opens a worker's detail view. */
  onOpenWorker: (key: string) => void;
}): ReactElement {
  const [isCreating, setIsCreating] = useState(workers.length === 0);
  const openCreate = useCallback(() => setIsCreating(true), []);
  const closeCreate = useCallback(() => setIsCreating(false), []);
  const handleCreated = useCallback(() => {
    setIsCreating(false);
    onCreated();
  }, [onCreated]);

  const action = useMemo(
    () => (
      <Button variant="secondary" onPress={openCreate} testID="console-new-worker" leftIcon={Plus}>
        New worker
      </Button>
    ),
    [openCreate],
  );

  const [filters, setFilters] = useState<WorkerFilters>(DEFAULT_WORKER_FILTERS);
  const roles = useMemo(() => availableRoles(workers), [workers]);
  const visibleWorkers = useMemo(
    () => selectVisibleWorkers(workers, tasks, filters),
    [workers, tasks, filters],
  );
  const onSearchChange = useCallback(
    (value: string) => setFilters((current) => ({ ...current, search: value })),
    [],
  );
  const onStatusChange = useCallback(
    (status: WorkerStatusFilter) => setFilters((current) => ({ ...current, status })),
    [],
  );
  const onRoleChange = useCallback(
    (roleId: string | null) => setFilters((current) => ({ ...current, roleId })),
    [],
  );
  const onSortChange = useCallback(
    (sort: WorkerSort) => setFilters((current) => ({ ...current, sort })),
    [],
  );

  return (
    <>
      <PageHeader
        title="Worker management"
        subtitle="Select a worker to start a task, or create a new one to get to work."
        action={action}
      />
      {viewSwitch}
      <WorkerFilterBar
        onSearchChange={onSearchChange}
        status={filters.status}
        onStatusChange={onStatusChange}
        roleId={filters.roleId}
        onRoleChange={onRoleChange}
        roles={roles}
        sort={filters.sort}
        onSortChange={onSortChange}
        visibleCount={visibleWorkers.length}
      />
      {/* An empty roster and an empty filtered view need different words: the
          first is a thing to fix, the second is a thing to undo. */}
      {visibleWorkers.length === 0 && workers.length > 0 ? (
        <Text style={styles.noMatches}>No worker matches those filters.</Text>
      ) : null}
      <View style={styles.cardGrid}>
        <CreateWorkerTile onPress={openCreate} />
        {visibleWorkers.map((worker) => (
          <WorkerCard
            key={`${worker.serverId}:${worker.id}`}
            worker={worker}
            tasks={tasks}
            onOpen={onOpenWorker}
          />
        ))}
      </View>
      {isCreating ? (
        <CreateWorkerCard templates={templates} onCancel={closeCreate} onCreated={handleCreated} />
      ) : null}
      {isRefetching ? <Text style={styles.refreshing}>Refreshing…</Text> : null}
    </>
  );
}

/**
 * One worker, as a card.
 *
 * A card rather than a row because a worker is an entity you pick, not a line
 * you scan: the reference product lays its roster out this way, and the role
 * summary is what tells you which one to pick. The footer carries the two facts
 * that decide whether it is idle or busy.
 */
function WorkerCard({
  worker,
  tasks,
  onOpen,
}: {
  worker: AggregatedWorker;
  tasks: AggregatedWorkerTask[];
  onOpen: (key: string) => void;
}): ReactElement {
  const own = tasks.filter(
    (task) => task.serverId === worker.serverId && task.workerId === worker.id,
  );
  const lastRun = own.reduce<string | null>(
    (latest, task) => (latest === null || task.updatedAt > latest ? task.updatedAt : latest),
    null,
  );
  const key = `${worker.serverId}:${worker.id}`;
  const handlePress = useCallback(() => onOpen(key), [onOpen, key]);
  return (
    <Pressable
      onPress={handlePress}
      style={styles.workerCard}
      testID={`console-worker-${worker.id}`}
      accessibilityRole="button"
      accessibilityLabel={`Open ${worker.name}`}
    >
      <View style={styles.workerCardHeader}>
        <View style={styles.workerAvatar}>
          <Text style={styles.workerAvatarText}>{worker.name.slice(0, 1).toUpperCase()}</Text>
        </View>
        <Text style={styles.workerCardStatus}>{worker.status}</Text>
      </View>
      <Text style={styles.workerCardName} numberOfLines={1}>
        {worker.name}
      </Text>
      {/* Fall back to the id: a role the host no longer ships is still a fact
          about this worker, and hiding it would look like a bug. */}
      <Text style={styles.workerCardRole} numberOfLines={1}>
        {worker.templateTitle ?? worker.templateId}
      </Text>
      <Text style={styles.workerCardDescription} numberOfLines={3}>
        {worker.templateDescription ?? ""}
      </Text>
      <View style={styles.workerCardFooter}>
        <Text style={styles.taskMeta}>{`Tasks ${own.length}`}</Text>
        <Text style={styles.taskMeta}>
          {lastRun === null ? "Last run never" : `Last run ${formatShortDate(lastRun)}`}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * A compact date for the card footer.
 *
 * Deliberately coarse: the footer answers "has it run at all, and roughly
 * when", and a precise timestamp there would be noise at card width.
 */
function formatShortDate(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "unknown";
  return at.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * The grid's first cell: an invitation to create, in the same shape as the cards
 * around it, so the roster never needs a separate action row.
 */
function CreateWorkerTile({ onPress }: { onPress: () => void }): ReactElement {
  return (
    <Pressable
      onPress={onPress}
      style={styles.createTile}
      testID="console-new-worker-tile"
      accessibilityRole="button"
      accessibilityLabel="New worker"
    >
      <Plus size={ICON_SIZE.md} />
      <Text style={styles.taskMeta}>New worker</Text>
    </Pressable>
  );
}

function CreateWorkerCard({
  templates,
  onCancel,
  onCreated,
}: {
  templates: AggregatedWorkerTemplate[];
  onCancel: () => void;
  onCreated: () => void;
}): ReactElement {
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selected = useMemo(
    () => templates.find((template) => template.id === templateId) ?? null,
    [templates, templateId],
  );
  const canSubmit = name.trim().length > 0 && selected !== null && !submitting;

  const submit = useCallback(async () => {
    if (!selected) return;
    const { getHostRuntimeStore } = await import("@/runtime/host-runtime");
    const client = getHostRuntimeStore().getClient(selected.serverId);
    if (!client) {
      setError("This host is not connected.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await client.createWorker({ name: name.trim(), templateId: selected.id });
      onCreated();
    } catch (cause) {
      // The daemon's refusal is the useful message; a generic string would lose
      // the reason.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  }, [name, selected, onCreated]);

  const handleSubmit = useCallback(() => {
    void submit();
  }, [submit]);

  return (
    <View style={styles.createCard}>
      <Text style={styles.sectionTitle}>New worker</Text>
      <Text style={styles.fieldLabel}>Name</Text>
      <NameInput onChange={setName} />
      <Text style={styles.fieldLabel}>Role</Text>
      <View style={styles.roleList}>
        {templates.map((template) => (
          <RoleOption
            key={`${template.serverId}:${template.id}`}
            template={template}
            selected={template.id === templateId}
            onSelect={setTemplateId}
          />
        ))}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <View style={styles.createActions}>
        <Button variant="ghost" onPress={onCancel} testID="console-create-cancel">
          Cancel
        </Button>
        <Button
          variant="default"
          onPress={handleSubmit}
          disabled={!canSubmit}
          testID="console-create-submit"
        >
          {submitting ? "Creating…" : "Create"}
        </Button>
      </View>
    </View>
  );
}

function NameInput({ onChange }: { onChange: (value: string) => void }): ReactElement {
  return (
    <TextInput
      initialValue=""
      onChangeText={onChange}
      placeholder="Alice"
      testID="console-create-name"
    />
  );
}

function RoleOption({
  template,
  selected,
  onSelect,
}: {
  template: { id: string; title: string; skills: string[] };
  selected: boolean;
  onSelect: (id: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onSelect(template.id), [onSelect, template.id]);
  return (
    <Pressable
      onPress={handlePress}
      style={selected ? styles.roleOptionSelected : styles.roleOption}
      testID={`console-role-${template.id}`}
    >
      <Text style={styles.roleTitle}>{template.title}</Text>
      <Text style={styles.taskMeta}>
        {template.skills.length > 0 ? `${template.skills.length} skills` : "No skills"}
      </Text>
    </Pressable>
  );
}

function CapabilitiesSection(): ReactElement {
  return (
    <>
      <PageHeader
        title="Capabilities & resources"
        subtitle="Equip a worker with the skills and tools its role needs."
      />
      <EmptyPanel
        title="Nothing to configure yet"
        body="Skills, connectors and shared projects arrive with the collaboration work."
      />
    </>
  );
}

function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: ReactElement;
}): ReactElement {
  return (
    <View style={styles.pageHeader}>
      <View style={styles.pageHeaderText}>
        <Text style={styles.pageTitle}>{title}</Text>
        <Text style={styles.pageSubtitle}>{subtitle}</Text>
      </View>
      {action}
    </View>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }): ReactElement {
  return (
    <View style={styles.emptyPanel}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

function HostErrors({
  errors,
}: {
  errors: { serverId: string; serverName: string; message: string }[];
}): ReactElement | null {
  if (errors.length === 0) return null;
  return (
    <View style={styles.emptyPanel}>
      {errors.map((error) => (
        <Text key={error.serverId} style={styles.emptyBody}>
          {error.serverName}: {error.message}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  spinnerColor: { color: theme.colors.accent },
  root: { flex: 1, flexDirection: "row", backgroundColor: theme.colors.surface0 },
  sidebar: {
    width: 264,
    flexShrink: 0,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  rootCompact: {
    flex: 1,
    flexDirection: "column",
    backgroundColor: theme.colors.surface0,
  },
  sidebarCompact: {
    flexShrink: 0,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  sidebarScrollCompact: { flexGrow: 0 },
  sidebarContentCompact: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[3],
    gap: theme.spacing[4],
    alignItems: "center",
  },
  navGroupCompact: { gap: theme.spacing[1] },
  navGroupTitleCompact: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  navRowCompact: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
  },
  navRowCompactActive: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  sidebarHeader: { padding: theme.spacing[3] },
  sidebarScroll: { flex: 1, minHeight: 0 },
  sidebarContent: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[6],
    gap: theme.spacing[6],
  },
  exitButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  exitLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  navGroup: { gap: theme.spacing[1] },
  navGroupTitle: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  navRowActive: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surfaceSidebarSelected,
  },
  navRowLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
  navRowLabelActive: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  navRowCount: {
    marginLeft: "auto",
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
  },
  main: { flex: 1, minWidth: 0 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1, minHeight: 0 },
  scrollContent: {
    gap: theme.spacing[6],
    paddingHorizontal: theme.spacing[8],
    paddingTop: theme.spacing[8],
    paddingBottom: theme.spacing[8],
  },
  pageHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing[4],
  },
  pageHeaderText: { flexShrink: 1, gap: theme.spacing[2] },
  pageTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize["4xl"],
    fontWeight: theme.fontWeight.medium,
  },
  pageSubtitle: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
  panel: {
    gap: theme.spacing[4],
    padding: theme.spacing[6],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  panelTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.medium,
  },
  panelMeta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[3] },
  statCard: {
    flexGrow: 1,
    flexBasis: 160,
    gap: theme.spacing[1],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface0,
  },
  statValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize["4xl"],
    fontWeight: theme.fontWeight.medium,
  },
  statLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
  section: { gap: theme.spacing[3] },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.medium,
  },
  tabRow: { flexDirection: "row", gap: theme.spacing[6] },
  tab: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    paddingBottom: theme.spacing[2],
  },
  tabActive: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    paddingBottom: theme.spacing[2],
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.foreground,
  },
  emptyPanel: {
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[12],
    paddingHorizontal: theme.spacing[6],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  emptyBody: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  noMatches: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  cardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  createTile: {
    // Sized to land four per row on a desktop width, like the reference, and to
    // wrap down to one on a phone without a separate layout.
    flexGrow: 1,
    flexBasis: 240,
    minHeight: 220,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.colors.border,
  },
  workerCard: {
    flexGrow: 1,
    flexBasis: 240,
    minHeight: 220,
    gap: theme.spacing[2],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  workerCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  workerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
  },
  workerAvatarText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  workerCardStatus: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  workerCardName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  workerCardRole: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  workerCardDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  workerCardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: "auto",
    paddingTop: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  taskMain: { flexShrink: 1, gap: theme.spacing[1] },
  taskTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  taskMeta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  createCard: {
    gap: theme.spacing[3],
    padding: theme.spacing[6],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  fieldLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  createActions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
  roleList: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  roleOption: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  roleOptionSelected: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surface0,
  },
  roleTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  errorText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  refreshing: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
/**
 * The nav row's four visual states.
 *
 * Keyed by layout and selection rather than written as a conditional chain:
 * nested ternaries are not allowed here, and `compact ? active ? ...` is the
 * shape that rule exists to prevent.
 */
const NAV_ROW_STYLES = {
  "wide:idle": () => styles.navRow,
  "wide:active": () => styles.navRowActive,
  "compact:idle": () => styles.navRowCompact,
  "compact:active": () => styles.navRowCompactActive,
} as const;
