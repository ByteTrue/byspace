import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Plus } from "lucide-react-native";

import { Button } from "@/components/ui/button";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { useProjects } from "@/hooks/use-projects";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { AggregatedWorker, AggregatedWorkerGroup } from "@/workers/aggregated-workers";

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
  onChanged: () => void;
}

export function WorkerGroupsSection({
  groups,
  workers,
  onChanged,
}: WorkerGroupsSectionProps): ReactElement {
  const [isCreating, setIsCreating] = useState(false);
  const openCreate = useCallback(() => setIsCreating(true), []);
  const closeCreate = useCallback(() => setIsCreating(false), []);
  const handleCreated = useCallback(() => {
    setIsCreating(false);
    onChanged();
  }, [onChanged]);

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
      groups.map((group) => (
        <GroupRow key={`${group.serverId}:${group.id}`} group={group} workers={workers} />
      )),
    [groups, workers],
  );

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderText}>
          <Text style={styles.sectionTitle}>Groups</Text>
          <Text style={styles.sectionSubtitle}>
            A group is a team of workers on one project, with one coordinator.
          </Text>
        </View>
        {createAction}
      </View>
      {isCreating ? (
        <GroupCreateForm workers={workers} onCancel={closeCreate} onCreated={handleCreated} />
      ) : null}
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

function GroupRow({
  group,
  workers,
}: {
  group: AggregatedWorkerGroup;
  workers: AggregatedWorker[];
}): ReactElement {
  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const worker of workers) map.set(`${worker.serverId}:${worker.id}`, worker.name);
    return map;
  }, [workers]);

  const coordinator = group.members.find((member) => member.role === "coordinator") ?? null;
  // Show the coordinator by name, and fall back to the id when the worker is
  // gone: a departed coordinator is a fact about the group, not a rendering bug.
  const coordinatorLabel = coordinator
    ? (nameById.get(`${group.serverId}:${coordinator.workerId}`) ?? coordinator.workerId)
    : "none";
  const contributors = group.members.filter((member) => member.role !== "coordinator");

  return (
    <View style={styles.row} testID={`group-row-${group.id}`}>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle}>{group.name}</Text>
        <Text style={styles.rowMeta}>{group.goal ?? "No goal set"}</Text>
      </View>
      <View style={styles.rowTrailing}>
        <Text style={styles.rowMeta}>{`Coordinator: ${coordinatorLabel}`}</Text>
        <Text style={styles.rowMeta}>
          {contributors.length === 0
            ? "No other members"
            : `+${contributors.length} member${contributors.length === 1 ? "" : "s"}`}
        </Text>
      </View>
    </View>
  );
}

