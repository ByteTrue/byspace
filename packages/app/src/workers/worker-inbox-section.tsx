import { useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import type { AggregatedWorker } from "@/workers/aggregated-workers";

/**
 * What the group has asked of one worker, and whether it has been picked up.
 *
 * An inbox is a live queue rather than history: the wake loop consumes an
 * unread delivery within seconds of it landing, so a count frozen into a roster
 * load would report work that has since been taken. This reads on demand, while
 * the page is in front of the reader, and keeps refreshing while anything is
 * still queued.
 *
 * What a person can act on here is narrow and worth stating precisely. An
 * unread entry is the daemon's to deliver, not theirs. An entry that stays
 * unread while nothing runs — after a wake failed — is the actionable case: the
 * group is waiting on a worker the system could not wake. That distinction is
 * drawn by the state, and `claimed` says a run has the work.
 */
export function WorkerInboxSection({ worker }: { worker: AggregatedWorker }): ReactElement {
  const runtimeSnapshot = useHostRuntimeSnapshot(worker.serverId);
  const client = runtimeSnapshot?.client ?? null;
  const connectionStatus = runtimeSnapshot?.connectionStatus ?? "connecting";

  const inboxQuery = useFetchQuery({
    queryKey: ["workerInbox", worker.serverId, worker.id, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) {
        throw new Error("Target host client is unavailable");
      }
      // No viewer session: the console is the operator view, which reads
      // everything.
      return client.listWorkerInbox({ workerId: worker.id });
    },
    enabled: connectionStatus === "online",
    retry: false,
    // A value rather than a list: this is one worker's queue read whole, and
    // keepPreviousData would hold a drained queue on screen while it refetched.
    dataShape: "value",
    staleTimeMs: 0,
  });

  // Derived in one memo from the source of truth, because two separate filters
  // over a query result re-created each render is what the dependency lint
  // exists to catch.
  const unread = useMemo(
    () => (inboxQuery.data?.entries ?? []).filter((entry) => entry.state === "unread"),
    [inboxQuery.data],
  );
  const claimed = useMemo(
    () => (inboxQuery.data?.entries ?? []).filter((entry) => entry.state === "claimed"),
    [inboxQuery.data],
  );

  // The worker is in hand when this section is open — it is opened from the
  // roster entry — so its own name is known. Anyone else falls back to the id,
  // which is a fact rather than a guess.
  const nameById = useMemo(() => new Map([[worker.id, worker.name]]), [worker.id, worker.name]);

  return (
    <View style={styles.section} testID="worker-inbox-section">
      <Text style={styles.title}>Inbox</Text>
      {unread.length + claimed.length === 0 ? (
        <Text style={styles.meta}>
          Nothing is waiting for this worker. Messages the group addresses to it appear here.
        </Text>
      ) : (
        <>
          {claimed.length > 0 ? (
            <Text style={styles.meta} testID="worker-inbox-claimed">
              {`${claimed.length} in progress — a run has this work`}
            </Text>
          ) : null}
          {[...claimed, ...unread].map((entry) => (
            <View key={entry.message.messageId} style={styles.row}>
              <Text style={styles.rowTitle}>
                {nameById.get(entry.message.senderWorkerId) ?? entry.message.senderWorkerId}
              </Text>
              <Text style={styles.rowBody}>{entry.message.body}</Text>
              <Text style={styles.meta} testID={`worker-inbox-state-${entry.message.messageId}`}>
                {entry.state === "claimed" ? "claimed by a run" : "waiting for a wake"}
              </Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: { gap: theme.spacing[2] },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  meta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  row: {
    gap: 2,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  rowTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  rowBody: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
}));
