// Port of archive/expo-app:packages/app/src/screens/settings/appearance/sidebar-nav-section.tsx: sidebar entries — shortcut, reorder and visibility. Same logic, DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/sidebar-nav-section.py; edit it directly.
import { useCallback, useMemo, type ReactElement } from "react";
import { cn } from "cn";
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
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Shortcut } from "~/components/shortcut";
import { Switch } from "~/components/ui/switch";
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
import { withTheme } from "~/app/theme-object";

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ThemedArrowUp = withTheme(ArrowUp);
const ThemedArrowDown = withTheme(ArrowDown);

const moveUpIcon = <ThemedArrowUp size={ICON_SIZE.xs} themeProps={mutedColorMapping} />;
const moveDownIcon = <ThemedArrowDown size={ICON_SIZE.xs} themeProps={mutedColorMapping} />;

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

const ThemedNavIcon = withTheme(NavIcon);

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

  return (
    <div
      className={cn(settingsStyles.row, !isFirst && settingsStyles.rowBorder, "gap-2")}
      data-testid={`sidebar-nav-item-${item.key}`}
    >
      <div className="flex flex-1 flex-row items-center gap-2">
        <ThemedNavIcon Icon={navItemIcon(item)} themeProps={mutedColorMapping} />
        <span className={cn(settingsStyles.rowTitle, "truncate")}>{label}</span>
        <NavItemShortcut item={item} />
      </div>
      <div className="flex flex-row items-center gap-3">
        {reorderable ? (
          <div className="flex flex-row items-center overflow-hidden rounded-md border bg-muted">
            <Button
              variant="ghost"
              size="xs"
              onClick={handleMoveUp}
              aria-label={t("settings.appearance.sidebar.moveUp")}
              data-testid={`sidebar-nav-move-up-${item.key}`}
              disabled={isFirst}
            >
              {moveUpIcon}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={handleMoveDown}
              aria-label={t("settings.appearance.sidebar.moveDown")}
              data-testid={`sidebar-nav-move-down-${item.key}`}
              disabled={isLast}
            >
              {moveDownIcon}
            </Button>
          </div>
        ) : null}
        <Switch
          checked={item.visible}
          onCheckedChange={handleVisibleChange}
          aria-label={label}
          data-testid={`sidebar-nav-toggle-${item.key}`}
        />
      </div>
    </div>
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
      <div className={settingsStyles.card}>
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
      </div>
    </SettingsSection>
  );
}
