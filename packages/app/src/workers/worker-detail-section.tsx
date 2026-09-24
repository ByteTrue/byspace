import { useCallback, useMemo, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { router } from "expo-router";
import { ArrowLeft } from "lucide-react-native";

import { ICON_SIZE } from "@/styles/theme";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";
import type { AggregatedWorker, AggregatedWorkerTask } from "@/workers/aggregated-workers";
import { countWorkerTasks } from "@/workers/dashboard-derived";

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
  onBack: () => void;
}

export function WorkerDetailSection({
  worker,
  tasks,
  onBack,
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
