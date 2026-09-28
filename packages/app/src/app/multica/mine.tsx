import { type ReactElement, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useLocalSearchParams, useRouter } from "expo-router";

import { MulticaShell } from "@/multica/multica-nav";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { useMulticaCatalog } from "@/multica/multica-catalog";
import { BoardCanvas, statusesData, useMulticaLiveState } from "@/multica/multica-board";
import { buildColumns } from "@/multica/multica-board-grouping";
import type { MulticaIssueSummary } from "@bytetrue/protocol/multica/rpc-schemas";

/**
 * The source's four scopes; "involved" is what the source's UI calls
 * "My Agents and Squads", and "subscribed" remains its old wire name.
 */
type MineScope = "assigned" | "created" | "involved" | "all";

/**
 * The owner's desk: the three scopes the source's my-issues page reads, in
 * the single-user form where "me" is the owner row. Tabs switch the scope;
 * the rows are the board's shared list shape so the two surfaces cannot
 * drift apart.
 */
const EMPTY_SELECTION: ReadonlySet<string> = new Set();
function noopToggle(_issueId: string): void {}

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
  const [scope, setScope] = useState<MineScope>("assigned");

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
  const pickAll = useCallback(() => setScope("all"), []);
  const pickAssigned = useCallback(() => setScope("assigned"), []);
  const pickCreated = useCallback(() => setScope("created"), []);
  const pickInvolved = useCallback(() => setScope("involved"), []);

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
  const live = useMulticaLiveState(serverId);
  const columns = useMemo(
    () =>
      buildColumns({
        grouping: "status",
        statuses: statusesData(statusesQuery.data?.statuses ?? []),
        agents: catalog.agents,
      }),
    [statusesQuery.data, catalog.agents],
  );
  const moveIssue = useCallback(
    (
      issue: MulticaIssueSummary,
      write: {
        status: string | null;
        assigneeId: string | null;
        clearsAssignee: boolean;
        position: number;
      },
    ) => {
      if (!client) return;
      void client
        .multicaIssueUpdate({
          issueId: issue.id,
          expectedRevision: issue.revision,
          ...(write.status !== null ? { status: write.status } : {}),
          ...assigneePatch(write),
          position: write.position,
        })
        .then(() => mineQuery.refetch())
        .catch(() => mineQuery.refetch());
    },
    [client, mineQuery],
  );
  const createIn = useCallback((_statusKey: string) => undefined, []);

  if (mineQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  const issues: readonly MulticaIssueSummary[] = mineQuery.data?.issues ?? [];

  return (
    <MulticaShell serverId={serverId} active="mine">
      <View style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.heading}>My issues</Text>
          <View style={styles.tabs}>
            <ScopeTab active={scope === "all"} label="All" onPress={pickAll} />
            <ScopeTab active={scope === "assigned"} label="Assigned" onPress={pickAssigned} />
            <ScopeTab active={scope === "created"} label="Created" onPress={pickCreated} />
            <ScopeTab
              active={scope === "involved"}
              label="My agents and squads"
              onPress={pickInvolved}
            />
          </View>
          <Text style={styles.count}>{issues.length}</Text>
        </View>
        <BoardCanvas
          grouping="status"
          columns={columns}
          issues={issues}
          agentNameById={catalog.agentNameById}
          workingIssueIds={live.workingIssueIds}
          onOpen={openIssue}
          onCreateIn={createIn}
          onMove={moveIssue}
          selected={EMPTY_SELECTION}
          onToggleSelect={noopToggle}
        />
      </View>
    </MulticaShell>
  );
}

/** The drag's assignee intent as a protocol patch: clear, set, or omit. */
function assigneePatch(write: {
  assigneeId: string | null;
  clearsAssignee: boolean;
}): Record<string, string | null> {
  if (write.clearsAssignee) {
    return { assigneeType: null, assigneeId: null };
  }
  if (write.assigneeId !== null) {
    return { assigneeType: "agent", assigneeId: write.assigneeId };
  }
  return {};
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
