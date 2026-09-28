import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { type ReactElement, useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useLocalSearchParams, useRouter } from "expo-router";

import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { useMulticaCatalog } from "@/multica/multica-catalog";
import { formatRelativeTime } from "@/multica/multica-activity";

/**
 * One autopilot's management face: its standing facts, its triggers, the
 * three actions (trigger now, pause, enable), and the run history — the
 * audit trail that makes a declaration you never touch still legible.
 */
export default function MulticaAutopilotRoute(): ReactElement {
  const params = useLocalSearchParams<{ serverId: string; autopilotId: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const autopilotId = typeof params.autopilotId === "string" ? params.autopilotId : "";
  return <AutopilotPage serverId={serverId} autopilotId={autopilotId} />;
}

function AutopilotPage({
  serverId,
  autopilotId,
}: {
  serverId: string;
  autopilotId: string;
}): ReactElement {
  const router = useRouter();
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const online = runtimeSnapshot?.connectionStatus === "online";
  const catalog = useMulticaCatalog(serverId);

  const autopilotQuery = useFetchQuery({
    queryKey: [
      "multicaAutopilotDetail",
      serverId,
      autopilotId,
      runtimeSnapshot?.clientGeneration ?? 0,
    ],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaAutopilotList();
    },
    enabled: online && autopilotId !== "",
    retry: false,
    dataShape: "value",
    staleTimeMs: 3_000,
    refetchInterval: 5_000,
  });

  const runsQuery = useFetchQuery({
    queryKey: [
      "multicaAutopilotRuns",
      serverId,
      autopilotId,
      runtimeSnapshot?.clientGeneration ?? 0,
    ],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaAutopilotRuns(autopilotId);
    },
    enabled: online && autopilotId !== "",
    retry: false,
    dataShape: "value",
    staleTimeMs: 3_000,
    refetchInterval: 5_000,
  });

  const refresh = useCallback(async (): Promise<void> => {
    await Promise.all([autopilotQuery.refetch(), runsQuery.refetch()]);
  }, [autopilotQuery, runsQuery]);

  const triggerNow = useCallback(() => {
    if (!client) return;
    void client.multicaAutopilotTrigger(autopilotId).then(() => refresh());
  }, [client, autopilotId, refresh]);

  const setStatus = useCallback(
    (status: "active" | "paused") => () => {
      if (!client) return;
      void client.multicaAutopilotStatus({ id: autopilotId, status }).then(() => refresh());
    },
    [client, autopilotId, refresh],
  );

  const openIssue = useCallback(
    (issueId: string) => {
      router.push(`/multica/issue?serverId=${serverId}&issueId=${issueId}`);
    },
    [router, serverId],
  );

  if (autopilotQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  const autopilot = (autopilotQuery.data?.autopilots ?? []).find(
    (entry) => entry.id === autopilotId,
  );
  if (!autopilot) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Unknown autopilot.</Text>
      </View>
    );
  }
  const runs = runsQuery.data?.runs ?? [];
  const active = autopilot.status === "active";

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <AutopilotHeader
        autopilot={autopilot}
        active={active}
        archived={autopilot.status === "archived"}
        assigneeName={catalog.agentNameById.get(autopilot.assigneeId) ?? null}
        onTrigger={triggerNow}
        onSetStatus={setStatus}
      />
      <TriggersSection autopilotId={autopilot.id} autopilot={autopilot} onChanged={refresh} />
      <RunsSection runs={runs} onOpenIssue={openIssue} />
    </ScrollView>
  );
}

