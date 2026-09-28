import { type ReactElement, type ReactNode, useCallback, useMemo, useRef, useState } from "react";
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
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useMulticaCatalog } from "@/multica/multica-catalog";
import { ActorAvatar, formatRelativeTime } from "@/multica/multica-activity";
import {
  type MentionCandidate,
  applyMentionChoice,
  mentionMenuState,
} from "@/multica/multica-mention-menu";
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
  revise: (commentId: string, content: string | null) => void;
  mentionAgents: readonly { id: string; name: string }[];
  mentionSquads: readonly { id: string; name: string }[];
  refreshChildren: () => void;
  truncated: boolean;
  agentNameById: ReadonlyMap<string, string>;
  statuses: readonly MulticaStatusSummary[];
  assigneeName: string | null;
  assigneeType: string | null;
  sending: boolean;
  loading: boolean;
  goBack: () => void;
  send: (body: string) => void;
  moveStatus: (status: string) => void;
  updateField: (fields: {
    status?: string;
    priority?: string;
    title?: string;
    description?: string;
    assigneeType?: string | null;
    assigneeId?: string | null;
  }) => void;
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
function useMentionRoster(serverId: string): {
  agents: readonly { id: string; name: string }[];
  squads: readonly { id: string; name: string }[];
} {
  const catalog = useMulticaCatalog(serverId);
  return { agents: catalog.allAgents, squads: catalog.squads };
}

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
  const mentionRoster = useMentionRoster(serverId);

  const [sending, setSending] = useState(false);

  const goBack = useCallback(() => {
    router.push("/multica");
  }, [router]);

  const send = useCallback(
    async (body: string): Promise<void> => {
      const trimmed = body.trim();
      if (trimmed === "" || client === null || sending) {
        return;
      }
      setSending(true);
      try {
        await client.multicaCommentCreate({ issueId, content: trimmed });
        await queries.refreshTimeline();
      } finally {
        setSending(false);
      }
    },
    [client, queries, sending, issueId],
  );

  const refreshChildren = useCallback(() => {
    void queries.refreshIssue();
  }, [queries]);

  const revise = useCallback(
    (commentId: string, content: string | null) => {
      if (!client) return;
      const call =
        content === null
          ? client.multicaCommentDelete({ commentId })
          : client.multicaCommentUpdate({ commentId, content });
      void call.then(() => queries.refreshTimeline()).catch(() => queries.refreshTimeline());
    },
    [client, queries],
  );

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

  const updateField = useCallback(
    (fields: {
      status?: string;
      priority?: string;
      title?: string;
      description?: string;
      assigneeType?: string | null;
      assigneeId?: string | null;
    }): void => {
      const current = queries.issue;
      if (!client || !current) return;
      // Writes serialize through a fresh read: the cache's revision can lag
      // a just-landed write, and a stale revision is a silent drop under
      // optimistic concurrency — the user's click would vanish without a
      // word. Read, write, and on conflict read again and retry once.
      const attempt = (revision: number): Promise<unknown> =>
        client
          .multicaIssueUpdate({ issueId: current.id, expectedRevision: revision, ...fields })
          .catch(async (error: unknown) => {
            const conflicted =
              error instanceof Error && /changed since revision/.test(error.message);
            if (!conflicted) return undefined;
            const fresh = await client.multicaIssueGet(current.id);
            return client.multicaIssueUpdate({
              issueId: current.id,
              expectedRevision: fresh.issue.revision,
              ...fields,
            });
          });
      void attempt(current.revision).finally(() => {
        void queries.refreshIssue();
      });
    },
    [client, queries],
  );

  const moveStatus = useCallback(
    (status: string): void => {
      updateField({ status });
    },
    [updateField],
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
    revise,
    refreshChildren,
    truncated,
    agentNameById: catalog.agentNameById,
    statuses: catalog.statuses,
    assigneeName,
    assigneeType: issue?.assigneeType ?? null,
    sending,
    loading: queries.loading,
    goBack,
    send,
    mentionAgents: mentionRoster.agents,
    mentionSquads: mentionRoster.squads,
    moveStatus,
    updateField,
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
  const commitTitle = useCallback((title: string) => data.updateField({ title }), [data]);
  const commitDescription = useCallback(
    (description: string) => data.updateField({ description }),
    [data],
  );
  const mentionRosterProp = useMemo(
    () => ({ agents: data.mentionAgents, squads: data.mentionSquads }),
    [data.mentionAgents, data.mentionSquads],
  );
  const { issue, agentNameById, goBack, sending } = data;
  return (
    <View style={styles.mainPane}>
      <Breadcrumb issue={issue} goBack={goBack} />
      <View style={styles.titleRow}>
        {issue ? <StatusDot status={issue.status} /> : null}
        <InlineTextEditor
          value={issue?.title ?? ""}
          placeholder="Untitled"
          textStyle={styles.title}
          multiline={false}
          markdown={false}
          onCommit={commitTitle}
          testID="multica-title-edit"
        />
      </View>
      <InlineTextEditor
        value={issue?.description ?? ""}
        placeholder="Add a description"
        textStyle={styles.descriptionText}
        multiline
        markdown
        onCommit={commitDescription}
        testID="multica-description-edit"
      />
      <View style={styles.stream}>
        {data.entries.map((entry) =>
          entry.kind === "comment" ? (
            <CommentRow
              key={entry.id}
              entry={entry}
              actorName={entry.authorId ? (agentNameById.get(entry.authorId) ?? null) : null}
              onReact={data.react}
              onRevise={data.revise}
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
      <CommentComposer onSend={data.send} sending={sending} roster={mentionRosterProp} />
    </View>
  );
}

/**
 * Click-to-edit text, after the source's inline title/description editors:
 * the resting face is the rendered value (markdown for the description),
 * pressing it opens the input with the current value, and leaving commits
 * when the text actually changed. Remounting per edit keeps the
 * uncontrolled input honest — no stale DOM text survives a commit.
 */
function InlineTextEditor({
  value,
  placeholder,
  textStyle,
  multiline,
  markdown,
  onCommit,
  testID,
}: {
  value: string;
  placeholder: string;
  textStyle: unknown;
  multiline: boolean;
  /** Resting face renders markdown (the description); plain text otherwise. */
  markdown: boolean;
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
    <Pressable onPress={start} style={styles.inlineEditorRest} testID={testID}>
      <EditorRestingFace
        value={value}
        placeholder={placeholder}
        markdown={markdown}
        textStyle={textStyle}
      />
    </Pressable>
  );
}

function EditorRestingFace({
  value,
  placeholder,
  markdown,
  textStyle,
}: {
  value: string;
  placeholder: string;
  markdown: boolean;
  textStyle: unknown;
}): ReactElement {
  if (value === "") {
    return <Text style={[textStyle as never, styles.placeholderText]}>{placeholder}</Text>;
  }
  if (markdown) {
    return (
      <View style={styles.descriptionBlock}>
        <MarkdownRenderer text={value} compact />
      </View>
    );
  }
  return <Text style={textStyle as never}>{value}</Text>;
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
  onRevise,
}: {
  entry: MulticaTimelineEntry;
  actorName: string | null;
  onReact: (commentId: string, emoji: string, reacted: boolean) => void;
  onRevise: (commentId: string, content: string | null) => void;
}): ReactElement {
  const isOwner = entry.authorType === "owner";
  const authorId = entry.authorId ?? "";
  const displayName = isOwner ? "you" : (actorName ?? authorId.slice(0, 8));
  if (entry.deletedAt) {
    // A tombstone keeps the thread's shape: the replies still hang here,
    // the words are gone and say so.
    return (
      <View style={styles.comment}>
        <Text style={styles.tombstone}>
          comment deleted · {formatRelativeTime(entry.deletedAt)}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.comment}>
      <View style={styles.commentHeader}>
        <ActorAvatar name={displayName} id={authorId} />
        <Text style={styles.commentAuthor}>{displayName}</Text>
        <Text style={styles.commentTime}>{formatRelativeTime(entry.createdAt)}</Text>
        {isOwner ? (
          <CommentControls commentId={entry.id} content={entry.content ?? ""} onRevise={onRevise} />
        ) : null}
      </View>
      <View style={styles.commentBody}>
        <MarkdownRenderer text={entry.content ?? ""} compact />
      </View>
      <ReactionBar entry={entry} onReact={onReact} />
    </View>
  );
}

/**
 * The owner's controls over their own comments: inline edit (same
 * click-to-edit shape as the title) and delete. A run's comments are not
 * revisable from the console — the author guard on the daemon refuses
 * anyway; the face simply does not offer what the mechanism denies.
 */
function CommentControls({
  commentId,
  content,
  onRevise,
}: {
  commentId: string;
  content: string;
  onRevise: (commentId: string, content: string | null) => void;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const startEdit = useCallback(() => {
    setDraft(content);
    setEditing(true);
  }, [content]);
  const handleChange = useCallback((text: string) => setDraft(text), []);
  const commitEdit = useCallback(() => {
    setEditing(false);
    const next = draft.trim();
    if (next !== "" && next !== content) {
      onRevise(commentId, next);
    }
  }, [draft, content, commentId, onRevise]);
  const remove = useCallback(() => onRevise(commentId, null), [commentId, onRevise]);
  if (editing) {
    return (
      <TextInput
        style={styles.commentEditInput}
        initialValue={content}
        onChangeText={handleChange}
        onBlur={commitEdit}
        multiline
        autoFocus
        testID={`multica-comment-edit-input-${commentId}`}
      />
    );
  }
  return (
    <View style={styles.commentControls}>
      <Pressable onPress={startEdit} testID={`multica-comment-edit-${commentId}`}>
        <Text style={styles.commentControlText}>edit</Text>
      </Pressable>
      <Pressable onPress={remove} testID={`multica-comment-delete-${commentId}`}>
        <Text style={styles.commentControlText}>delete</Text>
      </Pressable>
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

/**
 * The composer owns its draft so the mention menu can rewrite its tail:
 * an open @ at the end lists the nameable roster (agents, internal
 * included, plus squads), and choosing one replaces the fragment with the
 * source's markup. The menu is click-driven; keyboard navigation waits on a
 * cursor read face the text input does not have yet.
 */
function CommentComposer({
  onSend,
  sending,
  roster,
}: {
  onSend: (draft: string) => void;
  sending: boolean;
  roster: {
    agents: readonly { id: string; name: string }[];
    squads: readonly { id: string; name: string }[];
  };
}): ReactElement {
  const inputRef = useRef<EditingTextInputHandle>(null);
  const [draft, setDraft] = useState("");
  const menu = useMemo(
    () =>
      mentionMenuState(draft, {
        agents: roster.agents.map((agent) => ({ ...agent, kind: "agent" as const })),
        squads: roster.squads.map((squad) => ({ ...squad, kind: "squad" as const })),
      }),
    [draft, roster],
  );
  const handleDraft = useCallback((text: string) => setDraft(text), []);
  const handleSend = useCallback(() => {
    onSend(draft);
    setDraft("");
    // The input is uncontrolled: clearing state alone leaves the typed text
    // in the DOM; reset() is the component's own clear.
    inputRef.current?.reset();
  }, [draft, onSend]);
  const choose = useCallback((candidate: MentionCandidate) => {
    setDraft((current) => {
      const next = applyMentionChoice(current, candidate);
      // The input is uncontrolled: state alone would leave the visible text
      // at the old fragment, so the rewrite goes through the handle's write
      // face as well.
      inputRef.current?.replaceText(next);
      return next;
    });
  }, []);
  return (
    <View style={styles.composer}>
      {menu && menu.candidates.length > 0 ? (
        <View style={styles.mentionMenu}>
          {menu.candidates.map((candidate) => (
            <MentionRow
              key={`${candidate.kind}:${candidate.id}`}
              candidate={candidate}
              onChoose={choose}
            />
          ))}
        </View>
      ) : null}
      <TextInput
        ref={inputRef}
        style={styles.input}
        initialValue=""
        onChangeText={handleDraft}
        placeholder="Comment — @ opens the mention menu"
        placeholderTextColor="gray"
        multiline
        testID="multica-composer"
      />
      <Button onPress={handleSend}>{sending ? "…" : "Send"}</Button>
    </View>
  );
}

function MentionRow({
  candidate,
  onChoose,
}: {
  candidate: MentionCandidate;
  onChoose: (candidate: MentionCandidate) => void;
}): ReactElement {
  const handlePress = useCallback(() => onChoose(candidate), [candidate, onChoose]);
  return (
    <Pressable
      style={styles.mentionRow}
      onPress={handlePress}
      testID={`multica-mention-${candidate.kind}-${candidate.id}`}
    >
      <Text style={styles.mentionName}>{candidate.name}</Text>
      <Text style={styles.mentionKind}>{candidate.kind}</Text>
    </Pressable>
  );
}

function IssuePropertiesPane({ data }: { data: IssueDetailData }): ReactElement {
  const { issue, statuses, assigneeName, moveStatus } = data;
  const pickPriority = useCallback((priority: string) => data.updateField({ priority }), [data]);
  const pickAssignee = useCallback(
    (assigneeId: string) => data.updateField({ assigneeType: "agent", assigneeId }),
    [data],
  );
  const clearAssignee = useCallback(
    () => data.updateField({ assigneeType: null, assigneeId: null }),
    [data],
  );
  const status = issue?.status ?? "";
  return (
    <View style={styles.properties}>
      <Section title="Properties">
        <PropertyRow label="Status">
          <StatusDropdown status={status} statuses={statuses} onMove={moveStatus} />
        </PropertyRow>
        <PropertyRow label="Priority">
          <PriorityPick value={issue?.priority ?? "none"} onPick={pickPriority} />
        </PropertyRow>
        <PropertyRow label="Assignee">
          <AssigneePick
            agents={data.mentionAgents}
            assigneeId={issue?.assigneeId ?? null}
            assigneeName={assigneeName}
            onPick={pickAssignee}
            onClear={clearAssignee}
          />
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

const DETAIL_PRIORITY_OPTIONS = ["urgent", "high", "medium", "low", "none"] as const;

function PriorityPick({
  value,
  onPick,
}: {
  value: string;
  onPick: (priority: string) => void;
}): ReactElement {
  return (
    <View style={styles.pickRow}>
      {DETAIL_PRIORITY_OPTIONS.map((option) => (
        <PriorityChip key={option} option={option} active={value === option} onPick={onPick} />
      ))}
    </View>
  );
}

function PriorityChip({
  option,
  active,
  onPick,
}: {
  option: string;
  active: boolean;
  onPick: (priority: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onPick(option), [option, onPick]);
  return (
    <Pressable
      style={[styles.pickChip, active && styles.pickChipActive]}
      onPress={handlePress}
      testID={`multica-priority-${option}`}
    >
      <Text style={styles.pickChipText}>{option}</Text>
    </Pressable>
  );
}

function AssigneePick({
  agents,
  assigneeId,
  assigneeName,
  onPick,
  onClear,
}: {
  agents: readonly { id: string; name: string }[];
  assigneeId: string | null;
  assigneeName: string | null;
  onPick: (id: string) => void;
  onClear: () => void;
}): ReactElement {
  return (
    <View style={styles.pickRow}>
      <Pressable
        style={[styles.pickChip, assigneeId === null && styles.pickChipActive]}
        onPress={onClear}
        testID="multica-assignee-none"
      >
        <Text style={styles.pickChipText}>unassigned</Text>
      </Pressable>
      {agents.map((agent) => (
        <AssigneeChip
          key={agent.id}
          agent={agent}
          active={assigneeId === agent.id}
          currentName={assigneeName}
          onPick={onPick}
        />
      ))}
    </View>
  );
}

function AssigneeChip({
  agent,
  active,
  currentName,
  onPick,
}: {
  agent: { id: string; name: string };
  active: boolean;
  currentName: string | null;
  onPick: (id: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onPick(agent.id), [agent.id, onPick]);
  void currentName;
  return (
    <Pressable
      style={[styles.pickChip, active && styles.pickChipActive]}
      onPress={handlePress}
      testID={`multica-assignee-${agent.id}`}
    >
      <Text style={styles.pickChipText}>{agent.name}</Text>
    </Pressable>
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
  inlineEditorRest: { flex: 1 },
  inlineEditor: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  inlineEditorMulti: { minHeight: 72 },
  placeholderText: { color: theme.colors.foregroundMuted },
  descriptionText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  pickRow: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  pickChip: {
    paddingVertical: 1,
    paddingHorizontal: theme.spacing[2],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  pickChipActive: { backgroundColor: theme.colors.surface2 },
  pickChipText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  mentionMenu: {
    position: "absolute",
    bottom: "100%",
    left: 0,
    right: 0,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    overflow: "hidden",
  },
  mentionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
  },
  mentionName: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  mentionKind: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
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
  tombstone: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontStyle: "italic",
  },
  commentControls: { flexDirection: "row", gap: theme.spacing[2], marginLeft: "auto" },
  commentControlText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  commentEditInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    minHeight: 48,
  },
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
