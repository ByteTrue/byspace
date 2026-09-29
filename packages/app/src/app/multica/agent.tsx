import { type ReactElement, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { StyleSheet } from "react-native-unistyles";
import { useLocalSearchParams, useRouter } from "expo-router";

import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";

/**
 * One agent's management face: what it is (name, kind, status), what it is
 * told (its instructions, in full — the behaviour text is the thing a
 * manager actually reads), how it is bounded (model, permission mode,
 * concurrency), and what it has done lately (its recent queue history, each
 * run linking to its issue when it has one).
 *
 * Archive/restore is the only write here — the source's switch (031), not
 * presence status, which is runtime state.
 */
export default function MulticaAgentRoute(): ReactElement {
  const params = useLocalSearchParams<{ serverId: string; agentId: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const agentId = typeof params.agentId === "string" ? params.agentId : "";
  return <AgentPage serverId={serverId} agentId={agentId} />;
}

function AgentPage({ serverId, agentId }: { serverId: string; agentId: string }): ReactElement {
  const router = useRouter();
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const online = runtimeSnapshot?.connectionStatus === "online";
  const [toggling, setToggling] = useState(false);

  const agentQuery = useFetchQuery({
    queryKey: ["multicaAgentDetail", serverId, agentId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaAgentGet(agentId);
    },
    enabled: online && agentId !== "",
    retry: false,
    dataShape: "value",
    staleTimeMs: 5_000,
  });

  const tasksQuery = useFetchQuery({
    queryKey: ["multicaAgentTasks", serverId, agentId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaTaskList({ agentId });
    },
    enabled: online && agentId !== "",
    retry: false,
    dataShape: "value",
    staleTimeMs: 5_000,
  });

  const toggleStatus = useCallback(() => {
    if (!client || !agentQuery.data) return;
    const next = agentQuery.data.agent.archivedAt ? "active" : "archived";
    setToggling(true);
    void client
      .multicaAgentStatus(agentId, next)
      .then(() => agentQuery.refetch())
      .finally(() => setToggling(false));
  }, [client, agentQuery, agentId]);

  const openIssue = useCallback(
    (issueId: string) => {
      router.push(`/multica/issue?serverId=${serverId}&issueId=${issueId}`);
    },
    [router, serverId],
  );

  const refreshAgent = useCallback(() => {
    void agentQuery.refetch();
  }, [agentQuery]);

  if (agentQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  const agent = agentQuery.data?.agent;
  if (!agent) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Unknown agent.</Text>
      </View>
    );
  }
  const tasks = tasksQuery.data?.tasks ?? [];
  const enabled = !agent.archivedAt;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <AgentProfileEditor serverId={serverId} agent={agent} onChanged={refreshAgent} />
      <AgentHeader agent={agent} enabled={enabled} toggling={toggling} onToggle={toggleStatus} />
      <Text style={styles.meta}>
        {agent.model ?? "default model"} · {agent.permissionMode} · up to {agent.maxConcurrentTasks}{" "}
        at once
      </Text>
      <AgentBody agent={agent} tasks={tasks} onOpenIssue={openIssue} />
    </ScrollView>
  );
}

/**
 * The inspector's profile face, translated: name and description are
 * click-to-edit fields that commit on leaving the input, and the
 * concurrency bound is a small stepper. The source autosaves on blur; ours
 * commits on the same gesture through the same update RPC.
 */