function AutopilotHeader({
  autopilot,
  active,
  archived,
  assigneeName,
  onTrigger,
  onSetStatus,
}: {
  autopilot: {
    title: string;
    executionMode: string;
    concurrencyPolicy: string;
    lastRunAt: string | null;
    description: string | null;
  };
  active: boolean;
  archived: boolean;
  assigneeName: string | null;
  onTrigger: () => void;
  onSetStatus: (status: "active" | "paused") => () => void;
}): ReactElement {
  return (
    <>
      <View style={styles.header}>
        <View style={[styles.dot, active && styles.dotOn]} />
        <Text style={styles.heading}>{autopilot.title}</Text>
        <Text style={styles.modeTag}>{autopilot.executionMode}</Text>
        {archived ? null : (
          <ActionsRow active={active} onTrigger={onTrigger} onSetStatus={onSetStatus} />
        )}
      </View>
      {archived ? (
        <Text style={styles.muted}>
          Archived — retired declarations keep their history, not their controls.
        </Text>
      ) : null}
      <Text style={styles.muted}>
        {assigneeName ?? "unassigned"} · {autopilot.concurrencyPolicy} ·{" "}
        {autopilot.lastRunAt ? `last run ${formatRelativeTime(autopilot.lastRunAt)}` : "never run"}
      </Text>
      {autopilot.description ? <Text style={styles.muted}>{autopilot.description}</Text> : null}
    </>
  );
}

function ActionsRow({
  active,
  onTrigger,
  onSetStatus,
}: {
  active: boolean;
  onTrigger: () => void;
  onSetStatus: (status: "active" | "paused") => () => void;
}): ReactElement {
  const pause = onSetStatus("paused");
  const enable = onSetStatus("active");
  return (
    <View style={styles.actions}>
      <Pressable style={styles.actionButton} onPress={onTrigger} testID="multica-ap-trigger">
        <Text style={styles.actionText}>Trigger now</Text>
      </Pressable>
      {active ? (
        <Pressable style={styles.actionButton} onPress={pause} testID="multica-ap-pause">
          <Text style={styles.actionText}>Pause</Text>
        </Pressable>
      ) : (
        <Pressable style={styles.actionButton} onPress={enable} testID="multica-ap-enable">
          <Text style={styles.actionText}>Enable</Text>
        </Pressable>
      )}
    </View>
  );
}

function TriggersSection({
  autopilotId,
  autopilot,
  onChanged,
}: {
  autopilotId: string;
  autopilot: {
    triggers: readonly {
      id: string;
      kind: string;
      cronExpression: string | null;
      timezone: string;
      nextRunAt: string | null;
    }[];
  };
  onChanged: () => void;
}): ReactElement {
  return (
    <>
      <Text style={styles.section}>Triggers</Text>
      {autopilot.triggers.map((trigger) => (
        <TriggerRow key={trigger.id} trigger={trigger} onChanged={onChanged} />
      ))}
      {autopilot.triggers.length === 0 ? <Text style={styles.muted}>Manual only.</Text> : null}
      <AddTriggerRow autopilotId={autopilotId} onAdded={onChanged} />
    </>
  );
}

function TriggerRow({
  trigger,
  onChanged,
}: {
  trigger: {
    id: string;
    kind: string;
    cronExpression: string | null;
    timezone: string;
    nextRunAt: string | null;
  };
  onChanged: () => void;
}): ReactElement {
  const runtimeSnapshot = useLocalRuntimeSnapshot();
  const client = runtimeSnapshot?.client ?? null;
  const remove = useCallback(() => {
    if (!client) return;
    void client.multicaAutopilotTriggerDelete({ id: trigger.id }).then(onChanged).catch(onChanged);
  }, [client, trigger.id, onChanged]);
  return (
    <View style={styles.triggerRow}>
      <Text style={styles.muted}>
        {trigger.kind}
        {trigger.cronExpression ? ` · ${trigger.cronExpression} (${trigger.timezone})` : ""} ·{" "}
        {trigger.nextRunAt ? `next ${formatRelativeTime(trigger.nextRunAt)}` : "no next run"}
      </Text>
      <Pressable onPress={remove} testID={`multica-ap-trigger-delete-${trigger.id}`}>
        <Text style={styles.triggerDelete}>delete</Text>
      </Pressable>
    </View>
  );
}

