import { type ReactElement } from "react";

import { MulticaInbox } from "@/multica/multica-inbox";
import { useHosts } from "@/runtime/host-runtime";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

/**
 * The owner's action inbox route.
 */
export default function MulticaInboxRoute(): ReactElement {
  const hosts = useHosts();
  const primary = hosts[0];
  if (!primary) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Connect a host to use the multica workspace.</Text>
      </View>
    );
  }
  return <MulticaInbox serverId={primary.serverId} />;
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
