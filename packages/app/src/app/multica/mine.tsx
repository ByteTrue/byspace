import { type ReactElement, useCallback, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useLocalSearchParams, useRouter } from "expo-router";

import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { useMulticaCatalog } from "@/multica/multica-catalog";
import { IssueList } from "@/multica/multica-board";
import type { MulticaIssueSummary } from "@bytetrue/protocol/multica/rpc-schemas";

type MineScope = "assigned" | "created" | "subscribed";

/**
 * The owner's desk: the three scopes the source's my-issues page reads, in
 * the single-user form where "me" is the owner row. Tabs switch the scope;
 * the rows are the board's shared list shape so the two surfaces cannot
 * drift apart.
 */
export default function MulticaMineRoute(): ReactElement {
  const params = useLocalSearchParams<{ serverId: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  return <MinePage serverId={serverId} />;
}

function MinePage({ serverId }: { serverId: string }): ReactElement {
  const router = useRouter();
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const online = runtimeSnapshot?.connectionStatus === "online";
  const catalog = useMulticaCatalog(serverId);
  const [scope, setScope] = useState<MineScope>("created");

  const mineQuery = useFetchQuery({
    queryKey: ["multicaMine", serverId, scope, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaIssueMine(scope);
    },
    enabled: online,
    retry: false,
    dataShape: "value",
    staleTimeMs: 3_000,
    refetchInterval: 5_000,
  });

  const openIssue = useCallback(
    (issueId: string) => {
      router.push(`/multica/issue?serverId=${serverId}&issueId=${issueId}`);
    },
    [router, serverId],
  );
  const pickAssigned = useCallback(() => setScope("assigned"), []);
  const pickCreated = useCallback(() => setScope("created"), []);
  const pickSubscribed = useCallback(() => setScope("subscribed"), []);

  if (mineQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  const issues: readonly MulticaIssueSummary[] = mineQuery.data?.issues ?? [];
  const statusColorByKey = new Map(catalog.statuses.map((status) => [status.key, status.color]));

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.heading}>My issues</Text>
        <View style={styles.tabs}>
          <ScopeTab active={scope === "assigned"} label="Assigned" onPress={pickAssigned} />
          <ScopeTab active={scope === "created"} label="Created" onPress={pickCreated} />
          <ScopeTab active={scope === "subscribed"} label="Subscribed" onPress={pickSubscribed} />
        </View>
        <Text style={styles.count}>{issues.length}</Text>
      </View>
      <IssueList
        issues={issues}
        statusColorByKey={statusColorByKey}
        agentNameById={catalog.agentNameById}
        onOpen={openIssue}
      />
    </View>
  );
}

function ScopeTab({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      style={[styles.tab, active && styles.tabActive]}
      onPress={onPress}
      testID={`multica-mine-${label.toLowerCase()}`}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  page: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[4],
  },
  heading: { color: theme.colors.foreground, fontSize: theme.fontSize.base, fontWeight: "600" },
  tabs: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    overflow: "hidden",
  },
  tab: { paddingVertical: 3, paddingHorizontal: theme.spacing[2] },
  tabActive: { backgroundColor: theme.colors.surface2 },
  tabText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  tabTextActive: { color: theme.colors.foreground },
  count: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
}));
