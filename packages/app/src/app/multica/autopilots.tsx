import { type ReactElement, useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { StyleSheet } from "react-native-unistyles";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Timer } from "lucide-react-native";

import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { useMulticaCatalog } from "@/multica/multica-catalog";
import { formatRelativeTime } from "@/multica/multica-activity";

/**
 * The autopilots' management face: a card grid of the standing declarations
 * (mode, assignee, schedule, last run), the create form, and the door to one
 * autopilot's detail. Information parity with the source's table page
 * without the table's shape — this console speaks cards.
 */
export default function MulticaAutopilotsRoute(): ReactElement {
  const params = useLocalSearchParams<{ serverId: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  return <AutopilotsPage serverId={serverId} />;
}

function AutopilotsPage({ serverId }: { serverId: string }): ReactElement {
  const router = useRouter();
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const online = runtimeSnapshot?.connectionStatus === "online";
  const catalog = useMulticaCatalog(serverId);
  const [creating, setCreating] = useState(false);

  const autopilotsQuery = useFetchQuery({
    queryKey: ["multicaAutopilots", serverId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaAutopilotList();
    },
    enabled: online,
    retry: false,
    dataShape: "value",
    staleTimeMs: 3_000,
    refetchInterval: 5_000,
  });

  const openDetail = useCallback(
    (id: string) => {
      router.push(`/multica/autopilot?serverId=${serverId}&autopilotId=${id}`);
    },
    [router, serverId],
  );
  const openCreate = useCallback(() => setCreating(true), []);
  const closeCreate = useCallback(() => setCreating(false), []);
  const created = useCallback(() => {
    setCreating(false);
    void autopilotsQuery.refetch();
  }, [autopilotsQuery]);

  if (autopilotsQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  const autopilots = autopilotsQuery.data?.autopilots ?? [];

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.header}>
        <Timer size={18} color="#888" />
        <Text style={styles.heading}>Autopilots</Text>
        <Text style={styles.headerCount}>{autopilots.length}</Text>
        <Pressable style={styles.newButton} onPress={openCreate} testID="multica-autopilot-new">
          <Text style={styles.newButtonText}>New autopilot</Text>
        </Pressable>
      </View>
      <View style={styles.grid}>
        {autopilots.map((autopilot) => (
          <AutopilotCard
            key={autopilot.id}
            autopilot={autopilot}
            assigneeName={catalog.agentNameById.get(autopilot.assigneeId) ?? null}
            onOpen={openDetail}
          />
        ))}
        {autopilots.length === 0 ? (
          <Text style={styles.empty}>No autopilots. A recurring task belongs here.</Text>
        ) : null}
      </View>
      {creating ? (
        <CreateAutopilotForm
          serverId={serverId}
          agents={catalog.agents}
          onCancel={closeCreate}
          onCreated={created}
        />
      ) : null}
    </ScrollView>
  );
}

interface AutopilotCardData {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly executionMode: string;
  readonly lastRunAt: string | null;
  readonly triggers: readonly { kind: string; cronExpression: string | null }[];
}

