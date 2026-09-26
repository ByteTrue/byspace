import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { EditingTextInput } from "@/components/ui/text-input";
import { Button } from "@/components/ui/button";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { AggregatedWorker } from "@/workers/aggregated-workers";

/**
 * Hand this worker one unit of work.
 *
 * The reference product's worker page is a conversation surface, and its right
 * pane is headed "New task": the way to give work is the same page you read it
 * on. A task is created and run in one action here, because a form that only
 * queued a task would hand the user a second thing to press, and the thing they
 * wanted — the worker's reply — only comes from running it.
 *
 * Run is long, so the button says so rather than freezing silently: it resolves
 * when the task reaches a terminal outcome, and the list it feeds will show
 * progress the moment the refetch lands.
 */
export function NewWorkerTaskForm({
  worker,
  onCreated,
}: {
  worker: AggregatedWorker;
  onCreated: () => void;
}): ReactElement {
  const [title, setTitle] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = title.trim().length > 0 && !running;

  // The starting prompt is derived from the role the worker actually carries,
  // which is the reference product's rule: a hardcoded hint would tell every
  // role the same story about the work it does. The description is one line, so
  // the placeholder restates it as an invitation rather than quoting it.
  const placeholder = useMemo(() => {
    const line = worker.templateDescription?.split(".")[0]?.trim();
    return line ? `${line} — describe what you need` : "Describe the work";
  }, [worker.templateDescription]);

  const submit = useCallback(async () => {
    const trimmed = title.trim();
    if (trimmed.length === 0 || running) return;

    const client = getHostRuntimeStore().getClient(worker.serverId);
    if (!client) {
      setError("This host is not connected.");
      return;
    }

    setRunning(true);
    setError(null);
    try {
      const created = await client.createWorkerTask({ workerId: worker.id, title: trimmed });
      // One action, one outcome to look at: the run and the creation are the
      // same step from here, and a queued-but-never-run task is a row with
      // nothing behind it.
      await client.runWorkerTask(created.task.taskId);
      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  }, [onCreated, running, title, worker.id, worker.serverId]);

  // Named rather than inline: the perf rules treat a fresh closure per render
  // as a re-render of everything under it.
  const handleSubmit = useCallback(() => {
    void submit();
  }, [submit]);

  return (
    <View style={styles.form} testID="worker-new-task-form">
      <Text style={styles.label}>New task</Text>
      <EditingTextInput
        initialValue={title}
        onChangeText={setTitle}
        placeholder={placeholder}
        style={styles.input}
      />
      {error !== null ? (
        <Text style={styles.error} testID="worker-new-task-error">
          {error}
        </Text>
      ) : null}
      <Button variant="default" disabled={!canSubmit} onPress={handleSubmit}>
        {running ? "Running…" : "Hand over and run"}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: { gap: theme.spacing[2] },
  label: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  input: {
    // Match the field the roster's create form uses, so the two places you type
    // into look like the same product.
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    color: theme.colors.foreground,
  },
  error: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
