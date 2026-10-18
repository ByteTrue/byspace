import { useCallback, useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  CalendarClock,
  History,
  Plus,
  Search,
  type LucideIcon,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { Shortcut } from "@/components/ui/shortcut";
import { Switch } from "@/components/ui/switch";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import {
  builtinSidebarNavLabelKey,
  builtinSidebarNavShortcutAction,
  isMenuSidebarNavId,
  type BuiltinSidebarNavId,
  type SidebarNavItem,
} from "@/sidebar-nav/model";
import { useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedArrowDown = withUnistyles(ArrowDown);

const moveUpIcon = <ThemedArrowUp size={ICON_SIZE.xs} uniProps={mutedColorMapping} />;
const moveDownIcon = <ThemedArrowDown size={ICON_SIZE.xs} uniProps={mutedColorMapping} />;

const BUILTIN_ICONS: Record<BuiltinSidebarNavId, LucideIcon> = {
  "new-workspace": Plus,
  history: History,
  search: Search,
  schedules: CalendarClock,
  tunnels: ArrowRightLeft,
};

function NavIcon({ Icon, color = "" }: { Icon: LucideIcon; color?: string }) {
  return <Icon size={ICON_SIZE.md} color={color} />;
}

const ThemedNavIcon = withUnistyles(NavIcon);

function navItemIcon(item: SidebarNavItem): LucideIcon {
  // Plugin sidebar groups are retired (issue 025 C6); only builtin items remain.
  return BUILTIN_ICONS[(item as { id: keyof typeof BUILTIN_ICONS }).id];
}

function navItemLabel(t: TFunction, item: SidebarNavItem): string {
  return t(
    builtinSidebarNavLabelKey((item as { id: Parameters<typeof builtinSidebarNavLabelKey>[0] }).id),
  );
}

/** Own component so the row can stay hook-free about which items have a shortcut. */
function NavItemShortcut({ item }: { item: SidebarNavItem }): ReactElement | null {
  const chord = useShortcutKeys(
    item.kind === "builtin" ? builtinSidebarNavShortcutAction(item.id) : null,
  );
  return chord ? <Shortcut chord={chord} /> : null;
}

interface SidebarNavRowProps {
  item: SidebarNavItem;
  isFirst: boolean;
  isLast: boolean;
  onMove: (key: string, direction: "up" | "down") => void;
  onSetVisible: (key: string, visible: boolean) => void;
}

function SidebarNavRow({
  item,
  isFirst,
  isLast,
  onMove,
  onSetVisible,
}: SidebarNavRowProps): ReactElement {
  const { t } = useTranslation();
  const label = navItemLabel(t, item);
  // The items the top row and Workspaces header own have a place the layout decides, not the
  // user, so a reorder control on their rows would be a control that does nothing. Visibility
  // still applies — switching them off removes them from their slot.
  const reorderable = isMenuSidebarNavId(item.id);

  const handleMoveUp = useCallback(() => onMove(item.key, "up"), [item.key, onMove]);
  const handleMoveDown = useCallback(() => onMove(item.key, "down"), [item.key, onMove]);
  const handleVisibleChange = useCallback(
    (visible: boolean) => onSetVisible(item.key, visible),
    [item.key, onSetVisible],
  );

  const rowStyle = useMemo(
    () => [settingsStyles.row, isFirst ? null : settingsStyles.rowBorder, styles.row],
    [isFirst],
  );

  return (
    <View style={rowStyle} testID={`sidebar-nav-item-${item.key}`}>
      <View style={styles.rowMain}>
        <ThemedNavIcon Icon={navItemIcon(item)} uniProps={mutedColorMapping} />
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {label}
        </Text>
        <NavItemShortcut item={item} />
      </View>
      <View style={styles.rowActions}>
        {reorderable ? (
          <View style={styles.reorderCluster}>
            <Button
              variant="ghost"
              size="xs"
              leftIcon={moveUpIcon}
              onPress={handleMoveUp}
              disabled={isFirst}
              accessibilityLabel={t("settings.appearance.sidebar.moveUp")}
              testID={`sidebar-nav-move-up-${item.key}`}
            />
            <Button
              variant="ghost"
              size="xs"
              leftIcon={moveDownIcon}
              onPress={handleMoveDown}
              disabled={isLast}
              accessibilityLabel={t("settings.appearance.sidebar.moveDown")}
              testID={`sidebar-nav-move-down-${item.key}`}
            />
          </View>
        ) : null}
        <Switch
          value={item.visible}
          onValueChange={handleVisibleChange}
          accessibilityLabel={label}
          testID={`sidebar-nav-toggle-${item.key}`}
        />
      </View>
    </View>
  );
}

export function SidebarNavSection(): ReactElement {
  const { t } = useTranslation();
  const { items, setVisible, move } = useSidebarNavItems();
  // The ends of the *reorderable* run, not of the list: the header's two items sit in the same
  // list but hold no reorder control, and counting them would leave the first reorderable row's
  // Move up enabled at the top of a run it cannot move within.
  const reorderableKeys = useMemo(
    () => items.filter((item) => isMenuSidebarNavId(item.id)).map((item) => item.key),
    [items],
  );

  return (
    <SettingsSection
      title={t("settings.appearance.sidebar.title")}
      info={t("settings.appearance.sidebar.description")}
      testID="sidebar-nav-section"
    >
      <View style={settingsStyles.card}>
        {items.map((item) => (
          <SidebarNavRow
            key={item.key}
            item={item}
            isFirst={reorderableKeys.indexOf(item.key) === 0}
            isLast={reorderableKeys.indexOf(item.key) === reorderableKeys.length - 1}
            onMove={move}
            onSetVisible={setVisible}
          />
        ))}
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    gap: theme.spacing[2],
  },
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  reorderCluster: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
}));
