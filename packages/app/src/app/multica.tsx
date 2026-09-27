import { type ReactElement } from "react";

import { MulticaBoard } from "@/multica/multica-board";
import { useHosts } from "@/runtime/host-runtime";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

/**
 * The multica console's entry route: the board.
 */
export default function MulticaRoute(): ReactElement {
  const hosts = useHosts();
  const primary = hosts[0];
  if (!primary) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Connect a host to use the multica workspace.</Text>
      </View>
    );
  }
  return <MulticaBoard serverId={primary.serverId} />;
}

const styles = StyleSheet.create((theme) => ({
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[4],
  },
}));
