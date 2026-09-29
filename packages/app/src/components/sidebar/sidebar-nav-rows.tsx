import { useCallback } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import {
  SIDEBAR_NAV_TEST_IDS,
  useSidebarNavEntries,
  type SidebarNavEntry,
} from "@/sidebar-nav/use-sidebar-nav-entries";

interface SidebarNavRowsProps {
  /** Style for the group wrapper, which the sidebar owns. */
  style?: StyleProp<ViewStyle>;
  onBeforeNavigate?: () => void;
}

/**
 * Top-level sidebar navigation as rows, ordered and filtered by the user's
 * `sidebarNavItems` preference. Renders nothing — not even the bordered group wrapper —
 * when every item is hidden.
 *
 * Both sidebars render these, from the same `useSidebarNavEntries` source: the compact shell
 * inside its BySpace disclosure, the pinned shell inside the one in its top row.
 */
export function SidebarNavRows({ style, onBeforeNavigate }: SidebarNavRowsProps) {
  const entries = useSidebarNavEntries();

  if (entries.length === 0) return null;

  return (
    <View style={style}>
      {entries.map((entry) => (
        <SidebarNavRow key={entry.id} entry={entry} onBeforeNavigate={onBeforeNavigate} />
      ))}
    </View>
  );
}

function SidebarNavRow({
  entry,
  onBeforeNavigate,
}: {
  entry: SidebarNavEntry;
  onBeforeNavigate?: () => void;
}) {
  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    entry.onSelect();
  }, [entry, onBeforeNavigate]);

  return (
    <SidebarHeaderRow
      icon={entry.icon}
      label={entry.label}
      onPress={handlePress}
      isActive={entry.isActive}
      testID={SIDEBAR_NAV_TEST_IDS[entry.id]}
      variant="compact"
      shortcutKeys={entry.shortcutKeys}
    />
  );
}