function AgentProfileEditor({
  serverId,
  agent,
  onChanged,
}: {
  serverId: string;
  agent: {
    id: string;
    name: string;
    description: string;
    maxConcurrentTasks: number;
    model: string | null;
    customEnv: string | null;
  };
  onChanged: () => void;
}): ReactElement {
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const update = useCallback(
    (fields: {
      name?: string;
      description?: string;
      maxConcurrentTasks?: number;
      model?: string | null;
      customEnv?: Record<string, string> | null;
    }) => {
      if (!client) return;
      void client
        .multicaAgentUpdate({ id: agent.id, ...fields })
        .then(onChanged)
        .catch(onChanged);
    },
    [client, agent.id, onChanged],
  );
  const commitName = useCallback((name: string) => update({ name }), [update]);
  const commitModel = useCallback(
    (model: string) => update({ model: model === "" ? null : model }),
    [update],
  );
  const commitEnv = useCallback(
    (draft: string) => {
      if (draft.trim() === "") {
        update({ customEnv: null });
        return;
      }
      try {
        const parsed: unknown = JSON.parse(draft);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          return;
        }
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value !== "string") {
            return;
          }
          env[key] = value;
        }
        update({ customEnv: env });
      } catch {
        // A broken JSON draft is not committed; the field keeps its text.
      }
    },
    [update],
  );
  const commitDescription = useCallback((description: string) => update({ description }), [update]);
  const bumpConcurrency = useCallback(() => {
    update({ maxConcurrentTasks: agent.maxConcurrentTasks + 1 });
  }, [update, agent.maxConcurrentTasks]);
  const lowerConcurrency = useCallback(() => {
    if (agent.maxConcurrentTasks > 1) {
      update({ maxConcurrentTasks: agent.maxConcurrentTasks - 1 });
    }
  }, [update, agent.maxConcurrentTasks]);
  return (
    <View style={styles.profileBlock}>
      <InlineEditField
        value={agent.name}
        placeholder="Agent name"
        multiline={false}
        onCommit={commitName}
        testID="multica-agent-name-edit"
      />
      <InlineEditField
        value={agent.description}
        placeholder="Add a description"
        multiline
        onCommit={commitDescription}
        testID="multica-agent-description-edit"
      />
      <InlineEditField
        value={agent.model ?? ""}
        placeholder="default model"
        multiline={false}
        onCommit={commitModel}
        testID="multica-agent-model-edit"
      />
      <InlineEditField
        value={agent.customEnv ?? "{}"}
        placeholder='Custom env as JSON, e.g. {"TZ": "UTC"}'
        multiline
        onCommit={commitEnv}
        testID="multica-agent-env-edit"
      />
      <View style={styles.concurrencyRow}>
        <Text style={styles.concurrencyLabel}>Concurrency</Text>
        <Pressable onPress={lowerConcurrency} testID="multica-agent-concurrency-down">
          <Text style={styles.concurrencyButton}>−</Text>
        </Pressable>
        <Text style={styles.concurrencyValue}>{agent.maxConcurrentTasks}</Text>
        <Pressable onPress={bumpConcurrency} testID="multica-agent-concurrency-up">
          <Text style={styles.concurrencyButton}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function InlineEditField({
  value,
  placeholder,
  multiline,
  onCommit,
  testID,
}: {
  value: string;
  placeholder: string;
  multiline: boolean;
  onCommit: (next: string) => void;
  testID: string;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const start = useCallback(() => {
    setDraft(value);
    setEditing(true);
  }, [value]);
  const handleChange = useCallback((text: string) => setDraft(text), []);
  const commit = useCallback(() => {
    setEditing(false);
    const next = draft.trim();
    if (next !== value) {
      onCommit(next);
    }
  }, [draft, value, onCommit]);
  if (editing) {
    return (
      <TextInput
        style={[styles.inlineEditor, multiline && styles.inlineEditorMulti]}
        initialValue={value}
        onChangeText={handleChange}
        onBlur={commit}
        placeholder={placeholder}
        placeholderTextColor="gray"
        multiline={multiline}
        autoFocus
        testID={`${testID}-input`}
      />
    );
  }
  return (
    <Pressable onPress={start} testID={testID}>
      {value === "" ? (
        <Text style={styles.inlinePlaceholder}>{placeholder}</Text>
      ) : (
        <Text style={styles.inlineValue}>{value}</Text>
      )}
    </Pressable>
  );
}

function AgentHeader({
  agent,
  enabled,
  toggling,
  onToggle,
}: {
  agent: { name: string; kind: string };
  enabled: boolean;
  toggling: boolean;
  onToggle: () => void;
}): ReactElement {
  return (
    <View style={styles.header}>
      <View style={[styles.statusDot, enabled && styles.statusDotOn]} />
      <Text style={styles.heading}>{agent.name}</Text>
      {agent.kind === "system" ? <Text style={styles.kindTag}>internal</Text> : null}
      <Pressable
        style={styles.toggle}
        onPress={onToggle}
        disabled={toggling}
        testID="multica-agent-toggle"
      >
        <Text style={styles.toggleText}>{enabled ? "Archive" : "Restore"}</Text>
      </Pressable>
    </View>
  );
}

function AgentBody({
  agent,
  tasks,
  onOpenIssue,
}: {
  agent: { instructions: string };
  tasks: readonly { id: string; status: string; issueId: string | null; createdAt: string }[];
  onOpenIssue: (issueId: string) => void;
}): ReactElement {
  return (
    <>
      <SectionTitle title="Instructions" />
      <Text style={styles.instructions}>
        {agent.instructions !== "" ? agent.instructions : "(none)"}
      </Text>
      <SectionTitle title={`Recent runs (${tasks.length})`} />
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} onOpenIssue={onOpenIssue} />
      ))}
      {tasks.length === 0 ? <Text style={styles.muted}>No runs yet.</Text> : null}
    </>
  );
}

function SectionTitle({ title }: { title: string }): ReactElement {
  return <Text style={styles.section}>{title}</Text>;
}

function TaskRow({
  task,
  onOpenIssue,
}: {
  task: {
    id: string;
    status: string;
    issueId: string | null;
    createdAt: string;
  };
  onOpenIssue: (issueId: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => {
    if (task.issueId !== null) {
      onOpenIssue(task.issueId);
    }
  }, [task.issueId, onOpenIssue]);
  const label = useMemo(() => {
    const when = new Date(task.createdAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${task.status} · ${when}`;
  }, [task.createdAt, task.status]);
  const pressable = task.issueId !== null;
  return (
    <Pressable
      style={styles.taskRow}
      onPress={handlePress}
      disabled={!pressable}
      testID={`multica-agent-run-${task.id}`}
    >
      <View style={[styles.statusDot, task.status === "completed" && styles.statusDotOn]} />
      <Text style={styles.taskLabel} numberOfLines={1}>
        {label}
      </Text>
      {pressable ? <Text style={styles.taskLink}>issue</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  profileBlock: { gap: theme.spacing[2], marginBottom: theme.spacing[2] },
  inlineEditor: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  inlineEditorMulti: { minHeight: 56 },
  inlinePlaceholder: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  inlineValue: { color: theme.colors.foreground, fontSize: theme.fontSize.lg, fontWeight: "600" },
  concurrencyRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  concurrencyLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  concurrencyButton: { color: theme.colors.foreground, fontSize: theme.fontSize.lg },
  concurrencyValue: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  page: { padding: theme.spacing[4], gap: theme.spacing[2], maxWidth: 760 },
  header: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  heading: { color: theme.colors.foreground, fontSize: theme.fontSize.base, fontWeight: "600" },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#9ca3af" },
  statusDotOn: { backgroundColor: "#22c55e" },
  kindTag: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface2,
    overflow: "hidden",
  },
  toggle: {
    marginLeft: "auto",
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  toggleText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  meta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  section: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    marginTop: theme.spacing[3],
  },
  instructions: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  taskLabel: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  taskLink: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
}));
