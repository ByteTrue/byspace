import { ChevronRight } from "lucide-react-native";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ICON_SIZE } from "@/styles/theme";
import { settingsStyles } from "@/styles/settings";
import { SettingsInfoTip } from "./settings-info-tip";

const ThemedChevronRight = withUnistyles(ChevronRight);

const mutedColorMapping = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});

interface SettingsSectionProps {
  title: string;
  /**
   * What this section is for. Renders as an info tooltip on the header; a
   * paragraph between the header and the card is wrong (docs/design.md §7).
   */
  info?: ReactNode;
  trailing?: ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  /**
   * Drops the section's bottom margin. Use when the section is the last child
   * of a SettingsGroup, so the group's own bottom margin owns the trailing gap.
   */
  flush?: boolean;
  /**
   * Makes the section a disclosure: the header toggles it and the children hide
   * when closed. Collapsing is for length, not tidiness — reach for it when a
   * section is long enough to push the ones below out of view (an unbounded
   * list, a catalog you visit once per install). A collapsed section hides
   * whether the thing it owns is configured at all, so a section someone came
   * to the page for, or one whose state is worth reading at a glance, opens
   * expanded and passes `collapsedSummary` so folding it loses nothing.
   */
  collapsible?: boolean;
  /** Opens folded. Defaults to false: a section opens expanded unless length says otherwise. */
  defaultCollapsed?: boolean;
  /** Summary shown on the header while collapsed, when the title is not enough. */
  collapsedSummary?: ReactNode;
  children: ReactNode;
}

/**
 * iOS-style grouped settings block: muted label + children stacked with a
 * consistent gap. The single primitive used for every section across settings;
 * don't reach for ad-hoc `<Text>` headers or bare card margins.
 */
export function SettingsSection({
  title,
  info,
  trailing,
  testID,
  style,
  flush,
  collapsible = false,
  defaultCollapsed = false,
  collapsedSummary,
  children,
}: SettingsSectionProps) {
  const [isExpanded, setIsExpanded] = useState(!defaultCollapsed);
  const toggleState = useMemo(() => ({ expanded: isExpanded }), [isExpanded]);
  const handleToggle = useCallback(() => setIsExpanded((current) => !current), []);
  const sectionStyle = useMemo(
    () => [settingsStyles.section, flush ? styles.flush : null, style],
    [flush, style],
  );

  const header = (
    <View style={styles.titleRow}>
      <Text style={settingsStyles.sectionHeaderTitle}>{title}</Text>
      {info ? (
        <SettingsInfoTip title={title} info={info} testID={testID ? `${testID}-info` : undefined} />
      ) : null}
      {collapsible && !isExpanded && collapsedSummary ? (
        <Text style={styles.summary} numberOfLines={1}>
          {collapsedSummary}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View style={sectionStyle} testID={testID}>
      <View style={styles.header}>
        {collapsible ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={toggleState}
            accessibilityLabel={title}
            onPress={handleToggle}
            style={styles.toggle}
            testID={testID ? `${testID}-toggle` : undefined}
          >
            {header}
            <ThemedChevronRight
              size={ICON_SIZE.sm}
              uniProps={mutedColorMapping}
              style={isExpanded ? styles.chevronExpanded : undefined}
            />
          </Pressable>
        ) : (
          header
        )}
        {trailing}
      </View>
      {!collapsible || isExpanded ? <View style={styles.content}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    marginBottom: theme.spacing[3],
    marginLeft: theme.spacing[1],
  },
  // The toggle lives inside the header's own rail: the chevron sits at the
  // trailing edge so every section label on the page shares one left edge.
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flex: 1,
  },
  chevronExpanded: {
    transform: [{ rotate: "90deg" }],
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 1,
  },
  summary: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  content: {
    gap: theme.spacing[3],
  },
  flush: {
    marginBottom: 0,
  },
}));
