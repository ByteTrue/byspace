import { type ReactElement, type ReactNode, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useLocalSearchParams, useRouter } from "expo-router";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useMulticaCatalog } from "@/multica/multica-catalog";
import { ActorAvatar, formatRelativeTime } from "@/multica/multica-activity";
import type {
  MulticaIssueSummary,
  MulticaStatusSummary,
  MulticaTaskSummary,
  MulticaTimelineEntry,
} from "@bytetrue/protocol/multica/rpc-schemas";

/**
 * An issue's page, after the reference product's detail layout: a breadcrumb,
 * the large editable-feeling title, the markdown-rendered description, the
 * comment stream as the issue's record, and a collapsible-feeling properties
 * pane — a right sidebar on wide screens, stacked on compact ones.
 */
interface IssueDetailData {
  issue: MulticaIssueSummary | null;
  children: readonly MulticaIssueSummary[];
  entries: readonly MulticaTimelineEntry[];
  tasks: readonly MulticaTaskSummary[];
  subscribers: readonly { userType: string; userId: string; reason: string }[];
  subscribed: boolean;
  toggleSubscription: () => void;
  react: (commentId: string, emoji: string, reacted: boolean) => void;
  refreshChildren: () => void;
  truncated: boolean;
  agentNameById: ReadonlyMap<string, string>;
  statuses: readonly MulticaStatusSummary[];
  assigneeName: string | null;
  assigneeType: string | null;
  draft: string;
  sending: boolean;
  loading: boolean;
  goBack: () => void;
  setDraft: (text: string) => void;
  send: () => void;
  moveStatus: (status: string) => void;
}

function useIssueQueries(
  serverId: string,
  issueId: string,
): {
  issue: MulticaIssueSummary | null;
  entries: readonly MulticaTimelineEntry[];
  tasks: readonly MulticaTaskSummary[];
  children: readonly MulticaIssueSummary[];
  truncated: boolean;
  loading: boolean;
  refreshTimeline: () => Promise<unknown>;
  refreshIssue: () => Promise<unknown>;
} {
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const online = runtimeSnapshot?.connectionStatus === "online";
  const issueQuery = useFetchQuery({
    queryKey: ["multicaIssue", serverId, issueId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaIssueGet(issueId);
    },
    enabled: online && issueId !== "",
    retry: false,
    dataShape: "value",
    staleTimeMs: 3_000,
    refetchInterval: 5_000,
  });
  const timelineQuery = useFetchQuery({
    queryKey: ["multicaTimeline", serverId, issueId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaTimelineList(issueId);
    },
    enabled: online && issueId !== "",
    retry: false,
    dataShape: "value",
    staleTimeMs: 3_000,
    refetchInterval: 5_000,
  });
  const tasksQuery = useFetchQuery({
    queryKey: ["multicaIssueTasks", serverId, issueId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaTaskList({ issueId });
    },
    enabled: online && issueId !== "",
    retry: false,
    dataShape: "value",
    staleTimeMs: 3_000,
    refetchInterval: 5_000,
  });
  const entries = useMemo(() => timelineQuery.data?.entries ?? [], [timelineQuery.data]);
  const tasks = useMemo(() => tasksQuery.data?.tasks ?? [], [tasksQuery.data]);
  const refreshTimeline = useCallback(() => timelineQuery.refetch(), [timelineQuery]);
  const refreshIssue = useCallback(() => issueQuery.refetch(), [issueQuery]);
  return {
    issue: issueQuery.data?.issue ?? null,
    children: issueQuery.data?.children ?? [],
    entries,
    tasks,
    truncated: timelineQuery.data?.truncated ?? false,
    loading: issueQuery.isLoading,
    refreshTimeline,
    refreshIssue,
  };
}

