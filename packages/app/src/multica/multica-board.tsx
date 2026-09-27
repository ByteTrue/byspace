import { type ReactElement, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useRouter } from "expo-router";
import { KanbanSquare } from "lucide-react-native";

import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import type { MulticaIssueSummary } from "@bytetrue/protocol/multica/rpc-schemas";

/**
 * The multica board: status columns with issue cards, per the reference
 * product's board layout. Columns read from the status catalog, cards carry
 * title, number, assignee, and priority badge; pressing a card opens the
 * issue's conversation.
 *
 * Column width and the horizontal scroll are the reference's shape — the
 * board is a lane row, not a grid.
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
        <KanbanSquare size={20} color="#888" />
        <Text style={styles.heading}>Board</Text>
        {office ? <OfficePill onPress={openIssue} issueId={office.id} /> : null}
      </View>
      <ScrollView horizontal contentContainerStyle={styles.lanes}>
        {statuses.map((status) => (
          <BoardColumn
            key={status.key}
            title={status.name}
            color={status.color}
            issues={workIssues.filter((issue) => issue.status === status.key)}
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
  selectedId,
  onSelect,
  onOpen,
}: {
  title: string;
  color: string;
  issues: readonly MulticaIssueSummary[];
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
            selected={selectedId === issue.id}
            onPress={handleSelect}
          />
        ))}
        {issues.length === 0 ? <Text style={styles.columnEmpty}>—</Text> : null}
      </ScrollView>
    </View>
  );
}

function BoardCard({
  issue,
  selected,
  onPress,
}: {
  issue: MulticaIssueSummary;
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
      <Text style={styles.cardTitle}>{issue.title}</Text>
      <View style={styles.cardMetaRow}>
        <Text style={styles.cardNumber}>#{issue.number ?? "—"}</Text>
        {issue.priority !== "none" && issue.priority !== null ? (
          <Text style={styles.cardPriority}>{issue.priority}</Text>
        ) : null}
        <Text style={styles.cardAssignee} numberOfLines={1}>
          {issue.assigneeId ? issue.assigneeId.slice(0, 8) : "unassigned"}
        </Text>
      </View>
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
  heading: { color: theme.colors.foreground, fontSize: theme.fontSize.lg, fontWeight: "600" },
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
  column: { width: 264, gap: theme.spacing[2] },
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
  columnList: { gap: theme.spacing[2] },
  columnEmpty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[2],
  },
  card: {
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    gap: theme.spacing[1],
    borderWidth: 1,
    borderColor: "transparent",
  },
  cardSelected: { borderColor: theme.colors.foreground },
  cardTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  cardMetaRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  cardNumber: { color: theme.colors.foregroundMuted, fontSize: 11 },
  cardPriority: { color: theme.colors.foregroundMuted, fontSize: 11, textTransform: "uppercase" },
  cardAssignee: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    marginLeft: "auto",
    maxWidth: 120,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
}));
