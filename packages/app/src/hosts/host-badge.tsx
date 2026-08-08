import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Server } from "lucide-react-native";
import { HOST_COLORS, type HostBadgeModel, type HostColor } from "@/hosts/appearance";
import { identityForeground } from "@/styles/identity-colors";
import type { Theme } from "@/styles/theme";

export const HOST_BADGE_ICON_SIZE = 12;
const ThemedServer = withUnistyles(Server);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const HOST_ICON_MAPPINGS: Record<HostColor, (theme: Theme) => { color: string }> = (() => {
  const mappings = {} as Record<HostColor, (theme: Theme) => { color: string }>;
  for (const color of HOST_COLORS) {
    mappings[color] =
      color === "none"
        ? mutedMapping
        : (theme) => ({ color: identityForeground(color, theme.colorScheme) });
  }
  return mappings;
})();

export function HostBadge({
  badge,
  accessible = true,
}: {
  badge: HostBadgeModel;
  accessible?: boolean;
}) {
  return (
    <View
      style={styles.badge}
      testID={`host-badge-${badge.serverId}`}
      accessible={accessible}
      accessibilityLabel={accessible ? badge.label : undefined}
    >
      <ThemedServer size={HOST_BADGE_ICON_SIZE} uniProps={HOST_ICON_MAPPINGS[badge.color]} />
      {badge.showLabel ? (
        <Text style={[styles.label, labelColorStyle(badge.color)]} numberOfLines={1}>
          {badge.label}
        </Text>
      ) : null}
    </View>
  );
}

function labelColorStyle(color: HostColor) {
  switch (color) {
    case "violet":
      return styles.labelViolet;
    case "sky":
      return styles.labelSky;
    case "emerald":
      return styles.labelEmerald;
    case "orange":
      return styles.labelOrange;
    case "pink":
      return styles.labelPink;
    case "indigo":
      return styles.labelIndigo;
    case "teal":
      return styles.labelTeal;
    case "red":
      return styles.labelRed;
    case "amber":
      return styles.labelAmber;
    case "blue":
      return styles.labelBlue;
    case "none":
      return null;
  }
}

const styles = StyleSheet.create((theme) => ({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    minWidth: 0,
    flexShrink: 100,
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
    flexShrink: 1,
    minWidth: 0,
  },
  labelViolet: { color: identityForeground("violet", theme.colorScheme) },
  labelSky: { color: identityForeground("sky", theme.colorScheme) },
  labelEmerald: { color: identityForeground("emerald", theme.colorScheme) },
  labelOrange: { color: identityForeground("orange", theme.colorScheme) },
  labelPink: { color: identityForeground("pink", theme.colorScheme) },
  labelIndigo: { color: identityForeground("indigo", theme.colorScheme) },
  labelTeal: { color: identityForeground("teal", theme.colorScheme) },
  labelRed: { color: identityForeground("red", theme.colorScheme) },
  labelAmber: { color: identityForeground("amber", theme.colorScheme) },
  labelBlue: { color: identityForeground("blue", theme.colorScheme) },
}));
