import { useCallback, useMemo, useState, type ReactElement } from "react";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Plus } from "lucide-react-native";

import { Button } from "@/components/ui/button";
import { GroupCreateModal } from "@/workers/group-create-modal";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";
import type {
  AggregatedWorker,
  AggregatedWorkerGroup,
  AggregatedWorkerTask,
} from "@/workers/aggregated-workers";
import { buildGroupReport, type GroupReport, type GroupWorkItem } from "@/workers/group-report";

/**
 * Project groups: a roster of workers on one project.
 *
 * The screen's job is to make the two facts that matter legible — which project
 * a group is on, and who is in charge of it — because those are what a person
 * needs to decide whether to hand work to it. Membership editing is secondary
 * and lives behind the create form.
 *
 * Creating a group is the fallback path. The intended one is that a coordinator
 * worker stands up its own team; offering this means the capability is usable
 * before that works, and remains usable if a coordinator gets something wrong.
 */

export interface WorkerGroupsSectionProps {
  groups: AggregatedWorkerGroup[];
  workers: AggregatedWorker[];
  tasks: AggregatedWorkerTask[];
  onChanged: () => void;
  /** The Workers/Groups switch, rendered under the page title. */
  viewSwitch: ReactElement;
}

export function WorkerGroupsSection({
  groups,
  workers,
  tasks,
  onChanged,
  viewSwitch,
}: WorkerGroupsSectionProps): ReactElement {
  const [isCreating, setIsCreating] = useState(false);
  const openCreate = useCallback(() => setIsCreating(true), []);
  const closeCreate = useCallback(() => setIsCreating(false), []);
  const handleCreated = useCallback(() => {
    setIsCreating(false);
    onChanged();
  }, [onChanged]);

  // One lookup for every group rather than one per group: names are needed for
  // coordinators, members and task owners alike.
  const workerNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const worker of workers) map.set(`${worker.serverId}:${worker.id}`, worker.name);
    return map;
  }, [workers]);

  const createAction = useMemo(
    () => (
      <Button variant="secondary" onPress={openCreate} testID="console-new-group" leftIcon={Plus}>
        New group
      </Button>
    ),
    [openCreate],
  );

  const groupRows = useMemo(
    () =>
      groups.map((group) => {
        const report = buildGroupReport({ group, workers, tasks });
        return (
          <GroupRow
            key={`${group.serverId}:${group.id}`}
            report={report}
            workerNames={workerNames}
          />
        );
      }),
    [groups, workers, tasks, workerNames],
  );

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderText}>
          <Text style={styles.sectionTitle}>Worker management</Text>
          <Text style={styles.sectionSubtitle}>
            Select a worker to start a task, or create a new one to get to work.
          </Text>
        </View>
        {createAction}
      </View>
      {viewSwitch}
      <GroupCreateModal
        visible={isCreating}
        workers={workers}
        onClose={closeCreate}
        onCreated={handleCreated}
      />
      {groups.length === 0 && !isCreating ? (
        <EmptyPanel
          title="No groups yet"
          body="Create a group to put several workers on the same project."
        />
      ) : (
        groupRows
      )}
    </View>
  );
}

/**
 * A group's report.
 *
 * The reference product's delivery contract asks a coordinator to say how work
 * was divided before handing it out, report progress without being asked, and on
 * completion report the result alongside anything left unresolved. All of that
 * is readable from the group's own state, so the screen derives it rather than
 * showing a summary someone wrote and a person has to trust.
 *
 * The headline answers "how is this going" first, because that is the question
 * the screen exists for; the objective and the work list are the evidence under
 * it.
 */
