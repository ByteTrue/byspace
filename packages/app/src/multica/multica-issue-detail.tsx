import { type ReactElement, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useRouter } from "expo-router";

import type {
  MulticaCommentSummary,
  MulticaIssueSummary,
} from "@bytetrue/protocol/multica/rpc-schemas";

import { Button } from "@/components/ui/button";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { useIsCompactFormFactor } from "@/constants/layout";

/**
 * An issue's page, after the reference product's detail layout: a header with
 * the number and the editable title, the description, the comment stream that
 * is the issue's record, and a properties pane (status / priority / assignee
 * / timestamps) — a right sidebar on wide screens, stacked on compact ones.
 *
 * Status and field edits carry the revision the caller read; a stale write is
 * refused with a read-again error rather than silently overwriting.
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

  const isCompactView = isCompact && issue !== null;

  return (
    <View style={styles.page}>
      {isCompactView ? (
        <View style={styles.compactStack}>
          <IssueMainPane
            issue={issue}
            comments={comments}
            goBack={goBack}
            onDraftChange={setDraft}
            onSend={send}
            sending={sending}
          />
          <IssuePropertiesPane issue={issue} moveStatus={moveStatus} />
        </View>
      ) : (
        <View style={styles.wideSplit}>
          <View style={styles.wideMain}>
            <IssueMainPane
              issue={issue}
              comments={comments}
              goBack={goBack}
              onDraftChange={setDraft}
              onSend={send}
              sending={sending}
            />
          </View>
          <View style={styles.wideSide}>
            <IssuePropertiesPane issue={issue} moveStatus={moveStatus} />
          </View>
        </View>
      )}
    </View>
  );
}

function IssueMainPane({
  issue,
  comments,
  goBack,
  onDraftChange,
  onSend,
  sending,
}: {
  issue: MulticaIssueSummary | null;
  comments: readonly MulticaCommentSummary[];
  goBack: () => void;
  onDraftChange: (text: string) => void;
  onSend: () => void;
  sending: boolean;
}): ReactElement {
  return (
    <ScrollView contentContainerStyle={styles.main}>
      <Button variant="ghost" onPress={goBack}>
        ← Board
      </Button>
      <View style={styles.header}>
        <Text style={styles.number}>#{issue?.number ?? "—"}</Text>
        <Text style={styles.title}>{issue?.title ?? "…"}</Text>
      </View>
      <Text style={styles.description}>{issue?.description ?? "No description."}</Text>
      <View style={styles.stream}>
        {comments.map((comment) => (
          <CommentRow key={comment.id} comment={comment} />
        ))}
        {comments.length === 0 ? (
          <Text style={styles.hint}>No comments yet — say something to start.</Text>
        ) : null}
      </View>
      <CommentComposer onDraftChange={onDraftChange} onSend={onSend} sending={sending} />
    </ScrollView>
  );
}

function IssuePropertiesPane({
  issue,
  moveStatus,
}: {
  issue: MulticaIssueSummary | null;
  moveStatus: (status: string) => void;
}): ReactElement {
  return (
    <ScrollView contentContainerStyle={styles.properties}>
      <Text style={styles.propertiesHeading}>Properties</Text>
      <PropertyRow label="Status">
        <View style={styles.statusRow}>
          <StatusChip status={issue?.status ?? ""} />
          {issue && issue.status !== "done" ? (
            <QuickStatus label="In review" status="in_review" onPress={moveStatus} />
          ) : null}
          {issue && issue.status !== "done" ? (
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
        <Text style={styles.propertyValue}>{issue?.revision ?? "—"}</Text>
      </PropertyRow>
      <PropertyRow label="Created">
        <Text style={styles.propertyValue}>{issue?.createdAt.slice(0, 10) ?? "—"}</Text>
      </PropertyRow>
      <PropertyRow label="Updated">
        <Text style={styles.propertyValue}>{issue?.updatedAt.slice(0, 10) ?? "—"}</Text>
      </PropertyRow>
      <Text style={styles.propertiesRuns}>Runs</Text>
      <Text style={styles.hint}>Run history lands with the engine slice&apos;s task surface.</Text>
    </ScrollView>
  );
}

function StatusChip({ status }: { status: string }): ReactElement {
  return (
    <View style={styles.statusChip}>
      <Text style={styles.statusChipText}>{status}</Text>
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

function PropertyRow({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return (
    <View style={styles.propertyRow}>
      <Text style={styles.propertyLabel}>{label}</Text>
      {children}
    </View>
  );
}

function CommentRow({
  comment,
}: {
  comment: { id: string; authorType: string; authorId: string; content: string };
}): ReactElement {
  return (
    <View style={comment.authorType === "owner" ? styles.commentOwn : styles.comment}>
      <Text style={styles.commentAuthor}>
        {comment.authorType === "owner" ? "you" : comment.authorId.slice(0, 8)}
      </Text>
      <Text style={styles.commentBody}>{comment.content}</Text>
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

const styles = StyleSheet.create((theme) => ({
  page: { flex: 1, backgroundColor: theme.colors.background },
  compactStack: { flex: 1 },
  wideSplit: { flex: 1, flexDirection: "row" },
  wideMain: { flex: 1, borderRightWidth: 1, borderRightColor: theme.colors.border },
  wideSide: { width: 280 },
  main: { padding: theme.spacing[4], gap: theme.spacing[2] },
  header: { flexDirection: "row", alignItems: "baseline", gap: theme.spacing[2] },
  number: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: "600",
    flex: 1,
  },
  description: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    paddingBottom: theme.spacing[2],
  },
  stream: { gap: theme.spacing[2] },
  comment: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    gap: theme.spacing[1],
  },
  commentOwn: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    gap: theme.spacing[1],
  },
  commentAuthor: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  commentBody: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
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
    minHeight: 40,
  },
  properties: { padding: theme.spacing[4], gap: theme.spacing[3] },
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
    paddingVertical: 2,
    paddingHorizontal: theme.spacing[2],
    borderRadius: 999,
    backgroundColor: theme.colors.surface2,
  },
  statusChipText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  quickStatus: {
    paddingVertical: 2,
    paddingHorizontal: theme.spacing[2],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  quickStatusText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  propertiesRuns: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    marginTop: theme.spacing[4],
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
}));
