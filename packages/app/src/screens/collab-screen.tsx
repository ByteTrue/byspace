import React, {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react";
import { ScrollView, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { Plus, RefreshCw } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { EditingTextInput } from "@/components/ui/text-input";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { toErrorMessage } from "@/utils/error-messages";
import type { CollabSliceRecord } from "@bytetrue/protocol/messages";

type LoadState =
  | { status: "connecting" }
  | { status: "loaded"; records: CollabSliceRecord[] }
  | { status: "error"; message: string };

/**
 * Minimal collab entry (validation slice BYTE-6): lists the slice records of
 * the first connected host and creates one on it. Not a work-item UI — that is
 * P1 scope.
 */
export function CollabScreen(): ReactElement {
  const isFocused = useIsFocused();

  if (!isFocused) {
    return <View style={styles.container} />;
  }

  return <CollabScreenContent />;
}

function firstConnectedClient(): ReturnType<
  ReturnType<typeof getHostRuntimeStore>["getClient"]
> | null {
  const runtime = getHostRuntimeStore();
  const online = runtime
    .getHosts()
    .find((host) => runtime.getSnapshot(host.serverId)?.connectionStatus === "online");
  return online ? runtime.getClient(online.serverId) : null;
}

function CollabScreenContent(): ReactElement {
  const runtime = getHostRuntimeStore();
  // Re-render when any host's connection state changes so the screen leaves
  // the connecting state on its own instead of waiting for a manual refresh.
  const runtimeVersion = useSyncExternalStore(
    (onStoreChange) => runtime.subscribeAll(onStoreChange),
    () => runtime.getVersion(),
    () => runtime.getVersion(),
  );
  const [loadState, setLoadState] = useState<LoadState>({ status: "connecting" });
  const [title, setTitle] = useState("");
  // Remounts the editing text input after a successful create so the editor's
  // internal text resets together with the state it mirrors.
  const [titleKey, setTitleKey] = useState(0);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    const client = firstConnectedClient();
    if (!client) {
      setLoadState({ status: "connecting" });
      return;
    }
    try {
      const payload = await client.collabSliceList();
      if (payload.error) {
        setLoadState({ status: "error", message: payload.error });
        return;
      }
      setLoadState({ status: "loaded", records: payload.records });
    } catch (error) {
      setLoadState({ status: "error", message: toErrorMessage(error) });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, runtimeVersion]);

  const createRecord = useCallback(async () => {
    const client = firstConnectedClient();
    if (!client) {
      return;
    }
    setCreating(true);
    try {
      const payload = await client.collabSliceCreate({
        title: title.trim() || "Untitled slice record",
      });
      if (payload.error) {
        setLoadState({ status: "error", message: payload.error });
        return;
      }
      setTitle("");
      setTitleKey((key) => key + 1);
      await refresh();
    } catch (error) {
      setLoadState({ status: "error", message: toErrorMessage(error) });
    } finally {
      setCreating(false);
    }
  }, [refresh, title]);

  const handleCreatePress = useCallback(() => {
    void createRecord();
  }, [createRecord]);
  const handleRefreshPress = useCallback(() => {
    void refresh();
  }, [refresh]);

  return (
    <View style={styles.container}>
      <MenuHeader title="Collab" />
      <View style={styles.toolbar}>
        <EditingTextInput
          key={titleKey}
          style={styles.input}
          initialValue={title}
          onChangeText={setTitle}
          placeholder="Record title"
          testID="collab-title-input"
        />
        <Button
          variant="outline"
          leftIcon={Plus}
          size="sm"
          testID="collab-create"
          onPress={handleCreatePress}
          disabled={creating}
        >
          Create
        </Button>
        <Button
          variant="ghost"
          leftIcon={RefreshCw}
          size="sm"
          testID="collab-refresh"
          onPress={handleRefreshPress}
        >
          Refresh
        </Button>
      </View>
      {loadState.status === "connecting" ? (
        <View style={styles.centered}>
          <LoadingSpinner size="large" color={styles.spinner.color} />
        </View>
      ) : null}
      {loadState.status === "error" ? (
        <View style={styles.centered} testID="collab-error">
          <Text style={styles.message}>{loadState.message}</Text>
        </View>
      ) : null}
      {loadState.status === "loaded" ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {loadState.records.length === 0 ? (
            <Text style={styles.message} testID="collab-empty">
              No records yet
            </Text>
          ) : (
            loadState.records
              .slice()
              .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
              .map((record) => (
                <View key={record.id} style={styles.row} testID="collab-record-row">
                  <Text style={styles.rowTitle}>{record.title}</Text>
                  <Text style={styles.rowMeta}>{new Date(record.createdAt).toLocaleString()}</Text>
                </View>
              ))
          )}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingVertical: theme.spacing[2],
  },
  input: {
    flex: 1,
    minWidth: 0,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    color: theme.colors.foreground,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
  },
  spinner: {
    color: theme.colors.foregroundMuted,
  },
  message: {
    color: theme.colors.foregroundMuted,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingBottom: theme.spacing[4],
    gap: theme.spacing[2],
  },
  row: {
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing[1],
  },
  rowTitle: {
    color: theme.colors.foreground,
  },
  rowMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
  },
}));
