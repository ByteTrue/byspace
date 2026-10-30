import React, { useMemo, type ReactNode } from "react";
import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";

export type StatusBadgeVariant = "success" | "warning" | "error" | "muted";

interface StatusBadgeProps {
  label: string;
  variant?: StatusBadgeVariant;
  leading?: ReactNode;
}

export function StatusBadge({ label, variant = "muted", leading }: StatusBadgeProps) {
  const textStyle = useMemo(
    () => [
      styles.pillText,
      variant === "success" && styles.pillTextSuccess,
      variant === "warning" && styles.pillTextWarning,
      variant === "error" && styles.pillTextError,
    ],
    [variant],
  );

  return (
    <View style={styles.pill}>
      {leading}
      <Text style={textStyle}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // shadcn/ui badge (secondary): a 20px pill, no border.
  pill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: theme.spacing[1],
    minHeight: 20,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
  },
  pillText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  pillTextSuccess: {
    color: theme.colors.statusSuccess,
  },
  pillTextWarning: {
    color: theme.colors.statusWarning,
  },
  pillTextError: {
    color: theme.colors.statusDanger,
  },
}));
