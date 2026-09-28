import { type ReactElement, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
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
      <AgentHeader agent={agent} enabled={enabled} toggling={toggling} onToggle={toggleStatus} />
      <Text style={styles.meta}>
        {agent.model ?? "default model"} · {agent.permissionMode} · up to {agent.maxConcurrentTasks}{" "}
        at once
      </Text>
      {agent.description !== "" ? <Text style={styles.muted}>{agent.description}</Text> : null}
      <AgentBody agent={agent} tasks={tasks} onOpenIssue={openIssue} />
    </ScrollView>
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
