import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Check } from "lucide-react-native";

import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { useIsCompactFormFactor } from "@/constants/layout";
import { ICON_SIZE } from "@/styles/theme";
import { useProjects } from "@/hooks/use-projects";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { AggregatedWorker, AggregatedWorkerGroup } from "@/workers/aggregated-workers";

/**
 * Creating a group.
 *
 * The shape follows the reference product: a modal with a group title, a member
 * list on the left, and the selected member's configuration on the right.
 * Choosing a leader happens in that right-hand pane rather than in a separate
 * control, because leading is a property of a member you have already picked.
 *
 * A project picker is at the top and the reference has none. That is a real
 * difference in the model rather than an omission: this domain binds a group to
 * a project id so the group survives a moved checkout, and the reference binds
 * to a workspace instead. The picker is what our model needs to create one.
 *
 * Members are limited to the chosen host, because a group lives on one host and
 * a member from another could not be run.
 */
export interface GroupCreateModalProps {
  visible: boolean;
  workers: AggregatedWorker[];
  onClose: () => void;
  onCreated: (group: AggregatedWorkerGroup) => void;
}

export interface ProjectOption {
  serverId: string;
  serverName: string;
  projectId: string;
  name: string;
}

const SNAP_POINTS: string[] = ["76%", "94%"];

