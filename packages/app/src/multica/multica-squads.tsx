/**
 * The squads surface, as its own page in the source's nav: a roster grid,
 * the create face, and the source's bare empty state — icon circle, title,
 * button, no description line (the source's squads empty copy carries
 * none). Kept apart from the agents page so the nav's two entries map to
 * two routes, as in the source.
 */
import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { Users } from "lucide-react-native";

import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { MulticaEmptyState } from "@/multica/multica-empty";
import { MulticaShell } from "@/multica/multica-nav";

export interface MulticaSquadCardData {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

export function SquadsPage({ serverId }: { serverId: string }): ReactElement {
  const router = useRouter();
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const online = runtimeSnapshot?.connectionStatus === "online";

  const agentsQuery = useFetchQuery({
    queryKey: ["multicaAgentsForSquads", serverId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaAgentList({ includeSystem: false, includeArchived: false });
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

  const openSquad = useCallback(
    (id: string) => {
      router.push(`/multica/squad?serverId=${serverId}&squadId=${id}`);
    },
    [router, serverId],
  );
  const refresh = useCallback(() => {
    void squadsQuery.refetch();
  }, [squadsQuery]);
  const [formSignal, setFormSignal] = useState(0);
  const openForm = useCallback(() => setFormSignal((value) => value + 1), []);

  if (squadsQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  const squads: readonly MulticaSquadCardData[] = (squadsQuery.data?.squads ?? []).map((squad) => ({
    id: squad.id,
    name: squad.name,
    description: squad.description ?? "",
  }));
  const agents = (agentsQuery.data?.agents ?? []).map((agent) => ({
    id: agent.id,
    name: agent.name,
    kind: agent.kind,
  }));

  return (
    <MulticaShell serverId={serverId} active="squads">
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.header}>
          <Users size={18} color="#888" />
          <Text style={styles.heading}>Squads</Text>
          <Text style={styles.headerCount}>{squads.length}</Text>
          <NewSquadForm agents={agents} onCreated={refresh} openSignal={formSignal} />
        </View>
        <View style={styles.grid}>
          {squads.map((squad) => (
            <SquadCard key={squad.id} squad={squad} onOpen={openSquad} />
          ))}
          {squads.length === 0 ? (
            <MulticaEmptyState
              iconKey="squad"
              title="No squads yet."
              description=""
              actionLabel="+ New Squad"
              onAction={openForm}
              testID="multica-squads-empty"
            />
          ) : null}
        </View>
      </ScrollView>
    </MulticaShell>
  );
}

function NewSquadForm({
  agents,
  onCreated,
  openSignal,
}: {
  agents: readonly { id: string; name: string; kind: string }[];
  onCreated: () => void;
  openSignal: number;
}): ReactElement {
  const params = useLocalSearchParams<{ serverId: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [leaderId, setLeaderId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  useEffect(() => {
    if (openSignal > 0) {
      setOpen(true);
    }
  }, [openSignal]);
  const handleName = useCallback((text: string) => setName(text), []);
  const submit = useCallback(() => {
    const trimmed = name.trim();
    if (!client || trimmed === "" || leaderId === null || saving) return;
    setSaving(true);
    void client
      .multicaSquadCreate({ name: trimmed, leaderId })
      .then(() => {
        setName("");
        setLeaderId(null);
        setOpen(false);
        onCreated();
        return undefined;
      })
      .finally(() => setSaving(false));
  }, [client, name, leaderId, saving, onCreated]);
  const leaders = agents.filter((agent) => agent.kind !== "system");
  if (!open) {
    return (
      <Pressable style={styles.newButton} onPress={toggle} testID="multica-new-squad">
        <Text style={styles.newButtonText}>New squad</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.inlineForm}>
      <TextInput
        style={styles.inlineInput}
        initialValue=""
        onChangeText={handleName}
        placeholder="Squad name"
        placeholderTextColor="gray"
        testID="multica-new-squad-name"
      />
      <ScrollView horizontal contentContainerStyle={styles.inlineRow}>
        {leaders.map((agent) => (
          <LeaderChip
            key={agent.id}
            agent={agent}
            active={leaderId === agent.id}
            onPick={setLeaderId}
          />
        ))}
      </ScrollView>
      <View style={styles.inlineRow}>
        <Pressable style={styles.newButton} onPress={submit} testID="multica-new-squad-create">
          <Text style={styles.newButtonText}>{saving ? "…" : "Create"}</Text>
        </Pressable>
        <Pressable style={styles.inlineCancel} onPress={toggle} testID="multica-new-squad-cancel">
          <Text style={styles.inlineCancelText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

function LeaderChip({
  agent,
  active,
  onPick,
}: {
  agent: { id: string; name: string };
  active: boolean;
  onPick: (id: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onPick(agent.id), [agent.id, onPick]);
  return (
    <Pressable style={[styles.choice, active && styles.choiceActive]} onPress={handlePress}>
      <Text style={styles.choiceText}>{agent.name}</Text>
    </Pressable>
  );
}

function SquadCard({
  squad,
  onOpen,
}: {
  squad: MulticaSquadCardData;
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
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  heading: { color: theme.colors.foreground, fontSize: theme.fontSize.lg, fontWeight: "600" },
  headerCount: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[3] },
  card: {
    width: 260,
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing[1],
  },
  cardName: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, fontWeight: "600" },
  cardDesc: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  newButton: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  newButtonText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  inlineForm: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  inlineInput: {
    width: 180,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  inlineRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  inlineCancel: { paddingVertical: theme.spacing[1], paddingHorizontal: theme.spacing[2] },
  inlineCancelText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  choice: {
    paddingVertical: 2,
    paddingHorizontal: theme.spacing[2],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  choiceActive: { backgroundColor: theme.colors.surface2 },
  choiceText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
}));
