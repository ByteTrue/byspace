import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useIsFocused } from "@react-navigation/native";
import { Plus, Users } from "lucide-react-native";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form-field";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { useWorkers } from "@/hooks/use-workers";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { AggregatedWorker, WorkerTemplateOption } from "@/workers/aggregated-workers";

/**
 * The worker domain's first screen: the roster and the roles it can be filled
 * from.
 *
 * Deliberately read-and-create only. Tasks, groups and coordination are later
 * slices, and showing empty affordances for them here would promise what the
 * domain cannot yet do.
 *
 * The whole screen is one scroll view rather than a fixed list plus a sheet:
 * the roster is expected to be small (a person, not a company), and a sheet
 * would add a layer of chrome before there is enough content to need one.
 */
export function WorkersScreen(): ReactElement {
  const isFocused = useIsFocused();
  if (!isFocused) {
    return <View style={styles.container} />;
  }
  return <WorkersScreenContent />;
}

const EMPTY_WORKERS: AggregatedWorker[] = [];
const EMPTY_TEMPLATES: WorkerTemplateOption[] = [];

function WorkersScreenContent(): ReactElement {
  const { loadState, hostErrors, refetch, isRefetching } = useWorkers();
  const [isCreating, setIsCreating] = useState(false);

  // Stable empties: a fresh `[]` on each render would make every downstream
  // memo recompute and would be reported as an unstable dependency.
  const workers = loadState.status === "loaded" ? loadState.workers : EMPTY_WORKERS;
  const templates = loadState.status === "loaded" ? loadState.templates : EMPTY_TEMPLATES;

  const openCreate = useCallback(() => setIsCreating(true), []);
  const closeCreate = useCallback(() => setIsCreating(false), []);
  const handleCreated = useCallback(() => {
    setIsCreating(false);
    refetch();
  }, [refetch]);

  // Memoized because the header takes it as a prop and a fresh element on every
  // render would defeat its memoization.
  const headerAction = useMemo(
    () =>
      loadState.status === "loaded" && !isCreating ? (
        <WorkersNewButton onPress={openCreate} />
      ) : null,
    [loadState.status, isCreating, openCreate],
  );

  const workerRows = useMemo(
    () =>
      workers.map((worker) => (
        <WorkerRow key={`${worker.serverId}:${worker.id}`} worker={worker} />
      )),
    [workers],
  );

  return (
    <View style={styles.container}>
      <MenuHeader title="Workers" rightContent={headerAction} />
      <WorkersScreenBody
        loadState={loadState}
        hostErrors={hostErrors}
        isCreating={isCreating}
        isRefetching={isRefetching}
        templates={templates}
        workerRows={workerRows}
        hasWorkers={workers.length > 0}
        onCreate={openCreate}
        onCancel={closeCreate}
        onCreated={handleCreated}
      />
    </View>
  );
}

function WorkersNewButton({ onPress }: { onPress: () => void }): ReactElement {
  // A component rather than inline JSX at the call site: the header is
  // memoized, and a fresh element on each render would recompute it.
  return (
    <Button variant="secondary" onPress={onPress} testID="workers-new" leftIcon={Plus}>
      New worker
    </Button>
  );
}

function WorkersScreenBody({
  loadState,
  hostErrors,
  isCreating,
  isRefetching,
  templates,
  workerRows,
  hasWorkers,
  onCreate,
  onCancel,
  onCreated,
}: {
  loadState: ReturnType<typeof useWorkers>["loadState"];
  hostErrors: ReturnType<typeof useWorkers>["hostErrors"];
  isCreating: boolean;
  isRefetching: boolean;
  templates: WorkerTemplateOption[];
  workerRows: ReactElement[];
  hasWorkers: boolean;
  onCreate: () => void;
  onCancel: () => void;
  onCreated: () => void;
}): ReactElement {
  // Hooks run before every early return; a hook after a conditional return
  // changes call order between renders.
  const createCard = useMemo(
    () =>
      isCreating ? (
        <CreateWorkerCard templates={templates} onCancel={onCancel} onCreated={onCreated} />
      ) : null,
    [isCreating, templates, onCancel, onCreated],
  );
  const emptyRoster = useMemo(() => <EmptyRoster onCreate={onCreate} />, [onCreate]);

  // `connecting` is a transient state, not an instruction. Showing "connect a
  // host" while a host is mid-handshake reads as a task for the user when there
  // is nothing for them to do, and it is what a reconnect would flash.
  if (loadState.status === "connecting" || loadState.status === "loading") {
    return (
      <View style={styles.centered}>
        <LoadingSpinner size="large" color={styles.spinnerColor.color} />
      </View>
    );
  }

  const roster = hasWorkers ? workerRows : emptyRoster;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <HostErrors errors={hostErrors} />
      {createCard}
      {isCreating && !hasWorkers ? null : roster}
      {isRefetching ? <Text style={styles.refreshing}>Refreshing…</Text> : null}
    </ScrollView>
  );
}