export function GroupCreateModal({
  visible,
  workers,
  onClose,
  onCreated,
}: GroupCreateModalProps): ReactElement {
  const isCompact = useIsCompactFormFactor();
  const [name, setName] = useState("");
  const [projectKey, setProjectKey] = useState<string | null>(null);
  const [memberKeys, setMemberKeys] = useState<readonly string[]>([]);
  const [leaderKey, setLeaderKey] = useState<string | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const header = useMemo<SheetHeader>(
    () => ({
      title: "Create group",
      subtitle: name.trim().length > 0 ? name.trim() : undefined,
    }),
    [name],
  );

  const projectOptions = useProjectOptions();
  const selectedProject = useMemo(
    () =>
      projectOptions.find((option) => `${option.serverId}:${option.projectId}` === projectKey) ??
      null,
    [projectOptions, projectKey],
  );

  // Members come from the group's host. Offering another host's workers would
  // let a caller build a roster that cannot run.
  const eligibleWorkers = useMemo(
    () =>
      selectedProject
        ? workers.filter((worker) => worker.serverId === selectedProject.serverId)
        : workers,
    [workers, selectedProject],
  );

  const visibleWorkers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle.length === 0) return eligibleWorkers;
    return eligibleWorkers.filter(
      (worker) =>
        worker.name.toLowerCase().includes(needle) ||
        (worker.templateTitle ?? worker.templateId).toLowerCase().includes(needle),
    );
  }, [eligibleWorkers, search]);

  const focusedWorker = useMemo(
    () =>
      eligibleWorkers.find((worker) => `${worker.serverId}:${worker.id}` === focusedKey) ?? null,
    [eligibleWorkers, focusedKey],
  );

  const toggleMember = useCallback((key: string) => {
    setMemberKeys((current) => {
      if (current.includes(key)) {
        // Un-picking the leader cannot leave a leader who is not a member.
        setLeaderKey((leader) => (leader === key ? null : leader));
        return current.filter((entry) => entry !== key);
      }
      return [...current, key];
    });
    setFocusedKey(key);
  }, []);

  const toggleLeader = useCallback((key: string) => {
    setLeaderKey((current) => (current === key ? null : key));
  }, []);

  const canSubmit =
    name.trim().length > 0 && selectedProject !== null && !submitting && memberKeys.length > 0;

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
      // Keys are host-qualified so a worker from another host cannot be confused
      // with one here; the daemon only knows bare worker ids, so they are
      // resolved before the call. Passing a key through unresolved is what the
      // first version did, and the daemon refused it as an unknown worker.
      const chosen = memberKeys
        .map((key) => workers.find((worker) => `${worker.serverId}:${worker.id}` === key))
        .filter((worker): worker is AggregatedWorker => Boolean(worker));
      const leader =
        chosen.find((worker) => `${worker.serverId}:${worker.id}` === leaderKey) ?? null;

      const payload = await client.createWorkerGroup({
        name: name.trim(),
        projectId: selectedProject.projectId,
        ...(leader ? { coordinatorWorkerId: leader.id } : {}),
        memberWorkerIds: chosen
          .filter((worker) => worker.id !== leader?.id)
          .map((worker) => worker.id),
      });

      onCreated({
        ...payload.group,
        serverId: selectedProject.serverId,
        serverName: selectedProject.serverName,
        goal: null,
        messages: [],
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  }, [name, selectedProject, leaderKey, memberKeys, workers, onCreated]);

  const handleSubmit = useCallback(() => {
    void submit();
  }, [submit]);

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Text style={styles.footerCount}>
          {`${memberKeys.length} worker${memberKeys.length === 1 ? "" : "s"} selected`}
        </Text>
        <View style={styles.footerActions}>
          <Button variant="ghost" onPress={onClose} testID="group-create-cancel">
            Cancel
          </Button>
          <Button
            variant="default"
            onPress={handleSubmit}
            disabled={!canSubmit}
            testID="group-create-submit"
          >
            Create
          </Button>
        </View>
      </View>
    ),
    [memberKeys.length, onClose, handleSubmit, canSubmit],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      snapPoints={SNAP_POINTS}
      desktopMaxWidth={720}
      scrollable
      footer={footer}
      testID="group-create-modal"
    >
      <View style={styles.form}>
        <Text style={styles.fieldLabel}>Group title</Text>
        <TextInput
          initialValue=""
          onChangeText={setName}
          placeholder="New group"
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
                <ProjectChip
                  key={key}
                  label={option.name}
                  value={key}
                  selected={key === projectKey}
                  onPress={setProjectKey}
                  testID={`group-project-${option.projectId}`}
                />
              );
            })}
          </View>
        )}

        <Text style={styles.fieldLabel}>Members</Text>
        <Text style={styles.rowMeta}>
          Select the workers for this group, then choose one to lead it.
        </Text>

        {/* Side by side needs room for both columns; on a phone the member list
            and its configuration stack instead of each getting half a width. */}
        <View style={isCompact ? styles.pickerCompact : styles.picker}>
          <View style={styles.pickerList}>
            <TextInput
              initialValue=""
              onChangeText={setSearch}
              placeholder="Search worker"
              testID="group-search-members"
            />
            {visibleWorkers.map((worker) => {
              const key = `${worker.serverId}:${worker.id}`;
              return (
                <MemberRow
                  key={key}
                  worker={worker}
                  selected={memberKeys.includes(key)}
                  isLeader={leaderKey === key}
                  onClick={toggleMember}
                  value={key}
                />
              );
            })}
            {visibleWorkers.length === 0 ? (
              <Text style={styles.rowMeta}>No workers match that search.</Text>
            ) : null}
          </View>

          <View style={styles.pickerDetail}>
            {focusedWorker ? (
              <MemberConfig
                worker={focusedWorker}
                selected={memberKeys.includes(`${focusedWorker.serverId}:${focusedWorker.id}`)}
                isLeader={leaderKey === `${focusedWorker.serverId}:${focusedWorker.id}`}
                onToggleLeader={toggleLeader}
                value={`${focusedWorker.serverId}:${focusedWorker.id}`}
              />
            ) : (
              <Text style={styles.pickerPlaceholder}>
                Select a worker to see its role and choose whether it leads the group.
              </Text>
            )}
          </View>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>
    </AdaptiveModalSheet>
  );
}

/**
 * The project choices, flattened from the app's project list.
 *
 * A project can exist on several hosts, so each host's copy is its own option:
 * creating a group is an act on one host.
 */
function useProjectOptions(): ProjectOption[] {
  const { projects } = useProjects();
  return useMemo(
    () =>
      projects.flatMap((project) =>
        project.hosts.map((host) => ({
          serverId: host.serverId,
          serverName: host.serverName,
          projectId: host.projectId,
          name: host.projectCustomName ?? host.projectName,
        })),
      ),
    [projects],
  );
}

