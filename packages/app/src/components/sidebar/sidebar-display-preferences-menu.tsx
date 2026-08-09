import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
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

const TITLE_LABEL_KEYS: Record<WorkspaceTitleSource, string> = {
  title: "sidebar.display.titleSource.options.title",
  branch: "sidebar.display.titleSource.options.branch",
};
const ROW_ITEM_LABEL_KEYS: Record<SidebarRowItem, string> = {
  host: "sidebar.display.show.host",
  changeRequest: "sidebar.display.show.changeRequest",
  services: "sidebar.display.show.services",
};
const CHECKS_LABEL_KEYS: Record<SidebarChecksDisplay, string> = {
  iconAndText: "sidebar.display.checks.options.iconAndText",
  icon: "sidebar.display.checks.options.icon",
  none: "sidebar.display.checks.options.none",
};
const TRAILING_LABEL_KEYS: Record<SidebarTrailingChoice, string> = {
  diff: "sidebar.display.show.diff",
  timestamp: "sidebar.display.show.timestamp",
};

export function SidebarDisplayPreferencesMenu(): ReactElement {
  const { t } = useTranslation();
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
        title: t("sidebar.display.titleSource.label"),
        content: (Object.keys(TITLE_LABEL_KEYS) as WorkspaceTitleSource[]).map((value) => (
          <OptionItem
            key={value}
            value={value}
            label={t(TITLE_LABEL_KEYS[value])}
            selected={preferences.titleSource === value}
            onSelect={preferences.setTitleSource}
            testID={`sidebar-workspace-title-source-${value}`}
          />
        )),
      },
      {
        id: "show",
        title: t("sidebar.display.show.label"),
        content: <ShowPage preferences={preferences} />,
      },
      {
        id: "checks",
        title: t("sidebar.display.checks.label"),
        content: SIDEBAR_CHECKS_DISPLAYS.map((value) => (
          <OptionItem
            key={value}
            value={value}
            label={t(CHECKS_LABEL_KEYS[value])}
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
        title: t("sidebar.display.hostFilter.label"),
        content: <HostFilterPage preferences={preferences} hosts={hosts} />,
      });
    }
    return definitions;
  }, [hosts, preferences, showHostFilter, t]);

  return (
    <MenuRoot compactMode="sheet">
      <MenuTrigger
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel={t("sidebar.display.trigger")}
        testID="sidebar-display-preferences-menu"
      >
        <ThemedSettings2 size={14} uniProps={mutedIconMapping} />
      </MenuTrigger>
      <MenuSurface
        align="end"
        width={MENU_WIDTH}
        pages={pages}
        sheetTitle={t("sidebar.display.trigger")}
        testID="sidebar-display-preferences-content"
      >
        <MenuSubTrigger id="titleSource" value={t(TITLE_LABEL_KEYS[preferences.titleSource])}>
          {t("sidebar.display.titleSource.label")}
        </MenuSubTrigger>
        <MenuSubTrigger id="show">{t("sidebar.display.show.label")}</MenuSubTrigger>
        {showHostFilter ? (
          <>
            <MenuSeparator />
            <MenuSubTrigger id="hostFilter" indicator={preferences.hostFilters.length > 0}>
              {t("sidebar.display.hostFilter.label")}
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
  const { t } = useTranslation();
  return (
    <>
      {SIDEBAR_ROW_ITEMS.map((item) => (
        <OptionItem
          key={item}
          value={item}
          label={t(ROW_ITEM_LABEL_KEYS[item])}
          selected={preferences.rowItems[item]}
          closeOnSelect={false}
          onSelect={preferences.toggleRowItem}
          testID={`sidebar-row-item-${item}`}
        />
      ))}
      <MenuSubTrigger id="checks">{t("sidebar.display.show.checks")}</MenuSubTrigger>
      <MenuSeparator />
      {(Object.keys(TRAILING_LABEL_KEYS) as SidebarTrailingChoice[]).map((choice) => (
        <OptionItem
          key={choice}
          value={choice}
          label={t(TRAILING_LABEL_KEYS[choice])}
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
  const { t } = useTranslation();
  return (
    <>
      <MenuItem
        selected={preferences.hostFilters.length === 0}
        closeOnSelect={false}
        onSelect={preferences.clearHostFilters}
        testID="sidebar-host-filter-all"
      >
        {t("sidebar.display.hostFilter.all")}
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