/** The subscription face: who is on the list, and whether the owner is. */
function useSubscribers(
  serverId: string,
  issueId: string,
): {
  subscribers: readonly { userType: string; userId: string; reason: string }[];
  subscribed: boolean;
  toggleSubscription: () => void;
} {
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const online = runtimeSnapshot?.connectionStatus === "online";
  const subscribersQuery = useFetchQuery({
    queryKey: ["multicaSubscribers", serverId, issueId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaSubscriberList(issueId);
    },
    enabled: online && issueId !== "",
    retry: false,
    dataShape: "value",
    staleTimeMs: 5_000,
  });
  const subscribers = useMemo(
    () => subscribersQuery.data?.subscribers ?? [],
    [subscribersQuery.data],
  );
  const subscribed = useMemo(
    () => subscribers.some((entry) => entry.userType === "owner" && entry.userId === "owner"),
    [subscribers],
  );
  const toggleSubscription = useCallback(() => {
    if (!client) return;
    void client
      .multicaSubscriberSet({ issueId, subscribed: !subscribed })
      .then(() => subscribersQuery.refetch());
  }, [client, issueId, subscribed, subscribersQuery]);
  return { subscribers, subscribed, toggleSubscription };
}

function useIssueDetailData(serverId: string, issueId: string): IssueDetailData {
  const router = useRouter();
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;

  const queries = useIssueQueries(serverId, issueId);
  const subscription = useSubscribers(serverId, issueId);
  const { issue, children, entries, tasks, truncated } = queries;
  const { subscribers, subscribed, toggleSubscription } = subscription;

  const catalog = useMulticaCatalog(serverId);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const goBack = useCallback(() => {
    router.push("/multica");
  }, [router]);

  const send = useCallback(async (): Promise<void> => {
    const body = draft.trim();
    if (body === "" || client === null || sending) {
      return;
    }
    setSending(true);
    try {
      await client.multicaCommentCreate({ issueId, content: body });
      setDraft("");
      await queries.refreshTimeline();
    } finally {
      setSending(false);
    }
  }, [client, queries, draft, issueId, sending]);

  const refreshChildren = useCallback(() => {
    void queries.refreshIssue();
  }, [queries]);

  const react = useCallback(
    (commentId: string, emoji: string, reacted: boolean) => {
      if (!client) return;
      void client.multicaReactionSet({ commentId, emoji, reacted }).then(() => {
        void queries.refreshTimeline();
        return undefined;
      });
    },
    [client, queries],
  );

  const moveStatus = useCallback(
    (status: string): void => {
      if (!client || !issue) return;
      client
        .multicaIssueUpdate({
          issueId: issue.id,
          expectedRevision: issue.revision,
          status,
        })
        .catch(() => undefined)
        .finally(() => {
          void queries.refreshIssue();
        });
    },
    [client, issue, queries],
  );

  const assigneeId = issue?.assigneeId ?? null;
  const assigneeName = assigneeId ? (catalog.agentNameById.get(assigneeId) ?? null) : null;

  return {
    issue,
    children,
    entries,
    tasks,
    subscribers,
    subscribed,
    toggleSubscription,
    react,
    refreshChildren,
    truncated,
    agentNameById: catalog.agentNameById,
    statuses: catalog.statuses,
    assigneeName,
    assigneeType: issue?.assigneeType ?? null,
    draft,
    sending,
    loading: queries.loading,
    goBack,
    setDraft,
    send,
    moveStatus,
  };
}

