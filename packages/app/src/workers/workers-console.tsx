import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ArrowLeft, Blocks, LayoutDashboard, Plus, Users, UsersRound } from "lucide-react-native";

import { Button } from "@/components/ui/button";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useWorkers } from "@/hooks/use-workers";
import type { AggregatedWorker, AggregatedWorkerTask } from "@/workers/aggregated-workers";
import {
  countWorkerTasks,
  describeRosterActivity,
  selectAttentionTasks,
} from "@/workers/dashboard-derived";
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

type Section = "dashboard" | "management" | "groups" | "capabilities";

const NAV_GROUPS: { title: string; items: { id: Section; label: string; icon: typeof Users }[] }[] =
  [
    {
      title: "Work management",
      items: [
        { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
        { id: "management", label: "Worker management", icon: Users },
        { id: "groups", label: "Groups", icon: UsersRound },
      ],
    },
    {
      title: "Workers & capabilities",
      items: [{ id: "capabilities", label: "Capabilities & resources", icon: Blocks }],
    },
  ];

export function WorkersConsole({ onExit }: { onExit: () => void }): ReactElement {
  const [section, setSection] = useState<Section>("dashboard");
  const openManagement = useCallback(() => setSection("management"), []);
  const { loadState, hostErrors, refetch, isRefetching } = useWorkers();

  const workers = loadState.status === "loaded" ? loadState.workers : [];
  const templates = loadState.status === "loaded" ? loadState.templates : [];
  const tasks = loadState.status === "loaded" ? loadState.tasks : [];
  const groups = loadState.status === "loaded" ? loadState.groups : [];

  // Counts sit on the roster and group rows only; a count on the other entries
  // would be a number with nothing behind it.
  const sectionCounts = useMemo<Partial<Record<Section, number>>>(
    () => ({ management: workers.length, groups: groups.length }),
    [workers.length, groups.length],
  );

  return (
    <View style={styles.root}>
      <View style={styles.sidebar}>
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
        <ScrollView style={styles.sidebarScroll} contentContainerStyle={styles.sidebarContent}>
          {NAV_GROUPS.map((group) => (
            <View key={group.title} style={styles.navGroup}>
              <Text style={styles.navGroupTitle}>{group.title}</Text>
              {group.items.map((item) => (
                <NavRow
                  key={item.id}
                  item={item}
                  active={item.id === section}
                  onSelect={setSection}
                  count={sectionCounts[item.id]}
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
            {section === "management" ? (
              <ManagementSection
                workers={workers}
                templates={templates}
                isRefetching={isRefetching}
                onCreated={refetch}
              />
            ) : null}
            {section === "groups" ? (
              <WorkerGroupsSection groups={groups} workers={workers} onChanged={refetch} />
            ) : null}
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
}: {
  item: { id: Section; label: string; icon: typeof Users };
  active: boolean;
  count?: number;
  onSelect: (id: Section) => void;
}): ReactElement {
  const Icon = item.icon;
  const handlePress = useCallback(() => onSelect(item.id), [item.id, onSelect]);
  const accessibilityState = useMemo(() => ({ selected: active }), [active]);
  return (
    <Pressable
      onPress={handlePress}
      style={active ? styles.navRowActive : styles.navRow}
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
  isRefetching,
  onCreated,
}: {
  workers: AggregatedWorker[];
  templates: { id: string; title: string; skills: string[]; serverId: string }[];
  isRefetching: boolean;
  onCreated: () => void;
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

  return (
    <>
      <PageHeader
        title="Worker management"
        subtitle="A worker is a long-lived role with its own workspace. Pick a role to start one."
        action={action}
      />
      {isCreating ? (
        <CreateWorkerCard templates={templates} onCancel={closeCreate} onCreated={handleCreated} />
      ) : null}
      {workers.length === 0 && !isCreating ? (
        <EmptyPanel
          title="No workers yet"
          body="Create a worker to handle a role and give it work."
        />
      ) : (
        workers.map((worker) => (
          <WorkerRow key={`${worker.serverId}:${worker.id}`} worker={worker} />
        ))
      )}
      {isRefetching ? <Text style={styles.refreshing}>Refreshing…</Text> : null}
    </>
  );
}

function WorkerRow({ worker }: { worker: AggregatedWorker }): ReactElement {
  return (
    <View style={styles.workerRow} testID={`console-worker-${worker.id}`}>
      <View style={styles.taskMain}>
        <Text style={styles.taskTitle}>{worker.name}</Text>
        {/* Fall back to the id: a role the host no longer ships is still a fact
            about this worker, and hiding it would look like a bug. */}
        <Text style={styles.taskMeta}>{worker.templateTitle ?? worker.templateId}</Text>
      </View>
      <Text style={styles.taskMeta}>{worker.status}</Text>
    </View>
  );
}

function CreateWorkerCard({
  templates,
  onCancel,
  onCreated,
}: {
  templates: { id: string; title: string; skills: string[]; serverId: string }[];
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
  workerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
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