function AutopilotCard({
  autopilot,
  assigneeName,
  onOpen,
}: {
  autopilot: AutopilotCardData;
  assigneeName: string | null;
  onOpen: (id: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onOpen(autopilot.id), [autopilot.id, onOpen]);
  const schedule = autopilot.triggers.find((trigger) => trigger.kind === "schedule");
  return (
    <Pressable
      style={styles.card}
      onPress={handlePress}
      testID={`multica-autopilot-${autopilot.id}`}
    >
      <View style={styles.cardHead}>
        <View style={[styles.dot, autopilot.status === "active" && styles.dotOn]} />
        <Text style={styles.cardTitle} numberOfLines={1}>
          {autopilot.title}
        </Text>
        <Text style={styles.modeTag}>{autopilot.executionMode}</Text>
      </View>
      <Text style={styles.cardMeta}>
        {assigneeName ?? "unassigned"} ·{" "}
        {schedule?.cronExpression ? schedule.cronExpression : "manual"}
      </Text>
      <Text style={styles.cardMeta}>
        {autopilot.lastRunAt ? `last run ${formatRelativeTime(autopilot.lastRunAt)}` : "never run"}
      </Text>
    </Pressable>
  );
}

function AssigneeChoice({
  id,
  name,
  active,
  onPick,
}: {
  id: string;
  name: string;
  active: boolean;
  onPick: (id: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onPick(id), [id, onPick]);
  return (
    <Pressable style={[styles.choice, active && styles.choiceActive]} onPress={handlePress}>
      <Text style={styles.choiceText}>{name}</Text>
    </Pressable>
  );
}

function CreateAutopilotForm({
  serverId,
  agents,
  onCancel,
  onCreated,
}: {
  serverId: string;
  agents: readonly { id: string; name: string }[];
  onCancel: () => void;
  onCreated: () => void;
}): ReactElement {
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState<string>(agents[0]?.id ?? "");
  const [mode, setMode] = useState<"create_issue" | "run_only">("run_only");
  const [cron, setCron] = useState("");
  const [saving, setSaving] = useState(false);

  const pickRunOnly = useCallback(() => setMode("run_only"), []);
  const pickCreateIssue = useCallback(() => setMode("create_issue"), []);

  const submit = useCallback(async (): Promise<void> => {
    if (!client || title.trim() === "" || assigneeId === "" || saving) return;
    setSaving(true);
    try {
      await client.multicaAutopilotCreate({
        title: title.trim(),
        assigneeType: "agent",
        assigneeId,
        executionMode: mode,
        ...(description.trim() !== "" ? { description: description.trim() } : {}),
        ...(cron.trim() !== "" ? { cron: cron.trim() } : {}),
      });
      onCreated();
    } finally {
      setSaving(false);
    }
  }, [client, title, description, assigneeId, mode, cron, saving, onCreated]);

  const handleSubmit = useCallback(() => {
    void submit();
  }, [submit]);

  return (
    <View style={styles.form}>
      <Text style={styles.formTitle}>New autopilot</Text>
      <TextInput
        style={styles.input}
        initialValue=""
        onChangeText={setTitle}
        placeholder="Title"
        placeholderTextColor="gray"
        testID="multica-ap-title"
      />
      <TextInput
        style={styles.input}
        initialValue=""
        onChangeText={setDescription}
        placeholder="What each run should do"
        placeholderTextColor="gray"
        multiline
        testID="multica-ap-description"
      />
      <View style={styles.formRow}>
        {agents.map((agent) => (
          <AssigneeChoice
            key={agent.id}
            id={agent.id}
            name={agent.name}
            active={assigneeId === agent.id}
            onPick={setAssigneeId}
          />
        ))}
      </View>
      <View style={styles.formRow}>
        <Pressable
          style={[styles.choice, mode === "run_only" && styles.choiceActive]}
          onPress={pickRunOnly}
        >
          <Text style={styles.choiceText}>run only</Text>
        </Pressable>
        <Pressable
          style={[styles.choice, mode === "create_issue" && styles.choiceActive]}
          onPress={pickCreateIssue}
        >
          <Text style={styles.choiceText}>create issue</Text>
        </Pressable>
      </View>
      <TextInput
        style={styles.input}
        initialValue=""
        onChangeText={setCron}
        placeholder="cron (optional, e.g. 0 9 * * *)"
        placeholderTextColor="gray"
        testID="multica-ap-cron"
      />
      <View style={styles.formRow}>
        <Pressable style={styles.primaryButton} onPress={handleSubmit} testID="multica-ap-create">
          <Text style={styles.newButtonText}>{saving ? "…" : "Create"}</Text>
        </Pressable>
        <Pressable style={styles.cancelButton} onPress={onCancel} testID="multica-ap-cancel">
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  page: { padding: theme.spacing[4], gap: theme.spacing[3] },
  header: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  heading: { color: theme.colors.foreground, fontSize: theme.fontSize.base, fontWeight: "600" },
  headerCount: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  newButton: {
    marginLeft: "auto",
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  newButtonText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[3] },
  card: {
    width: 280,
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing[1],
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#9ca3af" },
  dotOn: { backgroundColor: "#22c55e" },
  cardTitle: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  modeTag: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface2,
    overflow: "hidden",
  },
  cardMeta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  empty: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  form: {
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing[2],
    maxWidth: 560,
  },
  formTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  formRow: { flexDirection: "row", gap: theme.spacing[2] },
  choice: {
    paddingVertical: 3,
    paddingHorizontal: theme.spacing[2],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  choiceActive: { backgroundColor: theme.colors.surface2 },
  choiceText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  primaryButton: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  cancelButton: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
  },
  cancelText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
}));
