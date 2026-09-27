import { type ReactElement, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useRouter } from "expo-router";

import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { useIsCompactFormFactor } from "@/constants/layout";
import { ActorAvatar, formatRelativeTime } from "@/multica/multica-activity";
import type {
  MulticaCommentSummary,
  MulticaIssueSummary,
} from "@bytetrue/protocol/multica/rpc-schemas";

/**
 * An issue's page, after the reference product's detail layout: a breadcrumb,
 * the large editable-feeling title, the markdown-rendered description, the
 * comment stream as the issue's record, and a collapsible-feeling properties
 * pane — a right sidebar on wide screens, stacked on compact ones.
 */
export function MulticaIssueDetail({
  serverId,
  issueId,
}: {
  serverId: string;
  issueId: string;
}): ReactElement {
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const online = runtimeSnapshot?.connectionStatus === "online";
  const router = useRouter();
  const isCompact = useIsCompactFormFactor();

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

  const commentsQuery = useFetchQuery({
    queryKey: ["multicaComments", serverId, issueId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaCommentList(issueId);
    },
    enabled: online && issueId !== "",
    retry: false,
    dataShape: "list",
    staleTimeMs: 3_000,
    refetchInterval: 5_000,
  });

  const agentsQuery = useFetchQuery({
    queryKey: ["multicaAgents", serverId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaAgentList();
    },
    enabled: online,
    retry: false,
    dataShape: "list",
    staleTimeMs: 10_000,
  });

  const agentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agentsQuery.data?.agents ?? []) {
      map.set(agent.id, agent.name);
    }
    return map;
  }, [agentsQuery.data]);

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
      await commentsQuery.refetch();
    } finally {
      setSending(false);
    }
  }, [client, commentsQuery, draft, issueId, sending]);

  const issue = issueQuery.data?.issue ?? null;
  const comments = useMemo(() => commentsQuery.data?.comments ?? [], [commentsQuery.data]);

  const moveStatus = useCallback(
    async (status: string): Promise<void> => {
      if (!client || !issue) return;
      try {
        await client.multicaIssueUpdate({
          issueId: issue.id,
          expectedRevision: issue.revision,
          status,
        });
        await issueQuery.refetch();
      } catch {
        await issueQuery.refetch();
      }
    },
    [client, issue, issueQuery],
  );

  if (issueQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const mainPane = (
    <IssueMainPane
      issue={issue}
      comments={comments}
      agentNameById={agentNameById}
      goBack={goBack}
      onDraftChange={setDraft}
      onSend={send}
      sending={sending}
    />
  );
  const propertiesPane = <IssuePropertiesPane issue={issue} moveStatus={moveStatus} />;

  return (
    <View style={styles.page}>
      {isCompact ? (
        <View style={styles.compactStack}>
          {mainPane}
          {propertiesPane}
        </View>
      ) : (
        <View style={styles.wideSplit}>
          <View style={styles.wideMain}>
            <ScrollView contentContainerStyle={styles.wideMainContent}>{mainPane}</ScrollView>
          </View>
          <View style={styles.wideSide}>
            <ScrollView contentContainerStyle={styles.wideSideContent}>{propertiesPane}</ScrollView>
          </View>
        </View>
      )}
    </View>
  );
}

function IssueMainPane({
  issue,
  comments,
  agentNameById,
  goBack,
  onDraftChange,
  onSend,
  sending,
}: {
  issue: MulticaIssueSummary | null;
  comments: readonly MulticaCommentSummary[];
  agentNameById: ReadonlyMap<string, string>;
  goBack: () => void;
  onDraftChange: (text: string) => void;
  onSend: () => void;
  sending: boolean;
}): ReactElement {
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
        {comments.map((comment) => (
          <CommentRow
            key={comment.id}
            comment={comment}
            actorName={agentNameById.get(comment.authorId) ?? null}
          />
        ))}
        {comments.length === 0 ? (
          <Text style={styles.hint}>No comments yet — say something to start.</Text>
        ) : null}
      </View>
      <CommentComposer onDraftChange={onDraftChange} onSend={onSend} sending={sending} />
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

function CommentRow({
  comment,
  actorName,
}: {
  comment: MulticaCommentSummary;
  actorName: string | null;
}): ReactElement {
  const isOwner = comment.authorType === "owner";
  const displayName = isOwner ? "you" : (actorName ?? comment.authorId.slice(0, 8));
  return (
    <View style={styles.comment}>
      <View style={styles.commentHeader}>
        <ActorAvatar name={displayName} id={comment.authorId} />
        <Text style={styles.commentAuthor}>{displayName}</Text>
        <Text style={styles.commentTime}>{formatRelativeTime(comment.createdAt)}</Text>
      </View>
      <View style={styles.commentBody}>
        <MarkdownRenderer text={comment.content} compact />
      </View>
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

function IssuePropertiesPane({
  issue,
  moveStatus,
}: {
  issue: MulticaIssueSummary | null;
  moveStatus: (status: string) => void;
}): ReactElement {
  const status = issue?.status ?? "";
  return (
    <View style={styles.properties}>
      <Text style={styles.propertiesHeading}>Properties</Text>
      <PropertyRow label="Status">
        <View style={styles.statusRow}>
          <View style={styles.statusChip}>
            <View style={[styles.statusChipDot, { backgroundColor: statusColor(status) }]} />
            <Text style={styles.statusChipText}>{status}</Text>
          </View>
          {issue && status !== "done" ? (
            <QuickStatus label="In review" status="in_review" onPress={moveStatus} />
          ) : null}
          {issue && status !== "done" ? (
            <QuickStatus label="Done" status="done" onPress={moveStatus} />
          ) : null}
        </View>
      </PropertyRow>
      <PropertyRow label="Priority">
        <Text style={styles.propertyValue}>{issue?.priority ?? "none"}</Text>
      </PropertyRow>
      <PropertyRow label="Assignee">
        <Text style={styles.propertyValue}>
          {issue?.assigneeId
            ? `${issue.assigneeType}: ${issue.assigneeId.slice(0, 8)}`
            : "unassigned"}
        </Text>
      </PropertyRow>
      <PropertyRow label="Revision">
        <Text style={styles.propertyValue}>{String(issue?.revision ?? "-")}</Text>
      </PropertyRow>
      <PropertyRow label="Updated">
        <Text style={styles.propertyValue}>
          {issue ? formatRelativeTime(issue.updatedAt) : "-"}
        </Text>
      </PropertyRow>
    </View>
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

function QuickStatus({
  label,
  status,
  onPress,
}: {
  label: string;
  status: string;
  onPress: (status: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => {
    void onPress(status);
  }, [onPress, status]);
  return (
    <Pressable style={styles.quickStatus} onPress={handlePress} testID={`multica-quick-${status}`}>
      <Text style={styles.quickStatusText}>{label}</Text>
    </Pressable>
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
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
}));