function GroupRow({
  report,
  workerNames,
}: {
  report: GroupReport;
  workerNames: Map<string, string>;
}): ReactElement {
  const memberLine = `${report.members.length} member${report.members.length === 1 ? "" : "s"}`;
  const coordinatorLine = report.coordinatorName
    ? `Coordinator: ${report.coordinatorName}`
    : "No coordinator";

  const workRows = report.work.map((item) => (
    <WorkRow key={item.taskId} item={item} serverId={report.serverId} workerNames={workerNames} />
  ));

  return (
    <View style={styles.card} testID={`group-row-${report.groupId}`}>
      <View style={styles.reportHeader}>
        <View style={styles.reportHeaderText}>
          <Text style={styles.rowTitle}>{report.name}</Text>
          <Text style={styles.rowMeta}>{`Project: ${report.projectId}`}</Text>
        </View>
        <View style={styles.reportHeaderMeta}>
          <Text style={styles.rowMeta}>{coordinatorLine}</Text>
          <Text style={styles.rowMeta}>{memberLine}</Text>
        </View>
      </View>

      <View style={styles.progressBlock}>
        <Text style={styles.progressHeadline} testID={`group-progress-${report.groupId}`}>
          {report.progress.headline}
        </Text>
        <Text style={styles.rowMeta}>{report.progress.detail}</Text>
      </View>

      <View style={styles.reportSection}>
        <Text style={styles.fieldLabel}>Objective</Text>
        <Text style={styles.rowMeta}>{report.objective ?? "No objective set for this group."}</Text>
        {report.budgetLine ? (
          <Text style={styles.rowMeta} testID={`group-budget-${report.groupId}`}>
            {report.budgetLine}
          </Text>
        ) : null}
      </View>

      <View style={styles.reportSection}>
        <Text style={styles.fieldLabel}>Work</Text>
        {workRows.length > 0 ? (
          workRows
        ) : (
          <Text style={styles.rowMeta}>
            No tasks have been handed to this group&apos;s members.
          </Text>
        )}
      </View>
    </View>
  );
}

/**
 * One item of a group's work.
 *
 * The task's conversation is the agent session its run happened in, so a task
 * that has run opens it. One that has not is not pressable: there is nothing to
 * open yet, and a row that looks actionable but is not is worse than a plain one.
 */
function WorkRow({
  item,
  serverId,
  workerNames,
}: {
  item: GroupWorkItem;
  serverId: string;
  workerNames: Map<string, string>;
}): ReactElement {
  const owner = item.workerName ?? workerNames.get(`${serverId}:${item.workerId}`) ?? item.workerId;
  const openConversation = useCallback(() => {
    if (!item.agentId) return;
    router.push(buildHostAgentDetailRoute(serverId, item.agentId));
  }, [serverId, item.agentId]);

  const content = (
    <>
      <Text style={styles.workState}>{item.state}</Text>
      <Text style={styles.workTitle}>{item.title}</Text>
      <Text style={styles.workOwner}>{owner}</Text>
    </>
  );

  if (!item.agentId) {
    return (
      <View style={styles.workRow} testID={`group-work-${item.taskId}`}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={openConversation}
      style={styles.workRow}
      testID={`group-work-${item.taskId}`}
      accessibilityRole="button"
      accessibilityLabel={`Open the conversation for ${item.title}`}
    >
      {content}
    </Pressable>
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

const styles = StyleSheet.create((theme) => ({
  section: { gap: theme.spacing[3] },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing[4],
  },
  sectionHeaderText: { flexShrink: 1, gap: theme.spacing[1] },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.medium,
  },
  sectionSubtitle: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  card: {
    gap: theme.spacing[4],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  reportHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  reportHeaderText: { flexShrink: 1, gap: theme.spacing[1] },
  reportHeaderMeta: { alignItems: "flex-end", gap: theme.spacing[1] },
  progressBlock: { gap: theme.spacing[1] },
  progressHeadline: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  reportSection: { gap: theme.spacing[2] },
  workRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  workState: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    width: 88,
  },
  workTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, flexShrink: 1 },
  workOwner: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  rowTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  rowMeta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
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
  form: {
    gap: theme.spacing[3],
    padding: theme.spacing[6],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  formTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.medium,
  },
  fieldLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  chip: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  chipSelected: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surface0,
  },
  chipLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  chipLabelSelected: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  errorText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  formActions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
}));
