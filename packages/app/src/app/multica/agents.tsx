import { MulticaEmptyState } from "@/multica/multica-empty";
import { MulticaShell } from "@/multica/multica-nav";
import { type ReactElement, useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Bot, Tag, Timer } from "lucide-react-native";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
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

  const openAgent = useCallback(
    (id: string) => {
      router.push(`/multica/agent?serverId=${serverId}&agentId=${id}`);
    },
    [router, serverId],
  );
  const refresh = useCallback(() => {
    void agentsQuery.refetch();
  }, [agentsQuery]);

  const [agentFormSignal, setAgentFormSignal] = useState(0);
  const openAgentForm = useCallback(() => setAgentFormSignal((value) => value + 1), []);

  if (agentsQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const agents = agentsQuery.data?.agents ?? [];

  return (
    <MulticaShell serverId={serverId} active="rosters">
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.header}>
          <Bot size={18} color="#888" />
          <Text style={styles.heading}>Agents</Text>
          <Text style={styles.tagline} numberOfLines={1}>
            AI teammates that pick up issues, comment, and update status.
          </Text>
          <Text style={styles.headerCount}>{agents.length}</Text>
          <NewAgentButton onCreated={refresh} openSignal={agentFormSignal} />
          <AutopilotsPill serverId={serverId} />
        </View>
        <View style={styles.grid}>
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} onOpen={openAgent} />
          ))}
          {agents.length === 0 ? (
            <MulticaEmptyState
              iconKey="agent"
              title="No agents yet"
              description="Create an agent, then assign it issues."
              actionLabel="+ New agent"
              onAction={openAgentForm}
              testID="multica-agents-empty"
            />
          ) : null}
        </View>
        <LabelsSection serverId={serverId} onCreated={refresh} />
      </ScrollView>
    </MulticaShell>
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

/**
 * The creation faces the source's roster pages carry: an agent needs only a
 * name (defaults make it private and local); a squad needs a name and a
 * leader, whose choice is what makes a roster a roster.
 */