function MemberRow({
  worker,
  selected,
  isLeader,
  onClick,
  value,
}: {
  worker: AggregatedWorker;
  selected: boolean;
  isLeader: boolean;
  onClick: (value: string) => void;
  value: string;
}): ReactElement {
  const handlePress = useCallback(() => onClick(value), [onClick, value]);
  // Memoized because this repository forbids object literals as props: a new
  // object each render defeats the child's ability to skip work.
  const accessibilityState = useMemo(() => ({ checked: selected }), [selected]);
  return (
    <Pressable
      onPress={handlePress}
      style={selected ? styles.memberRowSelected : styles.memberRow}
      testID={`group-member-${worker.id}`}
      accessibilityRole="checkbox"
      accessibilityState={accessibilityState}
      accessibilityLabel={worker.name}
    >
      <View style={selected ? styles.checkboxOn : styles.checkbox}>
        {selected ? <Check size={ICON_SIZE.sm} /> : null}
      </View>
      <View style={styles.memberText}>
        <Text style={styles.memberName}>{worker.name}</Text>
        <Text style={styles.memberRole}>{worker.templateTitle ?? worker.templateId}</Text>
      </View>
      {isLeader ? <Text style={styles.leaderTag}>Leader</Text> : null}
    </Pressable>
  );
}

/**
 * The selected member's configuration.
 *
 * Leading is toggled here, as a property of the member in front of you, rather
 * than through a separate control that would let a leader be chosen without
 * being seen. The response model and per-member workspace the reference shows
 * are absent: this domain runs one provider and the workspace belongs to the
 * group, so neither would have anything behind it.
 */
function MemberConfig({
  worker,
  selected,
  isLeader,
  onToggleLeader,
  value,
}: {
  worker: AggregatedWorker;
  selected: boolean;
  isLeader: boolean;
  onToggleLeader: (value: string) => void;
  value: string;
}): ReactElement {
  const handleToggle = useCallback(() => onToggleLeader(value), [onToggleLeader, value]);
  const accessibilityState = useMemo(
    () => ({ checked: isLeader, disabled: !selected }),
    [isLeader, selected],
  );
  return (
    <View style={styles.config} testID={`group-member-config-${worker.id}`}>
      <Text style={styles.memberName}>{worker.name}</Text>
      <Text style={styles.memberRole}>{worker.templateTitle ?? worker.templateId}</Text>
      <Text style={styles.rowMeta}>
        {worker.templateDescription ?? "This worker's role is no longer available."}
      </Text>
      <Pressable
        onPress={handleToggle}
        disabled={!selected}
        style={styles.leaderToggle}
        testID={`group-leader-${worker.id}`}
        accessibilityRole="checkbox"
        accessibilityState={accessibilityState}
        accessibilityLabel={`Set ${worker.name} as leader`}
      >
        <View style={isLeader ? styles.checkboxOn : styles.checkbox}>
          {isLeader ? <Check size={ICON_SIZE.sm} /> : null}
        </View>
        <Text style={styles.rowMeta}>Set leader</Text>
      </Pressable>
      {!selected ? (
        <Text style={styles.rowMeta}>Add this worker to the group before making it leader.</Text>
      ) : null}
    </View>
  );
}

/** A selectable chip for the project. */
function ProjectChip({
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
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  return (
    <Pressable
      onPress={handlePress}
      style={selected ? styles.chipSelected : styles.chip}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      accessibilityLabel={label}
    >
      <Text style={selected ? styles.chipLabelSelected : styles.chipLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: { gap: theme.spacing[3] },
  fieldLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  rowMeta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
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
  // Master-detail: the list of members beside the one you are configuring.
  picker: {
    flexDirection: "row",
    gap: theme.spacing[4],
    alignItems: "flex-start",
  },
  pickerCompact: {
    flexDirection: "column",
    gap: theme.spacing[3],
  },
  pickerList: { flex: 1, gap: theme.spacing[2] },
  pickerDetail: {
    flex: 1,
    gap: theme.spacing[2],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    minHeight: 200,
  },
  pickerPlaceholder: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
  },
  memberRowSelected: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  memberText: { flexShrink: 1, gap: 2 },
  memberName: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  memberRole: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: {
    width: 18,
    height: 18,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  leaderTag: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginLeft: "auto",
  },
  config: { gap: theme.spacing[2] },
  leaderToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  footerCount: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  footerActions: { flexDirection: "row", gap: theme.spacing[2] },
  errorText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