export function MulticaIssueDetail({
  serverId,
  issueId,
}: {
  serverId: string;
  issueId: string;
}): ReactElement {
  const data = useIssueDetailData(serverId, issueId);
  const isCompact = useIsCompactFormFactor();
  if (data.loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  if (isCompact) {
    return (
      <View style={styles.page}>
        <View style={styles.compactStack}>
          <IssueMainPane data={data} />
          <IssuePropertiesPane data={data} />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.page}>
      <View style={styles.wideSplit}>
        <View style={styles.wideMain}>
          <ScrollView contentContainerStyle={styles.wideMainContent}>
            <IssueMainPane data={data} />
          </ScrollView>
        </View>
        <View style={styles.wideSide}>
          <ScrollView contentContainerStyle={styles.wideSideContent}>
            <IssuePropertiesPane data={data} />
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

function IssueMainPane({ data }: { data: IssueDetailData }): ReactElement {
  const { issue, agentNameById, goBack, sending } = data;
  return (
    <View style={styles.mainPane}>
      <Breadcrumb issue={issue} goBack={goBack} />
      <View style={styles.titleRow}>
        {issue ? <StatusDot status={issue.status} /> : null}
        <Text style={styles.title} numberOfLines={2}>
          {issue?.title ?? "…"}
        </Text>
      </View>
      {issue?.description ? (
        <View style={styles.descriptionBlock}>
          <MarkdownRenderer text={issue.description} compact />
        </View>
      ) : null}
      <View style={styles.stream}>
        {data.entries.map((entry) =>
          entry.kind === "comment" ? (
            <CommentRow
              key={entry.id}
              entry={entry}
              actorName={entry.authorId ? (agentNameById.get(entry.authorId) ?? null) : null}
              onReact={data.react}
            />
          ) : (
            <ActivityLine
              key={entry.id}
              entry={entry}
              actorName={entry.actorId ? (agentNameById.get(entry.actorId) ?? null) : null}
            />
          ),
        )}
        {data.entries.length === 0 ? (
          <Text style={styles.hint}>Nothing here yet — say something to start.</Text>
        ) : null}
        {data.truncated ? <Text style={styles.hint}>Earlier history truncated.</Text> : null}
      </View>
      <CommentComposer onDraftChange={data.setDraft} onSend={data.send} sending={sending} />
    </View>
  );
}

function Breadcrumb({
  issue,
  goBack,
}: {
  issue: MulticaIssueSummary | null;
  goBack: () => void;
}): ReactElement {
  return (
    <View style={styles.breadcrumb}>
      <Pressable onPress={goBack} testID="multica-breadcrumb-board">
        <Text style={styles.breadcrumbLink}>Board</Text>
      </Pressable>
      <Text style={styles.breadcrumbSep}> / </Text>
      <Text style={styles.breadcrumbCurrent} numberOfLines={1}>
        {issue ? `#${issue.number ?? "—"}  ${issue.title}` : "…"}
      </Text>
    </View>
  );
}

function StatusDot({ status }: { status: string }): ReactElement {
  return <View style={[styles.statusDot, { backgroundColor: statusColor(status) }]} />;
}

function statusColor(status: string): string {
  switch (status) {
    case "backlog":
      return "#9ca3af";
    case "todo":
      return "#9ca3af";
    case "in_progress":
      return "#f59e0b";
    case "in_review":
      return "#10b981";
    case "done":
      return "#60a5fa";
    case "blocked":
      return "#ef4444";
    default:
      return "#9ca3af";
  }
}

const REACTION_CHOICES = ["👍", "", "", "✅", "❤️", "🤔"] as const;

/**
 * The reaction face: count chips for what exists (mine outlined), and a
 * fixed six-emoji chooser behind a "+". The source's free picker has no
 * product claim in this form factor; a fixed set is the whole surface.
 */
function ReactionBar({
  entry,
  onReact,
}: {
  entry: MulticaTimelineEntry;
  onReact: (commentId: string, emoji: string, reacted: boolean) => void;
}): ReactElement {
  const [choosing, setChoosing] = useState(false);
  const reactions = entry.reactions ?? [];
  const toggleChoosing = useCallback(() => setChoosing((value) => !value), []);
  return (
    <View style={styles.reactionBar}>
      {reactions.map((reaction) => (
        <ReactionChip
          key={reaction.emoji}
          emoji={reaction.emoji}
          count={reaction.count}
          mine={reaction.reactedByViewer}
          onReact={onReact}
          commentId={entry.id}
        />
      ))}
      {choosing
        ? REACTION_CHOICES.map((emoji) => (
            <ReactionChooser key={emoji} emoji={emoji} onReact={onReact} commentId={entry.id} />
          ))
        : null}
      <Pressable
        style={styles.reactionAdd}
        onPress={toggleChoosing}
        testID={`multica-react-add-${entry.id}`}
      >
        <Text style={styles.reactionAddText}>+</Text>
      </Pressable>
    </View>
  );
}

function ReactionChip({
  emoji,
  count,
  mine,
  commentId,
  onReact,
}: {
  emoji: string;
  count: number;
  mine: boolean;
  commentId: string;
  onReact: (commentId: string, emoji: string, reacted: boolean) => void;
}): ReactElement {
  const handlePress = useCallback(() => {
    // Tapping a chip I already own removes it; tapping someone else's adds
    // mine alongside — the unique key is the toggle's whole semantics.
    onReact(commentId, emoji, !mine);
  }, [commentId, emoji, mine, onReact]);
  return (
    <Pressable
      style={[styles.reactionChip, mine && styles.reactionChipMine]}
      onPress={handlePress}
      testID={`multica-react-${commentId}-${emoji}`}
    >
      <Text style={styles.reactionEmoji}>{emoji}</Text>
      <Text style={styles.reactionCount}>{count}</Text>
    </Pressable>
  );
}

function ReactionChooser({
  emoji,
  commentId,
  onReact,
}: {
  emoji: string;
  commentId: string;
  onReact: (commentId: string, emoji: string, reacted: boolean) => void;
}): ReactElement {
  const handlePress = useCallback(() => {
    onReact(commentId, emoji, true);
  }, [commentId, emoji, onReact]);
  return (
    <Pressable
      style={styles.reactionChip}
      onPress={handlePress}
      testID={`multica-react-pick-${commentId}-${emoji}`}
    >
      <Text style={styles.reactionEmoji}>{emoji}</Text>
    </Pressable>
  );
}

function CommentRow({
  entry,
  actorName,
  onReact,
}: {
  entry: MulticaTimelineEntry;
  actorName: string | null;
  onReact: (commentId: string, emoji: string, reacted: boolean) => void;
}): ReactElement {
  const isOwner = entry.authorType === "owner";
  const authorId = entry.authorId ?? "";
  const displayName = isOwner ? "you" : (actorName ?? authorId.slice(0, 8));
  return (
    <View style={styles.comment}>
      <View style={styles.commentHeader}>
        <ActorAvatar name={displayName} id={authorId} />
        <Text style={styles.commentAuthor}>{displayName}</Text>
        <Text style={styles.commentTime}>{formatRelativeTime(entry.createdAt)}</Text>
      </View>
      <View style={styles.commentBody}>
        <MarkdownRenderer text={entry.content ?? ""} compact />
      </View>
      <ReactionBar entry={entry} onReact={onReact} />
    </View>
  );
}

const ACTION_PHRASES: Record<string, string> = {
  created: "created this issue",
  status_changed: "moved it",
  priority_changed: "re-prioritised it",
  assignee_changed: "re-assigned it",
  title_changed: "renamed it",
  description_updated: "edited the description",
  task_completed: "finished a run",
  task_failed: "had a run fail",
};

/**
 * One audit line in the stream: who did what, with from→to when the action
 * carries a change. The record is the point — work and conversation read as
 * one history.
 */
function ActivityLine({
  entry,
  actorName,
}: {
  entry: MulticaTimelineEntry;
  actorName: string | null;
}): ReactElement {
  const isOwner = entry.actorType === "owner";
  const actorId = entry.actorId ?? "";
  const displayName = isOwner ? "you" : (actorName ?? (actorId.slice(0, 8) || "system"));
  const details = entry.details ?? {};
  const from = typeof details.from === "string" ? details.from : null;
  const to = typeof details.to === "string" ? details.to : null;
  const phrase = ACTION_PHRASES[entry.action ?? ""] ?? entry.action ?? "acted";
  return (
    <View style={styles.activity}>
      <View style={styles.activityDot} />
      <Text style={styles.activityText}>
        {displayName} {phrase}
        {from !== null && to !== null ? ` ${from} → ${to}` : ""} ·{" "}
        {formatRelativeTime(entry.createdAt)}
      </Text>
    </View>
  );
}

function CommentComposer({
  onDraftChange,
  onSend,
  sending,
}: {
  onDraftChange: (text: string) => void;
  onSend: () => void;
  sending: boolean;
}): ReactElement {
  return (
    <View style={styles.composer}>
      <TextInput
        style={styles.input}
        initialValue=""
        onChangeText={onDraftChange}
        placeholder="Comment — @mention wakes an agent"
        placeholderTextColor="gray"
        multiline
      />
      <Button onPress={onSend}>{sending ? "…" : "Send"}</Button>
    </View>
  );
}

function IssuePropertiesPane({ data }: { data: IssueDetailData }): ReactElement {
  const { issue, statuses, assigneeName, assigneeType, moveStatus } = data;
  const status = issue?.status ?? "";
  return (
    <View style={styles.properties}>
      <Section title="Properties">
        <PropertyRow label="Status">
          <StatusDropdown status={status} statuses={statuses} onMove={moveStatus} />
        </PropertyRow>
        <PropertyRow label="Priority">
          <Text style={styles.propertyValue}>{issue?.priority ?? "none"}</Text>
        </PropertyRow>
        <PropertyRow label="Assignee">
          {assigneeName && issue?.assigneeId ? (
            <View style={styles.assigneeRow}>
              <ActorAvatar name={assigneeName} id={issue.assigneeId} />
              <Text style={styles.propertyValue}>{assigneeName}</Text>
            </View>
          ) : (
            <Text style={styles.propertyValue}>
              {assigneeType ? `${assigneeType} (unknown)` : "unassigned"}
            </Text>
          )}
        </PropertyRow>
      </Section>
      <Section title="Labels">
        <LabelsPane issueId={data.issue?.id ?? ""} attached={data.issue?.labels ?? []} />
      </Section>
      <PropertiesLowerSections data={data} />
    </View>
  );
}

function PropertiesLowerSections({ data }: { data: IssueDetailData }): ReactElement {
  const issue = data.issue;
  return (
    <>
      <Section title="Sub-issues">
        {data.children.map((child) => (
          <SubIssueRow key={child.id} child={child} />
        ))}
        {data.children.length === 0 ? <Text style={styles.propertyValue}>None.</Text> : null}
        <AddSubIssueRow parentId={data.issue?.id ?? ""} onCreated={data.refreshChildren} />
      </Section>
      <Section title="Execution log">
        {data.tasks.map((task) => (
          <ExecutionRow key={task.id} task={task} agentNameById={data.agentNameById} />
        ))}
        {data.tasks.length === 0 ? <Text style={styles.propertyValue}>No runs.</Text> : null}
      </Section>
      <Section title="Subscribers">
        <Pressable
          style={styles.subscribeButton}
          onPress={data.toggleSubscription}
          testID="multica-subscribe-toggle"
        >
          <Text style={styles.propertyValue}>{data.subscribed ? "Unsubscribe" : "Subscribe"}</Text>
        </Pressable>
        {data.subscribers.map((subscriber) => (
          <SubscriberRow
            key={`${subscriber.userType}:${subscriber.userId}`}
            subscriber={subscriber}
            agentNameById={data.agentNameById}
          />
        ))}
      </Section>
      <Section title="Details">
        <PropertyRow label="Number">
          <Text style={styles.propertyValue}>{issue ? `#${issue.number ?? "-"}` : "-"}</Text>
        </PropertyRow>
        <PropertyRow label="Revision">
          <Text style={styles.propertyValue}>{String(issue?.revision ?? "-")}</Text>
        </PropertyRow>
        <PropertyRow label="Updated">
          <Text style={styles.propertyValue}>
            {issue ? formatRelativeTime(issue.updatedAt) : "-"}
          </Text>
        </PropertyRow>
      </Section>
    </>
  );
}

/**
 * The creation face for the tree: one inline line under the parent's
 * children. A sub-issue starts parked (backlog) like any issue; the parent
 * link is the only extra fact.
 */
/**
 * The label face on one issue: attached labels with a remove control, and
 * the unattached directory to add from. A set write replaces the whole
 * relation, so both controls send the resulting full list.
 */
function LabelsPane({
  issueId,
  attached,
}: {
  issueId: string;
  attached: readonly { id: string; name: string; color: string }[];
}): ReactElement {
  const params = useLocalSearchParams<{ serverId: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const directory = useMulticaLabelsDirectory(serverId);
  const setLabels = useCallback(
    (labelIds: string[]) => {
      if (!client || issueId === "") return;
      void client.multicaIssueLabelsSet({ issueId, labelIds }).catch(() => undefined);
    },
    [client, issueId],
  );
  const attachedIds = useMemo(() => new Set(attached.map((label) => label.id)), [attached]);
  return (
    <>
      {attached.map((label) => (
        <AttachedLabelWithRemove
          key={label.id}
          label={label}
          attached={attached}
          setLabels={setLabels}
        />
      ))}
      {directory
        .filter((label) => !attachedIds.has(label.id))
        .map((label) => (
          <DirectoryLabelWithAdd
            key={label.id}
            label={label}
            attached={attached}
            setLabels={setLabels}
          />
        ))}
      {directory.length === 0 ? <Text style={styles.propertyValue}>No labels yet.</Text> : null}
    </>
  );
}

function AttachedLabelWithRemove({
  label,
  attached,
  setLabels,
}: {
  label: { id: string; name: string; color: string };
  attached: readonly { id: string }[];
  setLabels: (ids: string[]) => void;
}): ReactElement {
  const handleRemove = useCallback(() => {
    setLabels(attached.filter((entry) => entry.id !== label.id).map((entry) => entry.id));
  }, [attached, label.id, setLabels]);
  return <AttachedLabelRow label={label} onRemove={handleRemove} />;
}

function DirectoryLabelWithAdd({
  label,
  attached,
  setLabels,
}: {
  label: { id: string; name: string; color: string };
  attached: readonly { id: string }[];
  setLabels: (ids: string[]) => void;
}): ReactElement {
  const handleAdd = useCallback(() => {
    setLabels([...attached.map((entry) => entry.id), label.id]);
  }, [attached, label.id, setLabels]);
  return <DirectoryLabelRow label={label} onAdd={handleAdd} />;
}

function AttachedLabelRow({
  label,
  onRemove,
}: {
  label: { id: string; name: string; color: string };
  onRemove: () => void;
}): ReactElement {
  return (
    <View style={styles.labelRow}>
      <View style={[styles.labelDot, { backgroundColor: label.color }]} />
      <Text style={styles.propertyValue}>{label.name}</Text>
      <Pressable
        style={styles.labelAction}
        onPress={onRemove}
        testID={`multica-label-remove-${label.id}`}
      >
        <Text style={styles.propertyValue}>×</Text>
      </Pressable>
    </View>
  );
}

function DirectoryLabelRow({
  label,
  onAdd,
}: {
  label: { id: string; name: string; color: string };
  onAdd: () => void;
}): ReactElement {
  return (
    <View style={styles.labelRow}>
      <View style={[styles.labelDot, { backgroundColor: label.color, opacity: 0.4 }]} />
      <Text style={styles.propertyValue}>{label.name}</Text>
      <Pressable
        style={styles.labelAction}
        onPress={onAdd}
        testID={`multica-label-add-${label.id}`}
      >
        <Text style={styles.propertyValue}>+</Text>
      </Pressable>
    </View>
  );
}

function useMulticaLabelsDirectory(
  serverId: string,
): readonly { id: string; name: string; color: string }[] {
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const online = runtimeSnapshot?.connectionStatus === "online";
  const query = useFetchQuery({
    queryKey: ["multicaLabelsDetail", serverId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaLabelList();
    },
    enabled: online,
    retry: false,
    dataShape: "value",
    staleTimeMs: 30_000,
  });
  return useMemo(() => query.data?.labels ?? [], [query.data]);
}

function AddSubIssueRow({
  parentId,
  onCreated,
}: {
  parentId: string;
  onCreated: () => void;
}): ReactElement {
  const params = useLocalSearchParams<{ serverId: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = useCallback(() => {
    const title = draft.trim();
    if (!client || title === "" || parentId === "" || saving) return;
    setSaving(true);
    void client
      .multicaIssueCreate({ title, parentIssueId: parentId })
      .then(() => {
        setDraft("");
        onCreated();
        return undefined;
      })
      .finally(() => setSaving(false));
  }, [client, draft, parentId, saving, onCreated]);
  return (
    <View style={styles.addSubRow}>
      <TextInput
        style={styles.addSubInput}
        initialValue=""
        onChangeText={setDraft}
        placeholder="Add a sub-issue"
        placeholderTextColor="gray"
        testID="multica-add-sub-input"
      />
      <Pressable style={styles.addSubButton} onPress={submit} testID="multica-add-sub-submit">
        <Text style={styles.propertyValue}>{saving ? "…" : "Add"}</Text>
      </Pressable>
    </View>
  );
}

function SubIssueRow({ child }: { child: MulticaIssueSummary }): ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ serverId: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const handlePress = useCallback(() => {
    router.push(`/multica/issue?serverId=${serverId}&issueId=${child.id}`);
  }, [router, serverId, child.id]);
  return (
    <Pressable style={styles.executionRow} onPress={handlePress} testID={`multica-sub-${child.id}`}>
      <View style={[styles.executionDot, { backgroundColor: statusColor(child.status) }]} />
      <Text style={styles.propertyValue} numberOfLines={1}>
        {child.title} #{child.number ?? "-"}
      </Text>
    </Pressable>
  );
}

function SubscriberRow({
  subscriber,
  agentNameById,
}: {
  subscriber: { userType: string; userId: string; reason: string };
  agentNameById: ReadonlyMap<string, string>;
}): ReactElement {
  const name =
    subscriber.userType === "owner"
      ? "you"
      : (agentNameById.get(subscriber.userId) ?? subscriber.userId.slice(0, 8));
  return (
    <Text style={styles.propertyValue}>
      {name} · {subscriber.reason}
    </Text>
  );
}

function ExecutionRow({
  task,
  agentNameById,
}: {
  task: MulticaTaskSummary;
  agentNameById: ReadonlyMap<string, string>;
}): ReactElement {
  const name = agentNameById.get(task.agentId) ?? task.agentId.slice(0, 8);
  return (
    <View style={styles.executionRow}>
      <View style={[styles.executionDot, task.status === "completed" && styles.statusDotDone]} />
      <Text style={styles.propertyValue}>
        {name} · {task.status} · {formatRelativeTime(task.createdAt)}
      </Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  const [open, setOpen] = useState(true);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  return (
    <View style={styles.section}>
      <Pressable onPress={toggle} style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionChevron}>{open ? "▾" : "▸"}</Text>
      </Pressable>
      {open ? children : null}
    </View>
  );
}

function StatusMenuItem({
  name,
  statusKey,
  selected,
  onMove,
}: {
  name: string;
  statusKey: string;
  selected: boolean;
  onMove: (status: string) => void;
}): ReactElement {
  const handleSelect = useCallback(() => onMove(statusKey), [onMove, statusKey]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      <Text style={styles.menuItemText}>{name}</Text>
    </DropdownMenuItem>
  );
}

function StatusDropdown({
  status,
  statuses,
  onMove,
}: {
  status: string;
  statuses: readonly MulticaStatusSummary[];
  onMove: (status: string) => void;
}): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel="Change status"
        testID="multica-status-dropdown"
        style={styles.statusTrigger}
      >
        <View style={[styles.statusChipDot, { backgroundColor: statusColor(status) }]} />
        <Text style={styles.statusChipText}>{status}</Text>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" offset={4} minWidth={160}>
        {statuses.map((entry) => (
          <StatusMenuItem
            key={entry.key}
            name={entry.name}
            statusKey={entry.key}
            selected={entry.key === status}
            onMove={onMove}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PropertyRow({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return (
    <View style={styles.propertyRow}>
      <Text style={styles.propertyLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  page: { flex: 1, backgroundColor: theme.colors.background },
  compactStack: { flex: 1 },
  wideSplit: { flex: 1, flexDirection: "row" },
  wideMain: { flex: 1, borderRightWidth: 1, borderRightColor: theme.colors.border },
  wideSide: { width: 280 },
  wideMainContent: { padding: theme.spacing[4], alignItems: "center" },
  wideSideContent: { padding: theme.spacing[4] },
  mainPane: { width: "100%", maxWidth: 720, gap: theme.spacing[3] },
  breadcrumb: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  breadcrumbLink: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  breadcrumbSep: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  breadcrumbCurrent: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    flex: 1,
  },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[2] },
  statusDot: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: "600",
    flex: 1,
  },
  descriptionBlock: {
    paddingVertical: theme.spacing[2],
  },
  stream: { gap: theme.spacing[2] },
  comment: {
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    gap: theme.spacing[1],
  },
  commentHeader: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  commentAuthor: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, fontWeight: "600" },
  commentTime: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginLeft: "auto",
  },
  commentBody: { paddingLeft: 24 },
  composer: {
    flexDirection: "row",
    gap: theme.spacing[2],
    alignItems: "flex-end",
    paddingTop: theme.spacing[2],
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[2],
    color: theme.colors.foreground,
    minHeight: 72,
  },
  activity: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  activityDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#9ca3af" },
  activityText: { flex: 1, color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  reactionBar: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[1],
    marginTop: theme.spacing[1],
  },
  reactionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingVertical: 1,
    paddingHorizontal: theme.spacing[2],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  reactionChipMine: { borderColor: theme.colors.foreground },
  reactionEmoji: { fontSize: 12 },
  reactionCount: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  reactionAdd: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  reactionAddText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  addSubRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
  },
  addSubInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  addSubButton: {
    paddingVertical: 2,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: 2,
  },
  labelDot: { width: 8, height: 8, borderRadius: 4 },
  labelAction: {
    marginLeft: "auto",
    paddingHorizontal: theme.spacing[1],
  },
  subscribeButton: {
    alignSelf: "flex-start",
    paddingVertical: 2,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing[1],
  },
  executionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: 2,
  },
  executionDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#9ca3af" },
  statusDotDone: { backgroundColor: "#22c55e" },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  properties: { gap: theme.spacing[3] },
  propertiesHeading: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  propertyRow: { gap: theme.spacing[1] },
  propertyLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  propertyValue: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: 2,
    paddingHorizontal: theme.spacing[2],
    borderRadius: 999,
    backgroundColor: theme.colors.surface2,
  },
  statusChipDot: { width: 8, height: 8, borderRadius: 4 },
  statusChipText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  quickStatus: {
    paddingVertical: 2,
    paddingHorizontal: theme.spacing[2],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  quickStatusText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  section: { gap: theme.spacing[2] },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  sectionChevron: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  assigneeRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  statusTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: 2,
    paddingHorizontal: theme.spacing[2],
    borderRadius: 999,
    backgroundColor: theme.colors.surface2,
  },
  menuItemText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
}));