/** The source's AddTriggerDialog, schedule-only: a webhook row without its
 * dispatch surface would be a trigger that can never fire. */
function AddTriggerRow({
  autopilotId,
  onAdded,
}: {
  autopilotId: string;
  onAdded: () => void;
}): ReactElement {
  const runtimeSnapshot = useLocalRuntimeSnapshot();
  const client = runtimeSnapshot?.client ?? null;
  const [cron, setCron] = useState("");
  const [saving, setSaving] = useState(false);
  const handleCron = useCallback((text: string) => setCron(text), []);
  const submit = useCallback(() => {
    const trimmed = cron.trim();
    if (!client || trimmed === "" || saving) return;
    setSaving(true);
    void client
      .multicaAutopilotTriggerCreate({ autopilotId, cronExpression: trimmed })
      .then(() => {
        setCron("");
        onAdded();
        return undefined;
      })
      .finally(() => setSaving(false));
  }, [client, cron, saving, autopilotId, onAdded]);
  return (
    <View style={styles.triggerAddRow}>
      <TextInput
        style={styles.triggerInput}
        initialValue=""
        onChangeText={handleCron}
        placeholder="cron (e.g. 0 9 * * 1-5)"
        placeholderTextColor="gray"
        testID="multica-ap-trigger-cron"
      />
      <Pressable style={styles.newButton} onPress={submit} testID="multica-ap-trigger-add">
        <Text style={styles.newButtonText}>{saving ? "…" : "Add trigger"}</Text>
      </Pressable>
    </View>
  );
}

function useLocalRuntimeSnapshot() {
  const params = useLocalSearchParams<{ serverId: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  return useHostRuntimeSnapshot(serverId);
}

function RunsSection({
  runs,
  onOpenIssue,
}: {
  runs: readonly {
    id: string;
    source: string;
    status: string;
    issueId: string | null;
    triggeredAt: string;
    failureReason: string | null;
  }[];
  onOpenIssue: (issueId: string) => void;
}): ReactElement {
  return (
    <>
      <Text style={styles.section}>Runs ({runs.length})</Text>
      {runs.map((run) => (
        <RunRow key={run.id} run={run} onOpenIssue={onOpenIssue} />
      ))}
      {runs.length === 0 ? <Text style={styles.muted}>No runs yet.</Text> : null}
    </>
  );
}

function RunRow({
  run,
  onOpenIssue,
}: {
  run: {
    id: string;
    source: string;
    status: string;
    issueId: string | null;
    triggeredAt: string;
    failureReason: string | null;
  };
  onOpenIssue: (issueId: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => {
    if (run.issueId !== null) {
      onOpenIssue(run.issueId);
    }
  }, [run.issueId, onOpenIssue]);
  const pressable = run.issueId !== null;
  return (
    <Pressable
      style={styles.runRow}
      onPress={handlePress}
      disabled={!pressable}
      testID={`multica-ap-run-${run.id}`}
    >
      <View style={[styles.dot, run.status === "completed" && styles.dotOn]} />
      <Text style={styles.runText} numberOfLines={1}>
        {run.source} · {run.status} · {formatRelativeTime(run.triggeredAt)}
        {run.failureReason ? ` · ${run.failureReason}` : ""}
      </Text>
      {pressable ? <Text style={styles.runLink}>issue</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  page: { padding: theme.spacing[4], gap: theme.spacing[2], maxWidth: 720 },
  header: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  heading: { color: theme.colors.foreground, fontSize: theme.fontSize.base, fontWeight: "600" },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#9ca3af" },
  dotOn: { backgroundColor: "#22c55e" },
  modeTag: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface2,
    overflow: "hidden",
  },
  actions: { flexDirection: "row", gap: theme.spacing[2], marginLeft: "auto" },
  actionButton: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  actionText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  newButton: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  newButtonText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  triggerRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  triggerDelete: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  triggerAddRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
  },
  triggerInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  section: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    marginTop: theme.spacing[3],
  },
  runRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  runText: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  runLink: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
}));
