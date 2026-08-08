import { useCallback, useMemo, type ReactElement } from "react";
import { View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Settings2 } from "lucide-react-native";
import type { Theme } from "@/styles/theme";
import {
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuSubTrigger,
  MenuSurface,
  MenuTrigger,
  type MenuPageDefinition,
} from "@/components/ui/menu";
import { HostStatusDot } from "@/components/host-status-dot";
import { useHosts } from "@/runtime/host-runtime";
import {
  SIDEBAR_CHECKS_DISPLAYS,
  type SidebarChecksDisplay,
} from "./display-preferences/checks-display";
import {
  useSidebarDisplayPreferences,
  type SidebarTrailingChoice,
} from "./display-preferences/model";
import { SIDEBAR_ROW_ITEMS, type SidebarRowItem } from "./display-preferences/row-items";
import type { WorkspaceTitleSource } from "@/hooks/use-settings";

const ThemedSettings2 = withUnistyles(Settings2);
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const MENU_WIDTH = 232;

const TITLE_LABELS: Record<WorkspaceTitleSource, string> = {
  title: "Title",
  branch: "Branch name",
};
const ROW_ITEM_LABELS: Record<SidebarRowItem, string> = {
  host: "Host",
  changeRequest: "Pull request",
  services: "Services",
};
const CHECKS_LABELS: Record<SidebarChecksDisplay, string> = {
  iconAndText: "Icon and text",
  icon: "Icon only",
  none: "Hidden",
};
const TRAILING_LABELS: Record<SidebarTrailingChoice, string> = {
  diff: "Diff stat",
  timestamp: "Timestamp",
};

export function SidebarDisplayPreferencesMenu(): ReactElement {
  const preferences = useSidebarDisplayPreferences();
  const hosts = useHosts();
  const showHostFilter = hosts.length > 1;
  const triggerStyle = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered: boolean }) => [
      styles.trigger,
      hovered && styles.triggerHovered,
    ],
    [],
  );

  const pages = useMemo<MenuPageDefinition[]>(() => {
    const definitions: MenuPageDefinition[] = [
      {
        id: "titleSource",
        title: "Workspace title",
        content: (Object.keys(TITLE_LABELS) as WorkspaceTitleSource[]).map((value) => (
          <OptionItem
            key={value}
            value={value}
            label={TITLE_LABELS[value]}
            selected={preferences.titleSource === value}
            onSelect={preferences.setTitleSource}
            testID={`sidebar-workspace-title-source-${value}`}
          />
        )),
      },
      { id: "show", title: "Show", content: <ShowPage preferences={preferences} /> },
      {
        id: "checks",
        title: "Checks",
        content: SIDEBAR_CHECKS_DISPLAYS.map((value) => (
          <OptionItem
            key={value}
            value={value}
            label={CHECKS_LABELS[value]}
            selected={preferences.checksDisplay === value}
            onSelect={preferences.setChecksDisplay}
            testID={`sidebar-checks-display-${value}`}
          />
        )),
      },
    ];
    if (showHostFilter) {
      definitions.push({
        id: "hostFilter",
        title: "Hosts",
        content: <HostFilterPage preferences={preferences} hosts={hosts} />,
      });
    }
    return definitions;
  }, [hosts, preferences, showHostFilter]);

  return (
    <MenuRoot compactMode="sheet">
      <MenuTrigger
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel="Display preferences"
        testID="sidebar-display-preferences-menu"
      >
        <ThemedSettings2 size={14} uniProps={mutedIconMapping} />
      </MenuTrigger>
      <MenuSurface
        align="end"
        width={MENU_WIDTH}
        pages={pages}
        sheetTitle="Display preferences"
        testID="sidebar-display-preferences-content"
      >
        <MenuSubTrigger id="titleSource" value={TITLE_LABELS[preferences.titleSource]}>
          Workspace title
        </MenuSubTrigger>
        <MenuSubTrigger id="show">Show</MenuSubTrigger>
        {showHostFilter ? (
          <>
            <MenuSeparator />
            <MenuSubTrigger id="hostFilter" indicator={preferences.hostFilters.length > 0}>
              Hosts
            </MenuSubTrigger>
          </>
        ) : null}
      </MenuSurface>
    </MenuRoot>
  );
}

type Preferences = ReturnType<typeof useSidebarDisplayPreferences>;

function OptionItem<Value extends string>({
  value,
  label,
  selected,
  closeOnSelect = true,
  onSelect,
  testID,
}: {
  value: Value;
  label: string;
  selected: boolean;
  closeOnSelect?: boolean;
  onSelect: (value: Value) => void;
  testID: string;
}): ReactElement {
  const handleSelect = useCallback(() => onSelect(value), [onSelect, value]);
  return (
    <MenuItem
      selected={selected}
      closeOnSelect={closeOnSelect}
      onSelect={handleSelect}
      testID={testID}
    >
      {label}
    </MenuItem>
  );
}

function ShowPage({ preferences }: { preferences: Preferences }): ReactElement {
  return (
    <>
      {SIDEBAR_ROW_ITEMS.map((item) => (
        <OptionItem
          key={item}
          value={item}
          label={ROW_ITEM_LABELS[item]}
          selected={preferences.rowItems[item]}
          closeOnSelect={false}
          onSelect={preferences.toggleRowItem}
          testID={`sidebar-row-item-${item}`}
        />
      ))}
      <MenuSubTrigger id="checks">Checks</MenuSubTrigger>
      <MenuSeparator />
      {(Object.keys(TRAILING_LABELS) as SidebarTrailingChoice[]).map((choice) => (
        <OptionItem
          key={choice}
          value={choice}
          label={TRAILING_LABELS[choice]}
          selected={preferences.trailing === choice}
          closeOnSelect={false}
          onSelect={preferences.toggleTrailing}
          testID={`sidebar-workspace-trailing-${choice}`}
        />
      ))}
    </>
  );
}

function HostFilterPage({
  preferences,
  hosts,
}: {
  preferences: Preferences;
  hosts: ReturnType<typeof useHosts>;
}): ReactElement {
  return (
    <>
      <MenuItem
        selected={preferences.hostFilters.length === 0}
        closeOnSelect={false}
        onSelect={preferences.clearHostFilters}
        testID="sidebar-host-filter-all"
      >
        All hosts
      </MenuItem>
      {hosts.map((host) => (
        <HostFilterItem
          key={host.serverId}
          serverId={host.serverId}
          label={host.label.trim() || host.serverId}
          selected={preferences.hostFilters.includes(host.serverId)}
          onToggle={preferences.toggleHostFilter}
        />
      ))}
    </>
  );
}

function HostFilterItem({
  serverId,
  label,
  selected,
  onToggle,
}: {
  serverId: string;
  label: string;
  selected: boolean;
  onToggle: (serverId: string) => void;
}): ReactElement {
  const handleSelect = useCallback(() => onToggle(serverId), [onToggle, serverId]);
  const leading = useMemo(
    () => (
      <View testID={`sidebar-host-filter-status-${serverId}`}>
        <HostStatusDot serverId={serverId} />
      </View>
    ),
    [serverId],
  );
  return (
    <MenuItem
      selected={selected}
      closeOnSelect={false}
      leading={leading}
      onSelect={handleSelect}
      testID={`sidebar-host-filter-${serverId}`}
    >
      {label}
    </MenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
}));