function NewAgentButton({
  onCreated,
  openSignal,
}: {
  onCreated: () => void;
  openSignal: number;
}): ReactElement {
  const params = useLocalSearchParams<{ serverId: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [roles, setRoles] = useState<readonly { key: string; name: string; description: string }[]>(
    [],
  );
  const [roleKey, setRoleKey] = useState<string | null>(null);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  // The role catalog arrives on open — it is small, stable, and the form is
  // the only place it is picked.
  useEffect(() => {
    if (!open || !client) return;
    void client
      .multicaRoleList()
      .then((payload) => {
        setRoles(payload.roles);
        return undefined;
      })
      .catch(() => undefined);
  }, [open, client]);
  const pickRole = useCallback(
    (key: string) => {
      setRoleKey(key);
      const role = roles.find((entry) => entry.key === key);
      if (role) {
        setName(role.name);
      }
    },
    [roles],
  );
  // The empty state's button opens the same form from elsewhere.
  useEffect(() => {
    if (openSignal > 0) {
      setOpen(true);
    }
  }, [openSignal]);
  const handleName = useCallback((text: string) => setName(text), []);
  const submit = useCallback(() => {
    const trimmed = name.trim();
    if (!client || trimmed === "" || saving) return;
    setSaving(true);
    void client
      .multicaAgentCreate({ name: trimmed, role: roleKey ?? undefined })
      .then(() => {
        setName("");
        setOpen(false);
        onCreated();
        return undefined;
      })
      .finally(() => setSaving(false));
  }, [client, name, saving, onCreated, roleKey]);
  if (!open) {
    return (
      <Pressable style={styles.newButton} onPress={toggle} testID="multica-new-agent">
        <Text style={styles.newButtonText}>New agent</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.inlineForm}>
      <TextInput
        style={styles.inlineInput}
        initialValue=""
        onChangeText={handleName}
        placeholder="Agent name"
        placeholderTextColor="gray"
        testID="multica-new-agent-name"
      />
      <RoleChoice roles={roles} roleKey={roleKey} onPick={pickRole} />
      <Pressable style={styles.newButton} onPress={submit} testID="multica-new-agent-create">
        <Text style={styles.newButtonText}>{saving ? "…" : "Create"}</Text>
      </Pressable>
      <Pressable style={styles.inlineCancel} onPress={toggle} testID="multica-new-agent-cancel">
        <Text style={styles.inlineCancelText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

/**
 * The built-in role picker on the create form: choosing a role seeds the
 * agent's voice and skill set server-side (the role's three persona files
 * become its instructions, its skills become builtin rows), so picking one
 * is the whole configuration act.
 */
function RoleChoice({
  roles,
  roleKey,
  onPick,
}: {
  roles: readonly { key: string; name: string; description: string }[];
  roleKey: string | null;
  onPick: (key: string) => void;
}): ReactElement {
  const chosen = roles.find((role) => role.key === roleKey);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger style={styles.roleTrigger} testID="multica-new-agent-role">
        <Text style={styles.roleTriggerText}>{chosen ? chosen.name : "Role (optional)"}</Text>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {roles.map((role) => (
          <RoleChoiceItem
            key={role.key}
            role={role}
            selected={role.key === roleKey}
            onPick={onPick}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RoleChoiceItem({
  role,
  selected,
  onPick,
}: {
  role: { key: string; name: string; description: string };
  selected: boolean;
  onPick: (key: string) => void;
}): ReactElement {
  const handleSelect = useCallback(() => onPick(role.key), [onPick, role.key]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {role.name}
    </DropdownMenuItem>
  );
}

/**
 * The label directory's management face, after the source's settings tab:
 * a row per label with its color, rename and recolor inline, delete at the
 * row's end. Deleting cascades the attachments through the junction's FK —
 * the source cleans them by hand for the same effect.
 */
const LABEL_PRESETS = [
  "#6b7280",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
] as const;

function LabelsSection({
  serverId,
  onCreated,
}: {
  serverId: string;
  onCreated: () => void;
}): ReactElement {
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const online = runtimeSnapshot?.connectionStatus === "online";
  const labelsQuery = useFetchQuery({
    queryKey: ["multicaLabelsManage", serverId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaLabelList();
    },
    enabled: online,
    retry: false,
    dataShape: "list",
    staleTimeMs: 10_000,
  });
  const labels = labelsQuery.data?.labels ?? [];
  const refresh = useCallback(() => {
    void labelsQuery.refetch();
    onCreated();
  }, [labelsQuery, onCreated]);
  const update = useCallback(
    (labelId: string, fields: { name?: string; color?: string }) => {
      if (!client) return;
      void client
        .multicaLabelUpdate({ labelId, ...fields })
        .then(refresh)
        .catch(refresh);
    },
    [client, refresh],
  );
  const remove = useCallback(
    (labelId: string) => {
      if (!client) return;
      void client.multicaLabelDelete({ labelId }).then(refresh).catch(refresh);
    },
    [client, refresh],
  );
  const create = useCallback(
    (name: string) => {
      if (!client || name.trim() === "") return;
      void client
        .multicaLabelCreate({ name: name.trim(), color: LABEL_PRESETS[0] })
        .then(refresh)
        .catch(refresh);
    },
    [client, refresh],
  );
  return (
    <>
      <View style={styles.header}>
        <Tag size={18} color="#888" />
        <Text style={styles.heading}>Labels</Text>
        <Text style={styles.headerCount}>{labels.length}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {labels.map((label) => (
          <LabelRow key={label.id} label={label} onUpdate={update} onDelete={remove} />
        ))}
        {labels.length === 0 ? (
          <MulticaEmptyState
            iconKey="label"
            title="No labels yet"
            description="Labels group issues across the board."
            actionLabel={null}
            onAction={null}
            testID="multica-labels-empty"
          />
        ) : null}
        <LabelCreateRow onCreate={create} />
      </ScrollView>
    </>
  );
}

function LabelRow({
  label,
  onUpdate,
  onDelete,
}: {
  label: { id: string; name: string; color: string };
  onUpdate: (id: string, fields: { name?: string; color?: string }) => void;
  onDelete: (id: string) => void;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const start = useCallback(() => setEditing(true), []);
  const handleChange = useCallback(() => undefined, []);
  const [draft, setDraft] = useState(label.name);
  const handleDraft = useCallback((text: string) => setDraft(text), []);
  const commit = useCallback(() => {
    setEditing(false);
    const next = draft.trim();
    if (next !== "" && next !== label.name) {
      onUpdate(label.id, { name: next });
    }
  }, [draft, label.id, label.name, onUpdate]);
  const remove = useCallback(() => onDelete(label.id), [label.id, onDelete]);
  void handleChange;
  return (
    <View style={styles.labelRow}>
      <View style={[styles.labelDot, { backgroundColor: label.color }]} />
      {editing ? (
        <TextInput
          style={styles.inlineInput}
          initialValue={label.name}
          onChangeText={handleDraft}
          onBlur={commit}
          autoFocus
          testID={`multica-label-rename-${label.id}`}
        />
      ) : (
        <Pressable
          onPress={start}
          style={styles.labelNamePress}
          testID={`multica-label-${label.id}`}
        >
          <Text style={styles.labelName}>{label.name}</Text>
        </Pressable>
      )}
      <View style={styles.inlineRow}>
        {LABEL_PRESETS.map((preset) => (
          <LabelColorChip
            key={preset}
            preset={preset}
            labelId={label.id}
            active={label.color === preset}
            onPick={onUpdate}
          />
        ))}
      </View>
      <Pressable onPress={remove} testID={`multica-label-delete-${label.id}`}>
        <Text style={styles.inlineCancelText}>delete</Text>
      </Pressable>
    </View>
  );
}

function LabelColorChip({
  preset,
  labelId,
  active,
  onPick,
}: {
  preset: string;
  labelId: string;
  active: boolean;
  onPick: (id: string, fields: { color: string }) => void;
}): ReactElement {
  const handlePress = useCallback(
    () => onPick(labelId, { color: preset }),
    [labelId, preset, onPick],
  );
  return (
    <Pressable
      style={[styles.labelDot, { backgroundColor: preset }, active && styles.labelDotActive]}
      onPress={handlePress}
      testID={`multica-label-color-${labelId}-${preset.slice(1)}`}
    />
  );
}

function LabelCreateRow({ onCreate }: { onCreate: (name: string) => void }): ReactElement {
  const [name, setName] = useState("");
  const handleChange = useCallback((text: string) => setName(text), []);
  const submit = useCallback(() => {
    onCreate(name);
    setName("");
  }, [name, onCreate]);
  return (
    <View style={styles.inlineRow}>
      <TextInput
        style={styles.inlineInput}
        initialValue=""
        onChangeText={handleChange}
        placeholder="New label name"
        placeholderTextColor="gray"
        testID="multica-label-create-name"
      />
      <Pressable style={styles.newButton} onPress={submit} testID="multica-label-create">
        <Text style={styles.newButtonText}>Add label</Text>
      </Pressable>
    </View>
  );
}

/** The declarations' door: standing work that fires on its own clock. */
function AutopilotsPill({ serverId }: { serverId: string }): ReactElement {
  const router = useRouter();
  const handlePress = useCallback(() => {
    router.push(`/multica/autopilots?serverId=${serverId}`);
  }, [router, serverId]);
  return (
    <Pressable style={styles.pill} onPress={handlePress} testID="multica-autopilots-entry">
      <Timer size={13} color="#888" />
      <Text style={styles.pillText}>Autopilots</Text>
    </Pressable>
  );
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
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  labelDot: { width: 12, height: 12, borderRadius: 6 },
  labelDotActive: { borderWidth: 2, borderColor: theme.colors.foreground },
  labelNamePress: { minWidth: 120 },
  labelName: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  list: { gap: theme.spacing[2] },
  card: {
    width: 260,
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing[1],
  },
  tagline: { flex: 1, color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
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
  newButton: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  newButtonText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  roleTrigger: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  roleTriggerText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
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
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    marginLeft: "auto",
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: 999,
    backgroundColor: theme.colors.surface2,
  },
  pillText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
}));
