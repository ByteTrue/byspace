import { type ReactElement, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { StyleSheet } from "react-native-unistyles";
import { useLocalSearchParams } from "expo-router";

import { useFetchQuery } from "@/data/query";
import { MulticaShell } from "@/multica/multica-nav";
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
  return (
    <MulticaShell serverId={serverId} active="squads">
      <SquadPage serverId={serverId} squadId={squadId} />
    </MulticaShell>
  );
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
  const refreshSquad = useCallback(() => {
    void squadQuery.refetch();
  }, [squadQuery]);
  const setLeader = useCallback(
    (leaderId: string) => {
      if (!client) return;
      void client.multicaSquadUpdate({ squadId, leaderId }).then(refreshSquad);
    },
    [client, squadId, refreshSquad],
  );
  const setRole = useCallback(
    (memberId: string, role: string) => {
      if (!client) return;
      void client
        .multicaSquadMemberRole({ squadId, memberType: "agent", memberId, role })
        .then(refreshSquad);
    },
    [client, squadId, refreshSquad],
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
      <SquadProfileEditor serverId={serverId} squad={squad} onChanged={refreshSquad} />
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
      <Text style={styles.section}>Leader</Text>
      {roster.map((agent) => (
        <LeaderPickRow
          key={`leader-${agent.id}`}
          agent={agent}
          isLeader={squad.leaderId === agent.id}
          onPick={setLeader}
        />
      ))}
      <Text style={styles.section}>Roster</Text>
      {squad.members.map((member) => (
        <MemberRowWithActions
          key={member.memberId}
          member={member}
          leaderId={squad.leaderId}
          agentNameById={agentNameById}
          onRemove={removeMember}
          onRole={setRole}
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
  onRole,
}: {
  member: { memberId: string; role: string };
  leaderId: string;
  agentNameById: ReadonlyMap<string, string>;
  onRemove: (memberId: string) => void;
  onRole: (memberId: string, role: string) => void;
}): ReactElement {
  const [editingRole, setEditingRole] = useState(false);
  const [roleDraft, setRoleDraft] = useState(member.role);
  const handleRemove = useCallback(() => onRemove(member.memberId), [member.memberId, onRemove]);
  const startRole = useCallback(() => {
    setRoleDraft(member.role);
    setEditingRole(true);
  }, [member.role]);
  const handleRoleDraft = useCallback((text: string) => setRoleDraft(text), []);
  const commitRole = useCallback(() => {
    setEditingRole(false);
    const next = roleDraft.trim();
    if (next !== member.role) {
      onRole(member.memberId, next);
    }
  }, [roleDraft, member.role, member.memberId, onRole]);
  return (
    <View style={styles.memberRowWrap}>
      <MemberRow
        name={agentNameById.get(member.memberId) ?? member.memberId.slice(0, 8)}
        isLeader={member.memberId === leaderId}
        onRemove={handleRemove}
      />
      <View style={styles.roleRow}>
        <Text style={styles.roleLabel}>role</Text>
        {editingRole ? (
          <TextInput
            style={styles.roleInput}
            initialValue={member.role}
            onChangeText={handleRoleDraft}
            onBlur={commitRole}
            placeholder="role (free text)"
            placeholderTextColor="gray"
            testID={`multica-squad-role-input-${member.memberId}`}
          />
        ) : (
          <Pressable onPress={startRole} testID={`multica-squad-role-${member.memberId}`}>
            <Text style={styles.roleValue}>{member.role === "" ? "—" : member.role}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function LeaderPickRow({
  agent,
  isLeader,
  onPick,
}: {
  agent: { id: string; name: string };
  isLeader: boolean;
  onPick: (id: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onPick(agent.id), [agent.id, onPick]);
  return (
    <Pressable
      style={[styles.leaderRow, isLeader && styles.leaderRowActive]}
      onPress={handlePress}
      testID={`multica-squad-leader-${agent.id}`}
    >
      <Text style={styles.leaderRowText}>{agent.name}</Text>
      {isLeader ? <Text style={styles.leaderTag}>leader</Text> : null}
    </Pressable>
  );
}

function SquadProfileEditor({
  serverId,
  squad,
  onChanged,
}: {
  serverId: string;
  squad: { id: string; name: string; description: string; instructions: string };
  onChanged: () => void;
}): ReactElement {
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const update = useCallback(
    (fields: { name?: string; description?: string; instructions?: string }) => {
      if (!client) return;
      void client
        .multicaSquadUpdate({ squadId: squad.id, ...fields })
        .then(onChanged)
        .catch(onChanged);
    },
    [client, squad.id, onChanged],
  );
  const commitName = useCallback((name: string) => update({ name }), [update]);
  const commitDescription = useCallback((description: string) => update({ description }), [update]);
  const commitInstructions = useCallback(
    (instructions: string) => update({ instructions }),
    [update],
  );
  return (
    <View style={styles.profileBlock}>
      <InlineField
        value={squad.name}
        placeholder="Squad name"
        multiline={false}
        onCommit={commitName}
        testID="multica-squad-name-edit"
      />
      <InlineField
        value={squad.description}
        placeholder="Add a description"
        multiline
        onCommit={commitDescription}
        testID="multica-squad-description-edit"
      />
      <InlineField
        value={squad.instructions}
        placeholder="Add instructions"
        multiline
        onCommit={commitInstructions}
        testID="multica-squad-instructions-edit"
      />
    </View>
  );
}

function InlineField({
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
      <Text style={value === "" ? styles.inlinePlaceholder : styles.inlineValue}>
        {value === "" ? placeholder : value}
      </Text>
    </Pressable>
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
  leaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  leaderRowActive: { backgroundColor: theme.colors.surface2 },
  leaderRowText: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  memberRowWrap: { gap: 2 },
  roleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[4],
  },
  roleLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  roleInput: {
    width: 140,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  roleValue: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
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
