import React, { useContext, useMemo, type ReactElement } from "react";
import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useKeyboardShortcutsAvailable } from "@/keyboard/availability";
import { normalizeDisplayChord } from "@/components/ui/normalize-display-chord";
import { TooltipSurfaceContext } from "@/components/ui/tooltip";
import { formatShortcut, type ShortcutKey } from "@/utils/format-shortcut";
import { getShortcutOs } from "@/utils/shortcut-platform";

export function Shortcut({
  keys,
  chord,
  style,
  textStyle,
}: {
  keys?: ShortcutKey[];
  chord?: ShortcutKey[][];
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}): ReactElement | null {
  const shortcutsAvailable = useKeyboardShortcutsAvailable();
  const inTooltip = useContext(TooltipSurfaceContext);
  const displayChord = normalizeDisplayChord(chord, keys);
  const shortcutOs = getShortcutOs();

  const badgeStyle = useMemo(() => [styles.badge, style], [style]);
  const textCombinedStyle = useMemo(
    () => [styles.text, inTooltip && styles.textInTooltip, textStyle],
    [inTooltip, textStyle],
  );
  const backgroundStyle = inTooltip ? styles.badgeBackgroundInTooltip : styles.badgeBackground;
  const sequenceStyle = useMemo(() => [styles.sequence, style], [style]);

  if (!shortcutsAvailable) {
    return null;
  }

  const singleCombo = displayChord?.[0];
  // Render nothing, literally — an empty <View> would still consume the
  // parent's `gap` and leave a phantom slot where the badge used to be.
  if (!displayChord || !singleCombo) {
    return null;
  }

  if (displayChord.length === 1) {
    return (
      <View style={badgeStyle}>
        <View style={backgroundStyle} />
        <Text style={textCombinedStyle}>{formatShortcut(singleCombo, shortcutOs)}</Text>
      </View>
    );
  }

  return (
    <View style={sequenceStyle}>
      {displayChord.map(function (combo) {
        return (
          <View key={combo.join("+")} style={styles.badge}>
            <View style={backgroundStyle} />
            <Text style={textCombinedStyle}>{formatShortcut(combo, shortcutOs)}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // shadcn/ui kbd: a 20px muted key cap.
  badge: {
    position: "relative",
    minWidth: 20,
    minHeight: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
    borderWidth: 0,
  },
  badgeBackground: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: theme.borderRadius.base,
    backgroundColor: theme.colors.surface2,
  },
  badgeBackgroundInTooltip: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: theme.borderRadius.base,
    backgroundColor: theme.colors.tooltipKbd,
  },
  sequence: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[1],
  },
  text: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  textInTooltip: {
    color: theme.colors.tooltipForeground,
  },
}));
