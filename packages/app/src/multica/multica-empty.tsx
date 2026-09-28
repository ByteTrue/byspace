/**
 * The source's empty state shape: an icon in a circle, a title, one line of
 * description and a primary button that opens the create face. A bare grey
 * sentence tells the reader nothing is there but not what to do about it.
 * The icon arrives as a key because a JSX value in a prop slot is banned by
 * the repo's perf rules.
 */
import type { ReactElement } from "react";
import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Bot, Tag, Timer, Users } from "lucide-react-native";

export type MulticaEmptyIcon = "agent" | "squad" | "label" | "autopilot";

function EmptyIcon({ iconKey }: { iconKey: MulticaEmptyIcon }): ReactElement {
  switch (iconKey) {
    case "agent":
      return <Bot size={18} color="#888" />;
    case "squad":
      return <Users size={18} color="#888" />;
    case "label":
      return <Tag size={18} color="#888" />;
    default:
      return <Timer size={18} color="#888" />;
  }
}

export function MulticaEmptyState({
  iconKey,
  title,
  description,
  actionLabel,
  onAction,
  testID,
}: {
  iconKey: MulticaEmptyIcon;
  title: string;
  description: string;
  actionLabel: string | null;
  onAction: (() => void) | null;
  testID: string;
}): ReactElement {
  return (
    <View style={styles.emptyState} testID={testID}>
      <View style={styles.emptyIconCircle}>
        <EmptyIcon iconKey={iconKey} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDescription}>{description}</Text>
      {actionLabel && onAction ? (
        <ActionButton label={actionLabel} onAction={onAction} testID={`${testID}-action`} />
      ) : null}
    </View>
  );
}

function ActionButton({
  label,
  onAction,
  testID,
}: {
  label: string;
  onAction: () => void;
  testID: string;
}): ReactElement {
  const handlePress = useCallback(() => onAction(), [onAction]);
  return (
    <Pressable style={styles.emptyAction} onPress={handlePress} testID={testID}>
      <Text style={styles.emptyActionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  emptyState: {
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[6],
  },
  emptyIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.lg, fontWeight: "600" },
  emptyDescription: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  emptyAction: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.foreground,
  },
  emptyActionText: { color: theme.colors.background, fontSize: theme.fontSize.sm },
}));
