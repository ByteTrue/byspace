import { type ReactElement, useCallback, useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useLocalSearchParams } from "expo-router";

import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { useMulticaCatalog } from "@/multica/multica-catalog";

/**
 * One squad's management face: the roster, with its leader marked, and the
 * add/remove member writes. The leader is read-only here — who leads is a
 * decision the squad's own update path makes, not a row-level toggle.
 */
export default function MulticaSquadRoute(): ReactElement {
  const params = useLocalSearchParams<{ serverId: string; squadId: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const squadId = typeof params.squadId === "string" ? params.squadId : "";
  return <SquadPage serverId={serverId} squadId={squadId} />;
}

function SquadPage({ serverId, squadId }: { serverId: string; squadId: string }): ReactElement {
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const online = runtimeSnapshot?.connectionStatus === "online";
  const catalog = useMulticaCatalog(serverId);
  const agentNameById = catalog.agentNameById;
  const roster = catalog.agents;

  const squadQuery = useFetchQuery({
    queryKey: ["multicaSquadDetail", serverId, squadId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaSquadGet(squadId);
    },
    enabled: online && squadId !== "",
    retry: false,
    dataShape: "value",
    staleTimeMs: 5_000,
  });

  const memberIds = useMemo(
    () => new Set((squadQuery.data?.squad.members ?? []).map((member) => member.memberId)),
    [squadQuery.data],
  );

  const addMember = useCallback(
    (memberId: string) => {
      if (!client) return;
      void client
        .multicaSquadAddMember({ squadId, memberType: "agent", memberId })
        .then(() => squadQuery.refetch());
    },
    [client, squadId, squadQuery],
  );
  const removeMember = useCallback(
    (memberId: string) => {
      if (!client) return;
      void client
        .multicaSquadRemoveMember({ squadId, memberType: "agent", memberId })
        .then(() => squadQuery.refetch());
    },
    [client, squadId, squadQuery],
  );

  if (squadQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  const squad = squadQuery.data?.squad;
  if (!squad) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Unknown squad.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.heading}>{squad.name}</Text>
      <Text style={styles.meta}>
        leader: {agentNameById.get(squad.leaderId) ?? squad.leaderId.slice(0, 8)} ·{" "}
        {squad.members.length} {squad.members.length === 1 ? "member" : "members"}
      </Text>
      {squad.description !== "" ? <Text style={styles.muted}>{squad.description}</Text> : null}
      {squad.instructions !== "" ? (
        <>
          <Text style={styles.section}>Instructions</Text>
          <Text style={styles.instructions}>{squad.instructions}</Text>
        </>
      ) : null}
      <Text style={styles.section}>Roster</Text>
      {squad.members.map((member) => (
        <MemberRowWithActions
          key={member.memberId}
          member={member}
          leaderId={squad.leaderId}
          agentNameById={agentNameById}
          onRemove={removeMember}
        />
      ))}
      {squad.members.length === 0 ? <Text style={styles.muted}>Empty roster.</Text> : null}
      <Text style={styles.section}>Add a member</Text>
      {roster
        .filter((agent) => !memberIds.has(agent.id))
        .map((agent) => (
          <AddRowWithActions key={agent.id} agent={agent} onAdd={addMember} />
        ))}
    </ScrollView>
  );
}

function MemberRowWithActions({
  member,
  leaderId,
  agentNameById,
  onRemove,
}: {
  member: { memberId: string };
  leaderId: string;
  agentNameById: ReadonlyMap<string, string>;
  onRemove: (memberId: string) => void;
}): ReactElement {
  const handleRemove = useCallback(() => onRemove(member.memberId), [member.memberId, onRemove]);
  return (
    <MemberRow
      name={agentNameById.get(member.memberId) ?? member.memberId.slice(0, 8)}
      isLeader={member.memberId === leaderId}
      onRemove={handleRemove}
    />
  );
}

function AddRowWithActions({
  agent,
  onAdd,
}: {
  agent: { id: string; name: string };
  onAdd: (memberId: string) => void;
}): ReactElement {
  const handleAdd = useCallback(() => onAdd(agent.id), [agent.id, onAdd]);
  return <AddRow name={agent.name} onAdd={handleAdd} />;
}

function MemberRow({
  name,
  isLeader,
  onRemove,
}: {
  name: string;
  isLeader: boolean;
  onRemove: () => void;
}): ReactElement {
  return (
    <View style={styles.row}>
      <Text style={styles.rowName}>{name}</Text>
      {isLeader ? <Text style={styles.leaderTag}>leader</Text> : null}
      {isLeader ? null : (
        <Pressable
          style={styles.rowAction}
          onPress={onRemove}
          testID={`multica-member-remove-${name}`}
        >
          <Text style={styles.rowActionText}>remove</Text>
        </Pressable>
      )}
    </View>
  );
}

function AddRow({ name, onAdd }: { name: string; onAdd: () => void }): ReactElement {
  return (
    <View style={styles.row}>
      <Text style={styles.rowName}>{name}</Text>
      <Pressable style={styles.rowAction} onPress={onAdd} testID={`multica-member-add-${name}`}>
        <Text style={styles.rowActionText}>add</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  page: { padding: theme.spacing[4], gap: theme.spacing[2], maxWidth: 640 },
  heading: { color: theme.colors.foreground, fontSize: theme.fontSize.base, fontWeight: "600" },
  meta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  section: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    marginTop: theme.spacing[3],
  },
  instructions: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, lineHeight: 20 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  rowName: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  leaderTag: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface2,
    overflow: "hidden",
  },
  rowAction: {
    paddingVertical: 2,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  rowActionText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
}));
