import { memo, type ReactElement } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Bot } from "lucide-react-native";
import { useSessionStore } from "@/stores/session-store";

const ThemedBot = withUnistyles(Bot, (theme) => ({ color: theme.colors.foreground }));

interface ChiefFabProps {
  serverId: string | null;
  agentId: string | null;
  onPress: () => void;
}

function resolveAgentDot(
  state: ReturnType<typeof useSessionStore.getState>,
  serverId: string | null,
  agentId: string | null,
): string | null {
  if (!serverId || !agentId) return null;
  const session = state.sessions[serverId];
  const agent = session?.agents.get(agentId);
  if (!agent) return null;
  if (agent.status === "running") return "accent";
  if (agent.requiresAttention) return "statusWarning";
  return null;
}

export const ChiefFab = memo(function ChiefFab({
  serverId,
  agentId,
  onPress,
}: ChiefFabProps): ReactElement {
  const dotColor = useSessionStore((state) => resolveAgentDot(state, serverId, agentId));

  return (
    <Pressable
      style={pressableStyle}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Open Chief"
      testID="chief-fab"
    >
      <ThemedBot size={22} />
      {dotColor ? (
        <View style={[styles.dot, dotColor === "statusWarning" && styles.dotWarning]} />
      ) : null}
    </Pressable>
  );
});

const pressableStyle = ({ pressed }: { pressed: boolean }) => [
  styles.fab,
  pressed && styles.fabPressed,
];

const styles = StyleSheet.create((theme) => ({
  fab: {
    position: "absolute",
    bottom: 20,
    right: 20,
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
    zIndex: 900,
  },
  fabPressed: {
    backgroundColor: theme.colors.surface2,
  },
  dot: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: theme.colors.accent,
  },
  dotWarning: {
    backgroundColor: theme.colors.statusWarning,
  },
}));
