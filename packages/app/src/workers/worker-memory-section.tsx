import { type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import type { AggregatedWorker } from "@/workers/aggregated-workers";

/**
 * What one worker has remembered across its tasks.
 *
 * The memory is a file the worker maintains itself, so this reads on demand
 * rather than riding the roster aggregation: a worker can append to it at any
 * moment, and there is no server event for that yet — the next time a person
 * opens the page is the natural refresh point. That is a weaker guarantee than
 * the inbox's live queue, and the right one for a document a person reads.
 *
 * An empty state here is honest, not broken: "has not remembered anything yet"
 * is what a new worker's memory actually looks like, and saying so is more
 * useful than a spinner or a blank card.
 */
export function WorkerMemorySection({ worker }: { worker: AggregatedWorker }): ReactElement {
  const runtimeSnapshot = useHostRuntimeSnapshot(worker.serverId);
  const client = runtimeSnapshot?.client ?? null;
  const connectionStatus = runtimeSnapshot?.connectionStatus ?? "connecting";

  const memoryQuery = useFetchQuery({
    queryKey: ["workerMemory", worker.serverId, worker.id, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) {
        throw new Error("Target host client is unavailable");
      }
      return client.getWorkerMemory(worker.id);
    },
    enabled: connectionStatus === "online",
    retry: false,
    dataShape: "value",
    staleTimeMs: 5_000,
  });

  const memory = memoryQuery.data?.memory ?? null;
  const notes = memoryQuery.data?.notes ?? [];

  return (
    <View style={styles.section} testID="worker-memory-section">
      <Text style={styles.title}>Memory</Text>
      {memory === null && notes.length === 0 ? (
        <Text style={styles.meta}>
          Nothing remembered yet. Facts a worker learns while working appear here and carry into its
          next task.
        </Text>
      ) : (
        <>
          {memory !== null ? (
            <View style={styles.document}>
              <Text style={styles.body}>{memory.trim()}</Text>
            </View>
          ) : null}
          {notes.length > 0 ? (
            <View style={styles.notes}>
              <Text style={styles.meta}>Daily notes</Text>
              {notes.map((note) => (
                <View key={note.day} style={styles.document}>
                  <Text style={styles.day}>{note.day}</Text>
                  <Text style={styles.body}>{note.body.trim()}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: { gap: theme.spacing[2] },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  meta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  notes: { gap: theme.spacing[2] },
  document: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  day: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  body: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
}));
