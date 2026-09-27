import { type ReactElement, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { StyleSheet } from "react-native-unistyles";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";

/**
 * An issue's page: the conversation is the comment stream, and the composer
 * is how the owner participates — a comment wakes its @mentions and the
 * assignee through the engine.
 */
export default function MulticaIssueRoute(): ReactElement {
  const params = useLocalSearchParams<{ serverId: string; issueId: string }>();
  const router = useRouter();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const issueId = typeof params.issueId === "string" ? params.issueId : "";

  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;

  const issueQuery = useFetchQuery({
    queryKey: ["multicaIssue", serverId, issueId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaIssueGet(issueId);
    },
    enabled: runtimeSnapshot?.connectionStatus === "online" && issueId !== "",
    retry: false,
    dataShape: "value",
    staleTimeMs: 5_000,
  });

  const commentsQuery = useFetchQuery({
    queryKey: ["multicaComments", serverId, issueId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaCommentList(issueId);
    },
    enabled: runtimeSnapshot?.connectionStatus === "online" && issueId !== "",
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

  if (issueQuery.isLoading) {
    return (
      <View style={styles.empty}>
        <ActivityIndicator />
      </View>
    );
  }

  const issue = issueQuery.data?.issue;
  const comments = commentsQuery.data?.comments ?? [];

  return (
    <View style={styles.page}>
      <Button variant="ghost" onPress={goBack}>
        ← Issues
      </Button>
      <IssueHeader issue={issue ?? null} />
      <ScrollView contentContainerStyle={styles.list}>
        {comments.map((comment) => (
          <CommentRow key={comment.id} comment={comment} />
        ))}
        {comments.length === 0 ? (
          <Text style={styles.emptyText}>No comments yet. Say something to start.</Text>
        ) : null}
      </ScrollView>
      <CommentComposer onDraftChange={setDraft} onSend={send} sending={sending} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  page: {
    flex: 1,
    padding: theme.spacing[4],
    gap: theme.spacing[2],
    backgroundColor: theme.colors.background,
  },
  header: { gap: theme.spacing[1] },
  list: { gap: theme.spacing[2] },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.lg, fontWeight: "600" },
  meta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
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
  composer: { flexDirection: "row", gap: theme.spacing[2], alignItems: "flex-end" },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[2],
    color: theme.colors.foreground,
    minHeight: 40,
  },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[4],
  },
}));

function CommentRow({
  comment,
}: {
  comment: {
    id: string;
    authorType: string;
    authorId: string;
    content: string;
  };
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

function IssueHeader({
  issue,
}: {
  issue: { number: number | null; status: string; revision: number; title: string } | null;
}): ReactElement {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>{issue?.title ?? "…"}</Text>
      <Text style={styles.meta}>
        {issue ? `#${issue.number ?? "—"} · ${issue.status} · rev ${issue.revision}` : ""}
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
