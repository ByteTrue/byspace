import { type ReactElement, useCallback } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Bot, Users } from "lucide-react-native";

import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";

/**
 * The management face for the two rosters: agents (the workforce, including
 * the internal ones — a manager sees the carriers, an assignee picker does
 * not) and squads (pure rosters with a leader). Cards are doors to the
 * detail pages; nothing here invents configuration the domain does not
 * hold.
 */
export default function MulticaAgentsRoute(): ReactElement {
  const params = useLocalSearchParams<{ serverId: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  return <RostersPage serverId={serverId} />;
}

function RostersPage({ serverId }: { serverId: string }): ReactElement {
  const router = useRouter();
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const online = runtimeSnapshot?.connectionStatus === "online";

  const agentsQuery = useFetchQuery({
    queryKey: ["multicaAgentsManage", serverId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaAgentList({ includeSystem: true, includeArchived: true });
    },
    enabled: online,
    retry: false,
    dataShape: "list",
    staleTimeMs: 10_000,
  });

  const squadsQuery = useFetchQuery({
    queryKey: ["multicaSquadsManage", serverId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaSquadList();
    },
    enabled: online,
    retry: false,
    dataShape: "list",
    staleTimeMs: 10_000,
  });

  const openAgent = useCallback(
    (id: string) => {
      router.push(`/multica/agent?serverId=${serverId}&agentId=${id}`);
    },
    [router, serverId],
  );
  const openSquad = useCallback(
    (id: string) => {
      router.push(`/multica/squad?serverId=${serverId}&squadId=${id}`);
    },
    [router, serverId],
  );

  if (agentsQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const agents = agentsQuery.data?.agents ?? [];
  const squads = squadsQuery.data?.squads ?? [];

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.header}>
        <Bot size={18} color="#888" />
        <Text style={styles.heading}>Agents</Text>
        <Text style={styles.headerCount}>{agents.length}</Text>
      </View>
      <View style={styles.grid}>
        {agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} onOpen={openAgent} />
        ))}
        {agents.length === 0 ? <Text style={styles.empty}>No agents yet.</Text> : null}
      </View>
      <View style={styles.header}>
        <Users size={18} color="#888" />
        <Text style={styles.heading}>Squads</Text>
        <Text style={styles.headerCount}>{squads.length}</Text>
      </View>
      <View style={styles.grid}>
        {squads.map((squad) => (
          <SquadCard key={squad.id} squad={squad} onOpen={openSquad} />
        ))}
        {squads.length === 0 ? <Text style={styles.empty}>No squads yet.</Text> : null}
      </View>
    </ScrollView>
  );
}

interface AgentCardData {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  /** Presence: idle/working/blocked/error/offline — not an on/off switch. */
  readonly status: string;
  readonly description: string;
  readonly model: string | null;
  readonly permissionMode: string;
  readonly archivedAt: string | null;
}

function AgentCard({
  agent,
  onOpen,
}: {
  agent: AgentCardData;
  onOpen: (id: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onOpen(agent.id), [agent.id, onOpen]);
  return (
    <Pressable style={styles.card} onPress={handlePress} testID={`multica-agent-${agent.id}`}>
      <View style={styles.cardHead}>
        <View
          style={[
            styles.statusDot,
            (agent.status === "idle" || agent.status === "working") && styles.statusDotOn,
          ]}
        />
        <Text style={styles.cardName}>{agent.name}</Text>
        {agent.archivedAt ? <Text style={styles.kindTag}>archived</Text> : null}
        {agent.kind === "system" ? <Text style={styles.kindTag}>internal</Text> : null}
      </View>
      <Text style={styles.cardDesc} numberOfLines={2}>
        {agent.description || "—"}
      </Text>
      <Text style={styles.cardMeta}>
        {agent.model ?? "default model"} · {agent.permissionMode}
      </Text>
    </Pressable>
  );
}

interface SquadCardData {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

function SquadCard({
  squad,
  onOpen,
}: {
  squad: SquadCardData;
  onOpen: (id: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onOpen(squad.id), [squad.id, onOpen]);
  return (
    <Pressable style={styles.card} onPress={handlePress} testID={`multica-squad-${squad.id}`}>
      <Text style={styles.cardName}>{squad.name}</Text>
      <Text style={styles.cardDesc} numberOfLines={2}>
        {squad.description || "—"}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  page: { padding: theme.spacing[4], gap: theme.spacing[3] },
  header: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  heading: { color: theme.colors.foreground, fontSize: theme.fontSize.base, fontWeight: "600" },
  headerCount: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  card: {
    width: 260,
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing[1],
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#9ca3af" },
  statusDotOn: { backgroundColor: "#22c55e" },
  cardName: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, fontWeight: "600" },
  kindTag: {
    marginLeft: "auto",
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface2,
    overflow: "hidden",
  },
  cardDesc: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  cardMeta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  empty: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
}));
