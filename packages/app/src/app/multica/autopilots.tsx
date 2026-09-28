import { MulticaEmptyState } from "@/multica/multica-empty";
import { MulticaShell } from "@/multica/multica-nav";
import { type ReactElement, useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { StyleSheet } from "react-native-unistyles";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Timer } from "lucide-react-native";

import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { useMulticaCatalog } from "@/multica/multica-catalog";
import { formatRelativeTime } from "@/multica/multica-activity";

/**
 * The autopilots' management face: a card grid of the standing declarations
 * (mode, assignee, schedule, last run), the create form, and the door to one
 * autopilot's detail. Information parity with the source's table page
 * without the table's shape — this console speaks cards.
 */
export default function MulticaAutopilotsRoute(): ReactElement {
  const params = useLocalSearchParams<{ serverId: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  return <AutopilotsPage serverId={serverId} />;
}

function AutopilotsPage({ serverId }: { serverId: string }): ReactElement {
  const router = useRouter();
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const online = runtimeSnapshot?.connectionStatus === "online";
  const catalog = useMulticaCatalog(serverId);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<"autopilots" | "wakeups">("autopilots");
  const pickAutopilots = useCallback(() => setTab("autopilots"), []);
  const pickWakeups = useCallback(() => setTab("wakeups"), []);

  const autopilotsQuery = useFetchQuery({
    queryKey: ["multicaAutopilots", serverId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaAutopilotList();
    },
    enabled: online,
    retry: false,
    dataShape: "value",
    staleTimeMs: 3_000,
    refetchInterval: 5_000,
  });

  const openDetail = useCallback(
    (id: string) => {
      router.push(`/multica/autopilot?serverId=${serverId}&autopilotId=${id}`);
    },
    [router, serverId],
  );
  const [createTemplate, setCreateTemplate] = useState<AutopilotTemplateData | null>(null);
  const openCreate = useCallback(() => {
    setCreateTemplate(null);
    setCreating(true);
  }, []);
  const openCreateWithTemplate = useCallback((template: AutopilotTemplateData) => {
    setCreateTemplate(template);
    setCreating(true);
  }, []);
  const closeCreate = useCallback(() => setCreating(false), []);
  const created = useCallback(() => {
    setCreating(false);
    void autopilotsQuery.refetch();
  }, [autopilotsQuery]);

  if (autopilotsQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  // The source's default face hides archived rows: retired declarations
  // leave the grid rather than sitting in it as dead cards.
  const autopilots = (autopilotsQuery.data?.autopilots ?? []).filter(
    (entry) => entry.status !== "archived",
  );

  return (
    <MulticaShell serverId={serverId} active="autopilots">
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.header}>
          <Timer size={18} color="#888" />
          <Text style={styles.heading}>Autopilots</Text>
          <View style={styles.tabs}>
            <TabChip active={tab === "autopilots"} label="Autopilot" onPress={pickAutopilots} />
            <TabChip active={tab === "wakeups"} label="Issue wakeups" onPress={pickWakeups} />
          </View>
          <Text style={styles.headerCount}>{autopilots.length}</Text>
          <Pressable style={styles.newButton} onPress={openCreate} testID="multica-autopilot-new">
            <Text style={styles.newButtonText}>New autopilot</Text>
          </Pressable>
        </View>
        {tab === "wakeups" ? <WakeupsTab serverId={serverId} /> : null}
        {tab === "autopilots" ? (
          <View style={styles.grid}>
            {autopilots.map((autopilot) => (
              <AutopilotCard
                key={autopilot.id}
                autopilot={autopilot}
                assigneeName={catalog.agentNameById.get(autopilot.assigneeId) ?? null}
                onOpen={openDetail}
              />
            ))}
            {autopilots.length === 0 ? (
              <View style={styles.emptyBlock}>
                <MulticaEmptyState
                  iconKey="autopilot"
                  title="No autopilots yet"
                  description="Schedule recurring work for your AI agents. Pick a template or start from scratch."
                  actionLabel={null}
                  onAction={null}
                  testID="multica-autopilots-empty"
                />
                <View style={styles.templateGrid}>
                  {AUTOPILOT_TEMPLATES.map((template) => (
                    <TemplateCard
                      key={template.id}
                      template={template}
                      onPick={openCreateWithTemplate}
                    />
                  ))}
                </View>
                <Pressable
                  style={styles.newButton}
                  onPress={openCreate}
                  testID="multica-autopilot-scratch"
                >
                  <Text style={styles.newButtonText}>+ Start from scratch</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}
        {creating ? (
          <CreateAutopilotForm
            key={createTemplate?.id ?? "scratch"}
            serverId={serverId}
            agents={catalog.agents}
            template={createTemplate}
            onCancel={closeCreate}
            onCreated={created}
          />
        ) : null}
      </ScrollView>
    </MulticaShell>
  );
}

interface AutopilotCardData {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly executionMode: string;
  readonly lastRunAt: string | null;
  readonly triggers: readonly { kind: string; cronExpression: string | null }[];
}

function AutopilotCard({
  autopilot,
  assigneeName,
  onOpen,
}: {
  autopilot: AutopilotCardData;
  assigneeName: string | null;
  onOpen: (id: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onOpen(autopilot.id), [autopilot.id, onOpen]);
  const schedule = autopilot.triggers.find((trigger) => trigger.kind === "schedule");
  return (
    <Pressable
      style={styles.card}
      onPress={handlePress}
      testID={`multica-autopilot-${autopilot.id}`}
    >
      <View style={styles.cardHead}>
        <View style={[styles.dot, autopilot.status === "active" && styles.dotOn]} />
        <Text style={styles.cardTitle} numberOfLines={1}>
          {autopilot.title}
        </Text>
        <Text style={styles.modeTag}>{autopilot.executionMode}</Text>
      </View>
      <Text style={styles.cardMeta}>
        {assigneeName ?? "unassigned"} ·{" "}
        {schedule?.cronExpression ? schedule.cronExpression : "manual"}
      </Text>
      <Text style={styles.cardMeta}>
        {autopilot.lastRunAt ? `last run ${formatRelativeTime(autopilot.lastRunAt)}` : "never run"}
      </Text>
    </Pressable>
  );
}

function AssigneeChoice({
  id,
  name,
  active,
  onPick,
}: {
  id: string;
  name: string;
  active: boolean;
  onPick: (id: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onPick(id), [id, onPick]);
  return (
    <Pressable style={[styles.choice, active && styles.choiceActive]} onPress={handlePress}>
      <Text style={styles.choiceText}>{name}</Text>
    </Pressable>
  );
}

/**
 * The source's template cards: the prompt body rides the description field
 * (it is injected into the agent task verbatim), the schedule preset lands
 * as the cron the dialog would have derived. Titles and summaries are the
 * source's own copy; the prompts are its own text.
 */
interface AutopilotTemplateData {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly prompt: string;
  readonly cron: string;
}

const AUTOPILOT_TEMPLATES: readonly AutopilotTemplateData[] = [
  {
    id: "daily_news",
    title: "Daily news digest",
    summary: "Search and summarize today's news for the team",
    cron: "0 9 * * *",
    prompt: `1. Search the web for news and announcements published today only (strictly today's date)
2. Filter for topics relevant to our team and industry
3. For each item, write a short summary including: title, source, key takeaways
4. Compile everything into a single digest post
5. Post the digest as a comment on this issue and @mention all workspace members`,
  },
  {
    id: "pr_review",
    title: "PR review reminder",
    summary: "Flag stale pull requests that need review",
    cron: "0 10 * * 1-5",
    prompt: `1. List all open pull requests in the repository
2. Identify PRs that have been open for more than 24 hours without a review
3. For each stale PR, note the author, age, and a one-line summary of the change
4. Post a comment on this issue listing all stale PRs with links
5. @mention the team to remind them to review`,
  },
  {
    id: "bug_triage",
    title: "Bug triage",
    summary: "Assess and prioritize new bug reports",
    cron: "0 9 * * 1-5",
    prompt: `1. List all backlog issues that have not been prioritized
2. For each issue, read the description and any attached logs or screenshots
3. Assess severity (critical / high / medium / low) based on user impact and scope
4. Set the priority field on the issue accordingly
5. Add a comment explaining your assessment and suggested next steps`,
  },
  {
    id: "weekly_progress",
    title: "Weekly progress report",
    summary: "Compile a weekly summary of team progress",
    cron: "0 17 * * 1",
    prompt: `1. Gather all issues completed (status "done") in the past 7 days
2. Gather all issues currently in progress
3. Identify any blocked issues and their blockers
4. Calculate key metrics: issues closed, issues opened, net change
5. Write a structured weekly report with sections: Completed, In Progress, Blocked, Metrics
6. Post the report as a comment on this issue`,
  },
  {
    id: "dependency_audit",
    title: "Dependency audit",
    summary: "Scan for security vulnerabilities and outdated packages",
    cron: "0 8 * * 1",
    prompt: `1. Run dependency audit tools on the project (npm audit, go vuln check, etc.)
2. Identify any packages with known security vulnerabilities
3. List outdated packages that are more than 2 major versions behind
4. For each finding, note the severity, affected package, and recommended fix
5. Post a summary report as a comment with actionable items`,
  },
  {
    id: "documentation_check",
    title: "Documentation check",
    summary: "Review recent changes for documentation gaps",
    cron: "0 8 * * 1",
    prompt: `1. List all code changes merged in the past 7 days (via git log)
2. For each significant change, check if related documentation was updated
3. Identify any new APIs, config options, or features missing documentation
4. Create a list of documentation gaps with file paths and suggested content
5. Post the list as a comment on this issue`,
  },
] as const;

function TemplateCard({
  template,
  onPick,
}: {
  template: AutopilotTemplateData;
  onPick: (template: AutopilotTemplateData) => void;
}): ReactElement {
  const handlePress = useCallback(() => onPick(template), [template, onPick]);
  return (
    <Pressable
      style={styles.templateCard}
      onPress={handlePress}
      testID={`multica-ap-template-${template.id}`}
    >
      <Text style={styles.templateTitle}>{template.title}</Text>
      <Text style={styles.templateSummary}>{template.summary}</Text>
    </Pressable>
  );
}

/**
 * The registry the source's second autopilot tab lists: every issue's
 * wakeup subscriptions across the workspace, each row toggleable. A
 * subscription an agent registered for itself shows here too — the registry
 * is the owner's, the registrations are not only the owner's.
 */
function WakeupsTab({ serverId }: { serverId: string }): ReactElement {
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const online = runtimeSnapshot?.connectionStatus === "online";
  const query = useFetchQuery({
    queryKey: ["multicaWakeupsAll", serverId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaWakeupWorkspaceList();
    },
    enabled: online,
    retry: false,
    dataShape: "list",
    staleTimeMs: 3_000,
    refetchInterval: 5_000,
  });
  const toggle = useCallback(
    (wakeup: { id: string; issueId: string; enabled: boolean }) => {
      if (!client) return;
      const call = wakeup.enabled
        ? client.multicaWakeupDisable({ issueId: wakeup.issueId, id: wakeup.id })
        : client.multicaWakeupEnable({ id: wakeup.id });
      void call.then(() => query.refetch()).catch(() => query.refetch());
    },
    [client, query],
  );
  const rows = query.data?.wakeups ?? [];
  return (
    <View style={styles.wakeupList}>
      {rows.map((wakeup) => (
        <WakeupRow key={wakeup.id} wakeup={wakeup} onToggle={toggle} />
      ))}
      {rows.length === 0 ? <Text style={styles.mutedLine}>No wakeups registered yet.</Text> : null}
    </View>
  );
}

function WakeupRow({
  wakeup,
  onToggle,
}: {
  wakeup: {
    id: string;
    issueId: string;
    issueTitle: string | null;
    kind: string;
    enabled: boolean;
    agentId: string;
    instruction: string;
  };
  onToggle: (wakeup: { id: string; issueId: string; enabled: boolean }) => void;
}): ReactElement {
  const handlePress = useCallback(() => onToggle(wakeup), [wakeup, onToggle]);
  return (
    <View style={styles.wakeupRow}>
      <View style={styles.wakeupMain}>
        <Text style={styles.wakeupIssue} numberOfLines={1}>
          {wakeup.issueTitle ?? wakeup.issueId.slice(0, 8)}
        </Text>
        <Text style={styles.wakeupMeta} numberOfLines={1}>
          {wakeup.kind} · {wakeup.instruction.slice(0, 48)}
        </Text>
      </View>
      <Pressable
        style={[styles.wakeupToggle, !wakeup.enabled && styles.wakeupToggleOff]}
        onPress={handlePress}
        testID={`multica-wakeup-toggle-${wakeup.id}`}
      >
        <Text style={styles.wakeupToggleText}>{wakeup.enabled ? "on" : "off"}</Text>
      </Pressable>
    </View>
  );
}

function TabChip({
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
      style={[styles.tabChip, active && styles.tabChipActive]}
      onPress={onPress}
      testID={`multica-ap-tab-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <Text style={[styles.tabChipText, active && styles.tabChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function CreateAutopilotForm({
  serverId,
  agents,
  template,
  onCancel,
  onCreated,
}: {
  serverId: string;
  agents: readonly { id: string; name: string }[];
  template: AutopilotTemplateData | null;
  onCancel: () => void;
  onCreated: () => void;
}): ReactElement {
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const [title, setTitle] = useState(template?.title ?? "");
  const [description, setDescription] = useState(template?.prompt ?? "");
  const [assigneeId, setAssigneeId] = useState<string>(agents[0]?.id ?? "");
  const [mode, setMode] = useState<"create_issue" | "run_only">("run_only");
  const [cron, setCron] = useState(template?.cron ?? "");
  const [saving, setSaving] = useState(false);

  const pickRunOnly = useCallback(() => setMode("run_only"), []);
  const pickCreateIssue = useCallback(() => setMode("create_issue"), []);

  const submit = useCallback(async (): Promise<void> => {
    if (!client || title.trim() === "" || assigneeId === "" || saving) return;
    setSaving(true);
    try {
      await client.multicaAutopilotCreate({
        title: title.trim(),
        assigneeType: "agent",
        assigneeId,
        executionMode: mode,
        ...(description.trim() !== "" ? { description: description.trim() } : {}),
        ...(cron.trim() !== "" ? { cron: cron.trim() } : {}),
      });
      onCreated();
    } finally {
      setSaving(false);
    }
  }, [client, title, description, assigneeId, mode, cron, saving, onCreated]);

  const handleSubmit = useCallback(() => {
    void submit();
  }, [submit]);

  return (
    <View style={styles.form}>
      <Text style={styles.formTitle}>New autopilot</Text>
      <TextInput
        style={styles.input}
        initialValue={title}
        onChangeText={setTitle}
        placeholder="Title"
        placeholderTextColor="gray"
        testID="multica-ap-title"
      />
      <TextInput
        style={styles.input}
        initialValue={description}
        onChangeText={setDescription}
        placeholder="What each run should do"
        placeholderTextColor="gray"
        multiline
        testID="multica-ap-description"
      />
      <View style={styles.formRow}>
        {agents.map((agent) => (
          <AssigneeChoice
            key={agent.id}
            id={agent.id}
            name={agent.name}
            active={assigneeId === agent.id}
            onPick={setAssigneeId}
          />
        ))}
      </View>
      <View style={styles.formRow}>
        <Pressable
          style={[styles.choice, mode === "run_only" && styles.choiceActive]}
          onPress={pickRunOnly}
        >
          <Text style={styles.choiceText}>run only</Text>
        </Pressable>
        <Pressable
          style={[styles.choice, mode === "create_issue" && styles.choiceActive]}
          onPress={pickCreateIssue}
        >
          <Text style={styles.choiceText}>create issue</Text>
        </Pressable>
      </View>
      <TextInput
        style={styles.input}
        initialValue={cron}
        onChangeText={setCron}
        placeholder="cron (optional, e.g. 0 9 * * *)"
        placeholderTextColor="gray"
        testID="multica-ap-cron"
      />
      <View style={styles.formRow}>
        <Pressable style={styles.primaryButton} onPress={handleSubmit} testID="multica-ap-create">
          <Text style={styles.newButtonText}>{saving ? "…" : "Create"}</Text>
        </Pressable>
        <Pressable style={styles.cancelButton} onPress={onCancel} testID="multica-ap-cancel">
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  page: { padding: theme.spacing[4], gap: theme.spacing[3] },
  header: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  heading: { color: theme.colors.foreground, fontSize: theme.fontSize.base, fontWeight: "600" },
  headerCount: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  newButton: {
    marginLeft: "auto",
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  newButtonText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  emptyBlock: { alignItems: "center", gap: theme.spacing[4] },
  templateGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: theme.spacing[3],
    maxWidth: 760,
  },
  templateCard: {
    width: 230,
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    gap: theme.spacing[1],
  },
  templateTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, fontWeight: "600" },
  templateSummary: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[3] },
  card: {
    width: 280,
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing[1],
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#9ca3af" },
  dotOn: { backgroundColor: "#22c55e" },
  cardTitle: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  modeTag: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface2,
    overflow: "hidden",
  },
  cardMeta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  empty: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  tabs: { flexDirection: "row", gap: theme.spacing[1], marginLeft: theme.spacing[2] },
  tabChip: {
    paddingVertical: 2,
    paddingHorizontal: theme.spacing[2],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  tabChipActive: { backgroundColor: theme.colors.surface2 },
  tabChipText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  tabChipTextActive: { fontWeight: "600" },
  wakeupList: { gap: theme.spacing[1], marginTop: theme.spacing[2] },
  wakeupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  wakeupMain: { flex: 1, gap: 2 },
  wakeupIssue: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, fontWeight: "600" },
  wakeupMeta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  wakeupToggle: {
    paddingVertical: 2,
    paddingHorizontal: theme.spacing[3],
    borderRadius: 999,
    backgroundColor: theme.colors.surface3,
  },
  wakeupToggleOff: { backgroundColor: theme.colors.surface2 },
  wakeupToggleText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  mutedLine: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  form: {
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing[2],
    maxWidth: 560,
  },
  formTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  formRow: { flexDirection: "row", gap: theme.spacing[2] },
  choice: {
    paddingVertical: 3,
    paddingHorizontal: theme.spacing[2],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  choiceActive: { backgroundColor: theme.colors.surface2 },
  choiceText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  primaryButton: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  cancelButton: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
  },
  cancelText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
}));