function HostErrors({
  errors,
}: {
  errors: { serverName: string; message: string }[];
}): ReactElement | null {
  if (errors.length === 0) return null;
  return (
    <View style={styles.errorBanner}>
      {errors.map((error) => (
        <Text key={error.serverName} style={styles.errorText}>
          {error.serverName}: {error.message}
        </Text>
      ))}
    </View>
  );
}

function EmptyRoster({ onCreate }: { onCreate: () => void }): ReactElement {
  return (
    <View style={styles.empty}>
      <Users size={28} />
      <Text style={styles.emptyTitle}>No workers yet</Text>
      <Text style={styles.emptyBody}>
        A worker is a long-lived role with its own workspace. Pick a role to start one.
      </Text>
      <Button variant="secondary" onPress={onCreate} testID="workers-empty-create">
        New worker
      </Button>
    </View>
  );
}

function WorkerRow({ worker }: { worker: AggregatedWorker }): ReactElement {
  return (
    <View style={styles.row} testID={`worker-row-${worker.id}`}>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle}>{worker.name}</Text>
        <Text style={styles.rowMeta}>
          {/* Fall back to the id: a role the host no longer ships is still a
              real fact about this worker, and hiding it would look like a bug. */}
          {worker.templateTitle ?? worker.templateId}
        </Text>
      </View>
      <View style={styles.rowMetaRight}>
        <Text style={styles.rowMeta}>{worker.status}</Text>
      </View>
    </View>
  );
}

function CreateWorkerCard({
  templates,
  onCancel,
  onCreated,
}: {
  templates: WorkerTemplateOption[];
  onCancel: () => void;
  onCreated: () => void;
}): ReactElement {
  const [name, setName] = useState("");
  const [templateKey, setTemplateKey] = useState<string | null>(
    templates[0] ? `${templates[0].serverId}:${templates[0].id}` : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selected = useMemo(
    () =>
      templates.find((template) => `${template.serverId}:${template.id}` === templateKey) ?? null,
    [templates, templateKey],
  );
  const canSubmit = name.trim().length > 0 && selected !== null && !submitting;

  const submit = useCallback(async () => {
    if (!selected) return;
    const runtime = getHostRuntimeStore();
    const client = runtime.getClient(selected.serverId);
    if (!client) {
      setError("This host is not connected.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await client.createWorker({ name: name.trim(), templateId: selected.id });
      onCreated();
    } catch (cause) {
      // The daemon's refusal is the useful message (unknown role, bad name);
      // replacing it with a generic string would lose the reason.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  }, [name, selected, onCreated]);

  const handleSubmit = useCallback(() => {
    void submit();
  }, [submit]);

  const roleOptions = useMemo(
    () =>
      templates.map((template) => (
        <RoleOption
          key={`${template.serverId}:${template.id}`}
          template={template}
          selected={`${template.serverId}:${template.id}` === templateKey}
          onSelect={setTemplateKey}
        />
      )),
    [templates, templateKey],
  );

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>New worker</Text>
      <Field label="Name" testID="worker-create-name">
        <TextInput
          initialValue=""
          onChangeText={setName}
          placeholder="Alice"
          testID="worker-create-name-input"
        />
      </Field>
      <Field label="Role" testID="worker-create-role">
        <View style={styles.roleList}>{roleOptions}</View>
      </Field>{" "}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <View style={styles.cardActions}>
        <Button variant="ghost" onPress={onCancel} testID="worker-create-cancel">
          Cancel
        </Button>
        <Button
          variant="default"
          onPress={handleSubmit}
          disabled={!canSubmit}
          testID="worker-create-submit"
        >
          {submitting ? "Creating…" : "Create"}
        </Button>
      </View>
    </View>
  );
}

function RoleOption({
  template,
  selected,
  onSelect,
}: {
  template: WorkerTemplateOption;
  selected: boolean;
  onSelect: (key: string) => void;
}): ReactElement {
  const key = `${template.serverId}:${template.id}`;
  const handlePress = useCallback(() => onSelect(key), [onSelect, key]);

  return (
    <Pressable
      onPress={handlePress}
      style={selected ? styles.roleOptionSelected : styles.roleOption}
      testID={`worker-role-${template.id}`}
    >
      <Text style={styles.roleTitle}>{template.title}</Text>
      <Text style={styles.rowMeta}>
        {template.skills.length > 0 ? `${template.skills.length} skills` : "No skills"}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  spinnerColor: {
    color: theme.colors.accent,
  },
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[4],
    padding: theme.spacing[6],
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    flexGrow: 1,
    gap: theme.spacing[3],
    padding: theme.spacing[6],
  },
  empty: {
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[8],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  emptyBody: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
    maxWidth: 420,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  rowMain: {
    flexShrink: 1,
    gap: theme.spacing[1],
  },
  rowMetaRight: {
    alignItems: "flex-end",
  },
  rowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  rowMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  card: {
    gap: theme.spacing[4],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  cardTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  cardActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  roleList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  roleOption: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  roleOptionSelected: {
    borderColor: theme.colors.accent,
  },
  roleTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  errorBanner: {
    gap: theme.spacing[1],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  errorText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  refreshing: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
