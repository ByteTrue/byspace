import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  type HostRuntimeConnectionStatus,
  useHostRuntimeConnectionStatus,
} from "@/runtime/host-runtime";

function getStatusStyle(status: HostRuntimeConnectionStatus) {
  if (status === "online") return styles.online;
  if (status === "connecting") return styles.connecting;
  return styles.offline;
}

export function HostStatusDot({ serverId }: { serverId: string }) {
  const status = useHostRuntimeConnectionStatus(serverId);
  return (
    <View
      style={[styles.dot, getStatusStyle(status)]}
      accessible
      accessibilityLabel={`Host ${status}`}
      testID={`host-status-${status}`}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  online: { backgroundColor: theme.colors.statusSuccess },
  connecting: { backgroundColor: theme.colors.statusWarning },
  offline: { backgroundColor: theme.colors.statusDanger },
}));
