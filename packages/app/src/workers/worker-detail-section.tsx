import { useCallback, useMemo, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { router } from "expo-router";
import type { WorkerActivityDay } from "@bytetrue/protocol/worker/rpc-schemas";
import { ArrowLeft } from "lucide-react-native";

import { ICON_SIZE } from "@/styles/theme";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";
import type {
  AggregatedWorker,
  AggregatedWorkerTask,
  WorkerTaskState,
} from "@/workers/aggregated-workers";
import { WorkerActivityHeatmap, WorkerTaskBreakdown } from "@/workers/worker-activity-chart";
import { buildActivityGrid } from "@/workers/worker-activity";
import { countWorkerTasks } from "@/workers/dashboard-derived";
import { NewWorkerTaskForm } from "@/workers/new-worker-task-form";

/**
 * One worker, in detail.
 *
 * The reference product opens a worker from its card into a page of its own,
 * with its own navigation and a Back control. This is the part of that page
 * that belongs to this domain: who the worker is, and what it has been doing.
 * The rest of upstream's page is memory, skills, plugins, connectors and
 * knowledge, none of which exist here and none of which are in scope.
 *
 * Deliberately not a chart. Upstream shows a contribution heatmap and a task
 * breakdown donut; with a handful of tasks they carry less than the counts do,
 * and a chart that says "0" four ways is worse than four numbers.
 */
export interface WorkerDetailSectionProps {
  worker: AggregatedWorker;
  tasks: AggregatedWorkerTask[];
  /** Daily activity from the daemon; empty when the host could not report it. */
  activityDays: readonly WorkerActivityDay[];
  onBack: () => void;
  /** Called after a new task was created and run, so the list reflects it. */
  onTaskCreated: () => void;
}

export function WorkerDetailSection({
  worker,
  tasks,
  activityDays,
  onBack,
  onTaskCreated,
}: WorkerDetailSectionProps): ReactElement {
  const own = useMemo(
    () =>
      tasks
        .filter((task) => task.serverId === worker.serverId && task.workerId === worker.id)
        // Newest first: the detail view answers "what has it been up to", and
        // the oldest task is the least interesting answer to that.
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [tasks, worker.serverId, worker.id],
  );
  const counts = useMemo(() => countWorkerTasks(own), [own]);

  const statCards = useMemo(
    () => [
      { label: "Total", value: counts.total },
      { label: "In progress", value: counts.active },
      { label: "Completed", value: counts.ended },
      { label: "Action required", value: counts.actionRequired },
    ],
    [counts],
  );

  const taskRows = useMemo(
    () => own.map((task) => <WorkerTaskRow key={task.taskId} task={task} />),
    [own],
  );

  // "Today" is read once per render rather than frozen: a screen left open
  // overnight should move its window when something else re-renders it.
  const grid = useMemo(
    () => buildActivityGrid({ days: activityDays, today: new Date() }),
    [activityDays],
  );

  // The breakdown answers "what is this worker spending its time on", which the
  // four counts above answer as totals. The reference splits by trigger source;
  // this domain has one source, so it splits by where the work stands.
  const breakdown = useMemo(() => {
    const byState = new Map<WorkerTaskState, number>();
    for (const task of own) byState.set(task.state, (byState.get(task.state) ?? 0) + 1);
    return TASK_STATE_ORDER.filter((state) => (byState.get(state) ?? 0) > 0).map((state) => ({
      label: state.replace(/_/g, " "),
      count: byState.get(state) ?? 0,
      color: TASK_STATE_COLORS[state],
    }));
  }, [own]);

  return (
    <View style={styles.section} testID={`worker-detail-${worker.id}`}>
      <Pressable
        onPress={onBack}
        style={styles.backRow}
        testID="worker-detail-back"
        accessibilityRole="button"
        accessibilityLabel="Back to workers"
      >
        <ArrowLeft size={ICON_SIZE.md} />
        <Text style={styles.backLabel}>Back</Text>
      </Pressable>

      <View style={styles.identity}>
        <View style={styles.identityAvatar}>
          <Text style={styles.identityAvatarText}>{worker.name.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={styles.identityText}>
          <Text style={styles.identityName}>{worker.name}</Text>
          {/* Fall back to the id: a role the host no longer ships is still a
              fact about this worker, and hiding it would look like a bug. */}
          <Text style={styles.identityRole}>{worker.templateTitle ?? worker.templateId}</Text>
          <Text style={styles.identityDescription}>
            {worker.templateDescription ?? "This worker's role is no longer available."}
          </Text>
          <Text style={styles.identityMeta}>{`${worker.status} · ${worker.serverName}`}</Text>
        </View>
      </View>

      <View style={styles.statRow}>
        {statCards.map((card) => (
          <View key={card.label} style={styles.statCard} testID={`worker-stat-${card.label}`}>
            <Text style={styles.statValue}>{card.value}</Text>
            <Text style={styles.statLabel}>{card.label}</Text>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>New task</Text>
        <NewWorkerTaskForm worker={worker} onCreated={onTaskCreated} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Work log</Text>
        <WorkerActivityHeatmap grid={grid} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Task types</Text>
        <WorkerTaskBreakdown slices={breakdown} total={own.length} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Tasks</Text>
        {taskRows.length > 0 ? (
          taskRows
        ) : (
          <Text style={styles.taskMeta}>No work has been handed to this worker yet.</Text>
        )}
      </View>
    </View>
  );
}

/**
 * One task, opening the conversation it ran in.
 *
 * Same rule as the group report: a task that has not run has nothing to open,
 * so it stays a plain row rather than looking pressable and doing nothing.
 */
function WorkerTaskRow({ task }: { task: AggregatedWorkerTask }): ReactElement {
  const openConversation = useCallback(() => {
    if (!task.agentId) return;
    router.push(buildHostAgentDetailRoute(task.serverId, task.agentId));
  }, [task.serverId, task.agentId]);

  const content = (
    <View style={styles.taskMain}>
      <Text style={styles.taskTitle}>{task.title}</Text>
      <Text style={styles.taskMeta}>{task.state.replace(/_/g, " ")}</Text>
    </View>
  );

  if (!task.agentId) {
    return (
      <View style={styles.taskRow} testID={`worker-task-${task.taskId}`}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={openConversation}
      style={styles.taskRow}
      testID={`worker-task-${task.taskId}`}
      accessibilityRole="button"
      accessibilityLabel={`Open the conversation for ${task.title}`}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: { gap: theme.spacing[4] },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    alignSelf: "flex-start",
  },
  backLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  identity: { flexDirection: "row", gap: theme.spacing[4], alignItems: "flex-start" },
  identityAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
  },
  identityAvatarText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.medium,
  },
  identityText: { flexShrink: 1, gap: theme.spacing[1] },
  identityName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.medium,
  },
  identityRole: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  identityDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  identityMeta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[3] },
  statCard: {
    flexGrow: 1,
    flexBasis: 140,
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  statValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.medium,
  },
  statLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.medium,
  },
  taskRow: {
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  taskMain: { gap: theme.spacing[1] },
  taskTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  taskMeta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));

/**
 * The order the breakdown lists states in.
 *
 * Follows the task's own progression, so the legend reads as the work moving
 * rather than as an arbitrary grouping.
 */
const TASK_STATE_ORDER: readonly WorkerTaskState[] = [
  "planned",
  "prepared",
  "assigned",
  "in_progress",
  "submitted",
  "completed",
  "revision",
  "blocked",
  "cancelled",
];

/**
 * A colour per state group.
 *
 * Grouped rather than one colour per state: nine distinct hues is a legend
 * nobody reads, while three tells you whether the worker is moving, waiting, or
 * finished.
 */
const TASK_STATE_COLORS: Record<WorkerTaskState, string> = {
  planned: "#8f9bb3",
  prepared: "#8f9bb3",
  assigned: "#5b8def",
  in_progress: "#5b8def",
  submitted: "#e0a800",
  completed: "#5cb870",
  revision: "#e0a800",
  blocked: "#d9534f",
  cancelled: "#8f9bb3",
};
