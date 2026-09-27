import { type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

/**
 * Relative time after the reference product (Updated 4m ago style).
 * Renders the largest unit that fits, t<1m as "just now".
 */
export function formatRelativeTime(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) {
    return iso.slice(0, 10);
  }
  const deltaMs = Date.now() - ts;
  if (deltaMs < 0) {
    return iso.slice(0, 10);
  }
  const min = Math.floor(deltaMs / 60_000);
  if (min < 1) {
    return "just now";
  }
  if (min < 60) {
    return `${min}m ago`;
  }
  const hour = Math.floor(min / 60);
  if (hour < 24) {
    return `${hour}h ago`;
  }
  const day = Math.floor(hour / 24);
  if (day < 7) {
    return `${day}d ago`;
  }
  return iso.slice(0, 10);
}

/**
 * A small circular actor avatar, in the reference product's style: a colored
 * disc with the actor's initial. The color is derived from the id so it is
 * stable across re-renders.
 */
export function ActorAvatar({ name, id }: { name: string; id: string }): ReactElement {
  const initial = (name.trim().charAt(0) || "?").toUpperCase();
  return (
    <View style={[styles.avatar, { backgroundColor: colorForId(id) }]}>
      <Text style={styles.avatarText}>{initial}</Text>
    </View>
  );
}

const AVATAR_COLORS = [
  "#5b5ef4", // indigo
  "#d97706", // amber
  "#059669", // emerald
  "#dc2626", // red
  "#7c3aed", // violet
  "#0284c7", // sky
  "#db2777", // pink
  "#65a30d", // lime
] as const;

function colorForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/**
 * One line of issue card metadata: actor avatar + name, and the relative
 * time. Used by both board cards and (later) list rows.
 */
export function IssueMetaLine({
  actorName,
  actorId,
  updatedAt,
}: {
  actorName: string | null;
  actorId: string | null;
  updatedAt: string;
}): ReactElement {
  return (
    <View style={styles.meta}>
      {actorId && actorName ? (
        <>
          <ActorAvatar name={actorName} id={actorId} />
          <Text style={styles.actorName} numberOfLines={1}>
            {actorName}
          </Text>
        </>
      ) : (
        <Text style={styles.actorEmpty}>unassigned</Text>
      )}
      <Text style={styles.time}>{formatRelativeTime(updatedAt)}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  avatar: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontSize: 9, fontWeight: "600" },
  meta: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  actorName: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, maxWidth: 90 },
  actorEmpty: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  time: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, marginLeft: "auto" },
}));
