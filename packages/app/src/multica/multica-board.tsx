import { type ReactElement, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useRouter } from "expo-router";
import { KanbanSquare } from "lucide-react-native";

import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import type { MulticaIssueSummary } from "@bytetrue/protocol/multica/rpc-schemas";
import { IssueMetaLine } from "@/multica/multica-activity";
import { useMulticaCatalog } from "@/multica/multica-catalog";

/**
 * The multica board: status columns with issue cards, after the reference
 * product's board layout. Column headers carry a single count against the
 * name; cards carry title, number, priority badge, and the actor avatar with
 * a relative update time. Pressing a card opens the issue's conversation.
 */
export function MulticaBoard({ serverId }: { serverId: string }): ReactElement {
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const online = runtimeSnapshot?.connectionStatus === "online";
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);

  const statusesQuery = useFetchQuery({
    queryKey: ["multicaStatuses", serverId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaStatusList();
    },
    enabled: online,
    retry: false,
    dataShape: "value",
    staleTimeMs: 60_000,
  });

  const issuesQuery = useFetchQuery({
    queryKey: ["multicaIssues", serverId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaIssueList({});
    },
    enabled: online,
    retry: false,
    dataShape: "list",
    staleTimeMs: 3_000,
    refetchInterval: 5_000,
  });

  const runningQuery = useFetchQuery({
    queryKey: ["multicaRunningTasks", serverId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaTaskRunningList();
    },
    enabled: online,
    retry: false,
    dataShape: "value",
    staleTimeMs: 2_000,
    refetchInterval: 3_000,
  });

  const workingAgentIds = useMemo(() => {
    const set = new Set<string>();
    for (const task of runningQuery.data?.tasks ?? []) {
      set.add(task.agentId);
    }
    return set;
  }, [runningQuery.data]);

  const catalog = useMulticaCatalog(serverId);

  const openIssue = useCallback(
    (issueId: string) => {
      router.push(`/multica/issue?serverId=${serverId}&issueId=${issueId}`);
    },
    [router, serverId],
  );

  const issues = useMemo(
    () =>
      (issuesQuery.data?.issues ?? []).slice().sort((a, b) => (b.number ?? 0) - (a.number ?? 0)),
    [issuesQuery.data],
  );
  const office = issues.find((issue) => issue.title.startsWith("Office"));
  const workIssues = issues.filter((issue) => issue.id !== office?.id);
  const statuses = (statusesQuery.data?.statuses ?? []).filter(
    (status) => status.category !== "closed",
  );

  if (issuesQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <KanbanSquare size={18} color="#888" />
        <Text style={styles.heading}>Board</Text>
        <Text style={styles.headerCount}>
          {workIssues.length} {workIssues.length === 1 ? "issue" : "issues"}
        </Text>
        {workingAgentIds.size > 0 ? (
          <View style={styles.workingPill}>
            <View style={styles.workingDot} />
            <Text style={styles.workingPillText}>
              {workingAgentIds.size} {workingAgentIds.size === 1 ? "agent" : "agents"} working
            </Text>
          </View>
        ) : null}
        {office ? <OfficePill onPress={openIssue} issueId={office.id} /> : null}
      </View>
      <ScrollView horizontal contentContainerStyle={styles.lanes}>
        {statuses.map((status) => (
          <BoardColumn
            key={status.key}
            title={status.name}
            color={status.color}
            issues={workIssues.filter((issue) => issue.status === status.key)}
            agentNameById={catalog.agentNameById}
            workingAgentIds={workingAgentIds}
            selectedId={selected}
            onSelect={setSelected}
            onOpen={openIssue}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function OfficePill({
  issueId,
  onPress,
}: {
  issueId: string;
  onPress: (issueId: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onPress(issueId), [issueId, onPress]);
  return (
    <Pressable style={styles.officePill} onPress={handlePress} testID="multica-office-card">
      <Text style={styles.officePillText}>Office — Chief of Staff</Text>
    </Pressable>
  );
}

function BoardColumn({
  title,
  color,
  issues,
  agentNameById,
  workingAgentIds,
  selectedId,
  onSelect,
  onOpen,
}: {
  title: string;
  color: string;
  issues: readonly MulticaIssueSummary[];
  agentNameById: ReadonlyMap<string, string>;
  workingAgentIds: ReadonlySet<string>;
  selectedId: string | null;
  onSelect: (issueId: string | null) => void;
  onOpen: (issueId: string) => void;
}): ReactElement {
  const handleSelect = useCallback(
    (issueId: string) => {
      onSelect(issueId);
      onOpen(issueId);
    },
    [onOpen, onSelect],
  );
  return (
    <View style={styles.column}>
      <View style={styles.columnHeader}>
        <View style={[styles.columnDot, { backgroundColor: color }]} />
        <Text style={styles.columnTitle}>{title}</Text>
        <Text style={styles.columnCount}>{issues.length}</Text>
      </View>
      <ScrollView style={styles.columnBody} contentContainerStyle={styles.columnList}>
        {issues.map((issue) => (
          <BoardCard
            key={issue.id}
            issue={issue}
            agentName={issue.assigneeId ? (agentNameById.get(issue.assigneeId) ?? null) : null}
            working={issue.assigneeId ? workingAgentIds.has(issue.assigneeId) : false}
            selected={selectedId === issue.id}
            onPress={handleSelect}
          />
        ))}
        {issues.length === 0 ? null : null}
      </ScrollView>
    </View>
  );
}

function BoardCard({
  issue,
  agentName,
  working,
  selected,
  onPress,
}: {
  issue: MulticaIssueSummary;
  agentName: string | null;
  working: boolean;
  selected: boolean;
  onPress: (issueId: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onPress(issue.id), [issue.id, onPress]);
  return (
    <Pressable
      style={[styles.card, selected && styles.cardSelected]}
      onPress={handlePress}
      testID={`multica-issue-${issue.id}`}
    >
      <Text style={styles.cardTitle} numberOfLines={2}>
        {issue.title}
      </Text>
      <View style={styles.cardHeaderRow}>
        <Text style={styles.cardNumber}>#{issue.number ?? "—"}</Text>
        {issue.priority !== "none" && issue.priority !== null ? (
          <Text style={styles.cardPriority}>{issue.priority}</Text>
        ) : null}
        {working ? (
          <View style={styles.cardWorking}>
            <View style={styles.workingDot} />
            <Text style={styles.cardWorkingText}>Working</Text>
          </View>
        ) : null}
      </View>
      <IssueMetaLine actorName={agentName} actorId={issue.assigneeId} updatedAt={issue.updatedAt} />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  page: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[4],
  },
  heading: { color: theme.colors.foreground, fontSize: theme.fontSize.base, fontWeight: "600" },
  headerCount: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  officePill: {
    marginLeft: "auto",
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: 999,
    backgroundColor: theme.colors.surface2,
  },
  officePillText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  lanes: {
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[4],
  },
  column: { width: 252 },
  columnHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  columnDot: { width: 8, height: 8, borderRadius: 4 },
  columnTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, fontWeight: "600" },
  columnCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginLeft: "auto",
  },
  columnBody: { flex: 1 },
  columnList: { gap: theme.spacing[1] },
  card: {
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    gap: theme.spacing[1],
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardSelected: { borderColor: theme.colors.foreground },
  cardTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, fontWeight: "500" },
  cardHeaderRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  cardNumber: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  cardPriority: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textTransform: "uppercase",
  },
  workingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    marginLeft: "auto",
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: 999,
    backgroundColor: theme.colors.surface2,
  },
  workingPillText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  workingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#f59e0b",
  },
  cardWorking: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginLeft: "auto",
  },
  cardWorkingText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
}));
