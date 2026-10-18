import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  MenuItem,
  MenuRoot,
  MenuSurface,
  MenuTrigger,
  type MenuTriggerState,
} from "@/components/ui/menu";
import { Shortcut } from "@/components/ui/shortcut";
import { HEADER_CONTROL_HEIGHT } from "@/components/ui/control-geometry";
import { isMenuSidebarNavId } from "@/sidebar-nav/model";
import { useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";
import {
  SIDEBAR_NAV_TEST_IDS,
  useSidebarNavMenuEntries,
  type SidebarNavEntry,
} from "@/sidebar-nav/use-sidebar-nav-entries";
import { sidebarLabelStyles } from "@/styles/sidebar";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const TRIGGER_TEST_ID = "sidebar-nav-menu-trigger";
const LABEL_TEST_ID = "sidebar-nav-menu-label";
const MENU_TEST_ID = "sidebar-nav-menu";

/** The item's 16pt leading slot, with the hair of room the display-preferences options leave. */
const ITEM_ICON_SIZE = 14;

interface SidebarNavMenuProps {
  /**
   * The shell's own "this sidebar is showing" flag. See `useSidebarNavMenuOpen`.
   */
  panelActive: boolean;
  /** Runs before an entry's own navigation, for shells whose panel has to get out of the way. */
  onBeforeNavigate?: () => void;
}

/**
 * The BySpace button: the sidebar's compact app-menu trigger on the left side of the top row,
 * with its entries on a floating surface anchored under it while the permanent Chief button sits
 * on the row's right edge.
 *
 * Renders nothing when the menu holds no visible entry, matching the "no items, no control" rule
 * the header buttons follow.
 */
export function SidebarNavMenu({
  panelActive,
  onBeforeNavigate,
}: SidebarNavMenuProps): ReactElement | null {
  const { t } = useTranslation();
  const { open, setOpen } = useSidebarNavMenuOpen(panelActive);
  const label = t("sidebar.appMenu.label");

  // Only the count matters for whether the button exists, so read the preference rather than
  // resolving every entry — that would subscribe to four shortcuts and look up the active
  // workspace on every render. The count is of the entries this button reveals, not of the whole
  // nav: New workspace and History are on the Workspaces header and are visible either way, so
  // counting them would keep a trigger that opens onto nothing.
  const items = useSidebarNavItems().items;
  const hasEntries = items.some((item) => item.visible && isMenuSidebarNavId(item.id));

  // Resolved inside the surface, so the labels, icons and shortcuts it needs are read only while
  // the menu is open.
  const popover = useMemo(
    () =>
      open && hasEntries ? <SidebarNavMenuSurface onBeforeNavigate={onBeforeNavigate} /> : null,
    [hasEntries, onBeforeNavigate, open],
  );

  if (!hasEntries) return null;

  return (
    <MenuRoot open={open} onOpenChange={setOpen}>
      <SidebarNavMenuTrigger label={label} open={open} />
      {popover}
    </MenuRoot>
  );
}

function SidebarNavMenuTrigger({ label, open }: { label: string; open: boolean }) {
  const ThemedChevron = useMemo(() => withUnistyles(open ? ChevronUp : ChevronDown), [open]);
  const triggerStyle = useCallback(
    ({ hovered, open: isOpen }: MenuTriggerState) => [
      styles.button,
      (hovered || isOpen) && styles.buttonHovered,
    ],
    [],
  );

  return (
    <MenuTrigger
      testID={TRIGGER_TEST_ID}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={triggerStyle}
    >
      {({ hovered }) => (
        <>
          <Text testID={LABEL_TEST_ID} numberOfLines={1} style={sidebarLabelStyles.title}>
            {label}
          </Text>
          <View pointerEvents="none" style={styles.chevronSlot}>
            <ThemedChevron
              size={ICON_SIZE.sm}
              uniProps={hovered || open ? foregroundColorMapping : foregroundMutedColorMapping}
            />
          </View>
        </>
      )}
    </MenuTrigger>
  );
}

/**
 * The menu's own contents: the destinations the header does not carry, in the user's order.
 *
 * Split out from the trigger so the entries are resolved only while the surface exists.
 */
function SidebarNavMenuSurface({
  onBeforeNavigate,
}: {
  onBeforeNavigate?: () => void;
}): ReactElement {
  const entries = useSidebarNavMenuEntries();

  return (
    <MenuSurface align="start" offset={6} testID={MENU_TEST_ID}>
      {entries.map((entry) => (
        <SidebarNavMenuItem key={entry.id} entry={entry} onBeforeNavigate={onBeforeNavigate} />
      ))}
    </MenuSurface>
  );
}

function SidebarNavMenuItem({
  entry,
  onBeforeNavigate,
}: {
  entry: SidebarNavEntry;
  onBeforeNavigate?: () => void;
}): ReactElement {
  const ThemedIcon = useMemo(() => withUnistyles(entry.icon), [entry.icon]);
  const leading = useMemo(
    () => <ThemedIcon size={ITEM_ICON_SIZE} uniProps={foregroundMutedColorMapping} />,
    [ThemedIcon],
  );
  // Memoized so the trailing shortcut, which reads the live keybinding, is not rebuilt on every
  // render of the surface's measurement passes.
  const trailing = useMemo(
    () => (entry.shortcutKeys ? <Shortcut chord={entry.shortcutKeys} /> : undefined),
    [entry.shortcutKeys],
  );
  const handleSelect = useCallback(() => {
    onBeforeNavigate?.();
    entry.onSelect();
  }, [entry, onBeforeNavigate]);

  return (
    <MenuItem
      testID={SIDEBAR_NAV_TEST_IDS[entry.id]}
      // The current page is marked with a check, as it is anywhere else a menu holds a set of
      // destinations. It costs nothing: the check is drawn only when the row is.
      selected={entry.isActive}
      leading={leading}
      trailing={trailing}
      onSelect={handleSelect}
    >
      {entry.label}
    </MenuItem>
  );
}

/**
 * Open state for the app menu, closed again whenever its shell stops showing.
 *
 * Neither shell unmounts when it closes — both are retained behind `display: none` so their scroll
 * and list state survive — while the menu's own surface is portalled into the overlay root, which
 * is not inside the panel. Without this the menu would outlive its trigger: left floating over the
 * page with nothing under it to anchor to, then still open on every later visit.
 *
 * Taking the flag here rather than letting each shell reset itself encodes the rule once, and
 * gives both the same first impression: closed.
 */
function useSidebarNavMenuOpen(panelActive: boolean): {
  open: boolean;
  setOpen: (open: boolean) => void;
} {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!panelActive) setOpen(false);
  }, [panelActive]);

  return { open, setOpen };
}

const styles = StyleSheet.create((theme) => ({
  button: {
    height: HEADER_CONTROL_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    userSelect: "none",
    flexShrink: 1,
    minWidth: 0,
  },
  buttonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  chevronSlot: {
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
}));