function GroupCreateForm({
  workers,
  onCancel,
  onCreated,
}: {
  workers: AggregatedWorker[];
  onCancel: () => void;
  onCreated: () => void;
}): ReactElement {
  const { projects } = useProjects();
  const [name, setName] = useState("");
  const [projectKey, setProjectKey] = useState<string | null>(null);
  const [coordinatorKey, setCoordinatorKey] = useState<string | null>(null);
  const [memberKeys, setMemberKeys] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const projectOptions = useMemo(
    () => projects.flatMap((project) => project.hosts.map((host) => ({ ...host }))),
    [projects],
  );
  const selectedProject = useMemo(
    () =>
      projectOptions.find((option) => `${option.serverId}:${option.projectId}` === projectKey) ??
      null,
    [projectOptions, projectKey],
  );
  const selectedCoordinator = useMemo(
    () => workers.find((worker) => `${worker.serverId}:${worker.id}` === coordinatorKey) ?? null,
    [workers, coordinatorKey],
  );

  const canSubmit = name.trim().length > 0 && selectedProject !== null && !submitting;

  const toggleMember = useCallback((key: string) => {
    setMemberKeys((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    );
  }, []);

  const submit = useCallback(async () => {
    if (!selectedProject) return;
    const client = getHostRuntimeStore().getClient(selectedProject.serverId);
    if (!client) {
      setError("This host is not connected.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const members = memberKeys
        .map((key) => workers.find((worker) => `${worker.serverId}:${worker.id}` === key))
        .filter((worker): worker is AggregatedWorker => Boolean(worker))
        // A group lives on one host; members from another host would be
        // unrunnable, so they are left out rather than silently accepted.
        .filter((worker) => worker.serverId === selectedProject.serverId)
        .map((worker) => worker.id);

      await client.createWorkerGroup({
        name: name.trim(),
        projectId: selectedProject.projectId,
        ...(selectedCoordinator && selectedCoordinator.serverId === selectedProject.serverId
          ? { coordinatorWorkerId: selectedCoordinator.id }
          : {}),
        memberWorkerIds: members,
      });
      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  }, [name, selectedProject, selectedCoordinator, memberKeys, workers, onCreated]);

  const handleSubmit = useCallback(() => {
    void submit();
  }, [submit]);

  const eligibleWorkers = useMemo(
    () =>
      selectedProject
        ? workers.filter((worker) => worker.serverId === selectedProject.serverId)
        : workers,
    [workers, selectedProject],
  );

  return (
    <View style={styles.form} testID="group-create-form">
      <Text style={styles.formTitle}>New group</Text>

      <Text style={styles.fieldLabel}>Name</Text>
      <TextInput
        initialValue=""
        onChangeText={setName}
        placeholder="Pricing page"
        testID="group-create-name"
      />

      <Text style={styles.fieldLabel}>Project</Text>
      {projectOptions.length === 0 ? (
        <Text style={styles.rowMeta}>No projects yet. Add one in BySpace first.</Text>
      ) : (
        <View style={styles.chipRow}>
          {projectOptions.map((option) => {
            const key = `${option.serverId}:${option.projectId}`;
            return (
              <Chip
                key={key}
                label={option.projectCustomName ?? option.projectName}
                value={key}
                selected={key === projectKey}
                onPress={setProjectKey}
                testID={`group-project-${option.projectId}`}
              />
            );
          })}
        </View>
      )}

      <Text style={styles.fieldLabel}>Coordinator</Text>
      {eligibleWorkers.length === 0 ? (
        <Text style={styles.rowMeta}>No workers on this host yet.</Text>
      ) : (
        <View style={styles.chipRow}>
          {eligibleWorkers.map((worker) => {
            const key = `${worker.serverId}:${worker.id}`;
            return (
              <Chip
                key={key}
                label={`${worker.name} · ${worker.templateTitle ?? worker.templateId}`}
                value={key}
                selected={key === coordinatorKey}
                onPress={setCoordinatorKey}
                testID={`group-coordinator-${worker.id}`}
              />
            );
          })}
        </View>
      )}

      <Text style={styles.fieldLabel}>Other members</Text>
      <View style={styles.chipRow}>
        {eligibleWorkers.map((worker) => {
          const key = `${worker.serverId}:${worker.id}`;
          return (
            <Chip
              key={`member-${key}`}
              label={worker.name}
              value={key}
              selected={memberKeys.includes(key)}
              onPress={toggleMember}
              testID={`group-member-${worker.id}`}
            />
          );
        })}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <View style={styles.formActions}>
        <Button variant="ghost" onPress={onCancel} testID="group-create-cancel">
          Cancel
        </Button>
        <Button
          variant="default"
          onPress={handleSubmit}
          disabled={!canSubmit}
          testID="group-create-submit"
        >
          {submitting ? "Creating…" : "Create group"}
        </Button>
      </View>
    </View>
  );
}

/**
 * A selectable chip.
 *
 * `value` is required and deliberately has no fallback to `label`. A previous
 * version defaulted to the label, and two of three call sites silently stored a
 * display name while their `selected` check compared against an id, so those
 * chips could never select. The fallback made that invisible.
 */
function Chip({
  label,
  selected,
  onPress,
  value,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: (value: string) => void;
  value: string;
  testID: string;
}): ReactElement {
  const handlePress = useCallback(() => onPress(value), [onPress, value]);
  return (
    <Pressable
      onPress={handlePress}
      style={selected ? styles.chipSelected : styles.chip}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={selected ? styles.chipLabelSelected : styles.chipLabel}>{label}</Text>
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
  row: {
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
  rowMain: { flexShrink: 1, gap: theme.spacing[1] },
  rowTrailing: { alignItems: "flex-end", gap: theme.spacing[1] },
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
