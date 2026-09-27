import { type ReactElement, useCallback } from "react";
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useRouter } from "expo-router";

import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot, useHosts } from "@/runtime/host-runtime";

/**
 * The multica console: the issue-centric workspace's own page.
 *
 * Minimal by design for this slice — the issue list with the office channel
 * pinned at the top (the secretary's line to the owner), and issue detail
 * one tap away. The board, filters, and the full composer are the reference
 * product's surface; the replica grows into them as the engine slices land.
 */
export default function MulticaRoute(): ReactElement {
  return <MulticaConsole />;
}

function MulticaConsole(): ReactElement {
  const hosts = useHosts();
  const primary = hosts[0];
  if (!primary) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Connect a host to use the multica workspace.</Text>
      </View>
    );
  }
  return <IssueList serverId={primary.serverId} />;
}

function IssueList({ serverId }: { serverId: string }): ReactElement {
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const router = useRouter();

  const issuesQuery = useFetchQuery({
    queryKey: ["multicaIssues", serverId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) {
        throw new Error("Target host client is unavailable");
      }
      return client.multicaIssueList({});
    },
    enabled: runtimeSnapshot?.connectionStatus === "online",
    retry: false,
    dataShape: "list",
    staleTimeMs: 5_000,
    refetchInterval: 5_000,
  });

  const issues = issuesQuery.data?.issues ?? [];
  const office = issues.find((issue) => issue.title.startsWith("Office"));
  const openIssue = useCallback(
    (issueId: string) => {
      router.push(`/multica/issue?serverId=${serverId}&issueId=${issueId}`);
    },
    [router, serverId],
  );

  if (issuesQuery.isLoading) {
    return (
      <View style={styles.empty}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <Text style={styles.title}>Multica</Text>
      <Text style={styles.subtitle}>The issue-centric workspace</Text>
      {office ? <OfficeCard onPress={openIssue} issueId={office.id} /> : null}
      <ScrollView contentContainerStyle={styles.list}>
        {issues
          .filter((issue) => issue.id !== office?.id)
          .map((issue) => (
            <IssueRow key={issue.id} issue={issue} onPress={openIssue} />
          ))}
        {issues.length === 0 ? (
          <Text style={styles.emptyText}>No issues yet. Create one from the CLI.</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  page: {
    flex: 1,
    padding: theme.spacing[4],
    gap: theme.spacing[3],
    backgroundColor: theme.colors.background,
  },
  list: { gap: theme.spacing[1] },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.xl, fontWeight: "600" },
  subtitle: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  officeCard: {
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    gap: theme.spacing[1],
  },
  officeTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.base, fontWeight: "600" },
  officeMeta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  rowNumber: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, width: 44 },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  rowMeta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[4],
  },
}));

function OfficeCard({
  issueId,
  onPress,
}: {
  issueId: string;
  onPress: (issueId: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onPress(issueId), [issueId, onPress]);
  return (
    <TouchableOpacity style={styles.officeCard} onPress={handlePress} testID="multica-office-card">
      <Text style={styles.officeTitle}>Office — Chief of Staff</Text>
      <Text style={styles.officeMeta}>Talk to your secretary here</Text>
    </TouchableOpacity>
  );
}

function IssueRow({
  issue,
  onPress,
}: {
  issue: { id: string; number: number | null; title: string; status: string; revision: number };
  onPress: (issueId: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onPress(issue.id), [issue.id, onPress]);
  return (
    <TouchableOpacity style={styles.row} onPress={handlePress} testID={`multica-issue-${issue.id}`}>
      <Text style={styles.rowNumber}>#{issue.number ?? "—"}</Text>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle}>{issue.title}</Text>
        <Text style={styles.rowMeta}>
          {issue.status} · rev {issue.revision}
        </Text>
      </View>
    </TouchableOpacity>
  );
}
