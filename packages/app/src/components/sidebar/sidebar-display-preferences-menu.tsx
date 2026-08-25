import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Circle, Settings2 } from "lucide-react-native";
import {
  workspaceLabelKey,
  type WorkspaceLabelColor,
} from "@bytetrue/byspace-protocol/workspace-labels";
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
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { ProjectIconView } from "@/components/project-icon-view";
import { useProjectIconQuery, projectIconToDataUri } from "@/hooks/use-project-icon-query";
import { projectIconPlaceholderLabelFromDisplayName } from "@/utils/project-display-name";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { Theme } from "@/styles/theme";
import {
  hasActiveSidebarLabelFilter,
  SIDEBAR_UNLABELLED_LABEL_KEY,
} from "@/stores/sidebar-view-store";
import type { WorkspaceTitleSource } from "@/hooks/use-settings";
import { useWorkspaceLabelProjection } from "@/workspace-labels";
import { WorkspaceLabelDot } from "@/workspace-labels/swatch";
import { WorkspaceLabelManagerModal } from "@/workspace-labels/manager-modal";
import {
  SIDEBAR_CHECKS_DISPLAYS,
  type SidebarChecksDisplay,
} from "./display-preferences/checks-display";
import {
  useSidebarDisplayPreferences,
  type SidebarTrailingChoice,
} from "./display-preferences/model";
import { SIDEBAR_ROW_ITEMS, type SidebarRowItem } from "./display-preferences/row-items";

const ThemedSettings2 = withUnistyles(Settings2);
const ThemedCircle = withUnistyles(Circle);
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const MENU_WIDTH = 232;

/**
 * Unlabelled's stand-in for a color dot: the same circle at the same size, hollow.
 */
const UNLABELLED_MARK = <ThemedCircle size={11} uniProps={mutedIconMapping} />;

const TITLE_LABEL_KEYS: Record<WorkspaceTitleSource, string> = {
  title: "sidebar.display.titleSource.options.title",
  branch: "sidebar.display.titleSource.options.branch",
};
const ROW_ITEM_LABEL_KEYS: Record<SidebarRowItem, string> = {
  branch: "sidebar.display.show.branch",
  project: "sidebar.display.show.project",
  host: "sidebar.display.show.host",
  changeRequest: "sidebar.display.show.changeRequest",
  services: "sidebar.display.show.services",
  labels: "sidebar.display.show.labels",
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
  // `allProjects`, never `projects`: the model's `projects` is already filtered, so a picker fed
  // from it would lose the row that undoes the filter as soon as the filter narrowed to one.
  const { allProjects, resolvedProjectFilters } = useSidebarModel();
  const { labels } = useWorkspaceLabelProjection();
  const [managerOpen, setManagerOpen] = useState(false);
  const openManager = useCallback(() => setManagerOpen(true), []);
  const closeManager = useCallback(() => setManagerOpen(false), []);

  const triggerStyle = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered: boolean }) => [
      styles.trigger,
      hovered && styles.triggerHovered,
    ],
    [],
  );

  const showHostFilter = hosts.length > 1;
  // One project is the whole sidebar, so filtering to it is a no-op with a menu row attached.
  const showProjectFilter = allProjects.length > 1;
  // Nothing to filter by means no row at all. The active-filter half is not redundant: the merged
  // catalog only counts hosts that are online, so a host dropping off would otherwise take away
  // the only way back to a filter that is still hiding workspaces.
  const showLabelFilter = labels.length > 0 || hasActiveSidebarLabelFilter(preferences.labelFilter);

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
    if (showProjectFilter) {
      definitions.push({
        id: "projectFilter",
        title: t("sidebar.display.projectFilter.label"),
        content: (
          <ProjectFilterPage
            projects={allProjects}
            resolvedProjectFilters={resolvedProjectFilters}
            preferences={preferences}
          />
        ),
      });
    }
    if (showLabelFilter) {
      definitions.push({
        id: "labelFilter",
        title: t("workspaceLabels.title"),
        content: (
          <LabelFilterPage labels={labels} preferences={preferences} onManage={openManager} />
        ),
      });
    }
    return definitions;
  }, [
    hosts,
    preferences,
    showHostFilter,
    showProjectFilter,
    allProjects,
    resolvedProjectFilters,
    showLabelFilter,
    labels,
    openManager,
    t,
  ]);

  return (
    <>
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
          {showProjectFilter ? (
            <>
              {/* Host and Project narrow the same list, so they read as one block. The separator
                belongs above whichever of the two is showing first — with a single host there is
                no Host row and Project is what has to carry it. */}
              {showHostFilter ? null : <MenuSeparator />}
              <MenuSubTrigger
                id="projectFilter"
                indicator={resolvedProjectFilters.length > 0}
                testID="sidebar-display-project-filter"
              >
                {t("sidebar.display.projectFilter.label")}
              </MenuSubTrigger>
            </>
          ) : null}
          {showLabelFilter ? (
            <>
              <MenuSeparator />
              <MenuSubTrigger
                id="labelFilter"
                indicator={hasActiveSidebarLabelFilter(preferences.labelFilter)}
                testID="sidebar-display-label-filter"
              >
                {t("workspaceLabels.title")}
              </MenuSubTrigger>
            </>
          ) : null}
        </MenuSurface>
      </MenuRoot>
      <WorkspaceLabelManagerModal visible={managerOpen} onClose={closeManager} />
    </>
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

/**
 * Every label you could filter by, wherever it lives, one row each.
 */
function LabelFilterPage({
  labels,
  preferences,
  onManage,
}: {
  labels: ReturnType<typeof useWorkspaceLabelProjection>["labels"];
  preferences: Preferences;
  onManage: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const selected = preferences.labelFilter.labels;
  return (
    <>
      {labels.map((label) => (
        <LabelFilterItem
          key={workspaceLabelKey(label.name)}
          name={label.name}
          label={label.name}
          color={label.color}
          selected={selected.includes(workspaceLabelKey(label.name))}
          onToggle={preferences.toggleLabelFilter}
          testID={`sidebar-label-filter-option-${label.name}`}
        />
      ))}
      <LabelFilterItem
        name={SIDEBAR_UNLABELLED_LABEL_KEY}
        label={t("workspaceLabels.unlabelled")}
        color={null}
        selected={selected.includes(SIDEBAR_UNLABELLED_LABEL_KEY)}
        onToggle={preferences.toggleLabelFilter}
        testID="sidebar-label-filter-option-unlabelled"
      />
      {hasActiveSidebarLabelFilter(preferences.labelFilter) ? (
        <>
          <MenuSeparator />
          <MenuItem
            closeOnSelect={false}
            onSelect={preferences.clearLabelFilter}
            testID="sidebar-label-filter-clear"
          >
            {t("workspaceLabels.filter.clear")}
          </MenuItem>
        </>
      ) : null}
      <MenuSeparator />
      <MenuItem onSelect={onManage} testID="sidebar-label-manage">
        {t("workspaceLabels.manage.open")}
      </MenuItem>
    </>
  );
}

function LabelFilterItem({
  name,
  label,
  color,
  selected,
  onToggle,
  testID,
}: {
  /** The filter key this row acts on. Empty for Unlabelled — see `SIDEBAR_UNLABELLED_LABEL_KEY`. */
  name: string;
  label: string;
  /** `null` is Unlabelled, the one row with no color to stand for. */
  color: WorkspaceLabelColor | null;
  selected: boolean;
  onToggle: (name: string) => void;
  testID: string;
}): ReactElement {
  const handleSelect = useCallback(() => onToggle(name), [name, onToggle]);
  const leading = useMemo(
    () => (color ? <WorkspaceLabelDot color={color} /> : UNLABELLED_MARK),
    [color],
  );

  return (
    <MenuItem
      selected={selected}
      leading={leading}
      closeOnSelect={false}
      onSelect={handleSelect}
      testID={testID}
    >
      {label}
    </MenuItem>
  );
}

/**
 * Every project the sidebar could show, one row each.
 *
 * Selection reads `resolvedProjectFilters`, not the stored list. A stored key whose project is not
 * currently visible filters nothing, so showing it as checked here would contradict the sidebar.
 */
function ProjectFilterPage({
  projects,
  resolvedProjectFilters,
  preferences,
}: {
  projects: readonly SidebarProjectEntry[];
  resolvedProjectFilters: readonly string[];
  preferences: Preferences;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <>
      <MenuItem
        selected={resolvedProjectFilters.length === 0}
        closeOnSelect={false}
        onSelect={preferences.clearProjectFilters}
        testID="sidebar-project-filter-all"
      >
        {t("sidebar.display.projectFilter.all")}
      </MenuItem>
      {projects.map((project) => (
        <ProjectFilterItem
          key={project.projectKey}
          project={project}
          selected={resolvedProjectFilters.includes(project.projectKey)}
          onToggle={preferences.toggleProjectFilter}
        />
      ))}
    </>
  );
}

function ProjectFilterItem({
  project,
  selected,
  onToggle,
}: {
  project: SidebarProjectEntry;
  selected: boolean;
  onToggle: (projectKey: string) => void;
}): ReactElement {
  const handleSelect = useCallback(
    () => onToggle(project.projectKey),
    [onToggle, project.projectKey],
  );
  const host = project.hosts[0];
  const query = useProjectIconQuery({
    serverId: host?.serverId ?? "",
    cwd: host?.iconWorkingDir ?? project.iconWorkingDir ?? "",
  });
  const leading = useMemo(
    () => (
      <ProjectIconView
        iconDataUri={query.icon ? projectIconToDataUri(query.icon) : null}
        initial={projectIconPlaceholderLabelFromDisplayName(project.projectName)
          .charAt(0)
          .toUpperCase()}
        projectViewKey={project.projectKey}
        size={14}
        textStyle={styles.projectIconText}
      />
    ),
    [project.projectKey, project.projectName, query.icon],
  );

  return (
    <MenuItem
      selected={selected}
      leading={leading}
      closeOnSelect={false}
      onSelect={handleSelect}
      testID={`sidebar-project-filter-${project.projectKey}`}
    >
      {project.projectName}
    </MenuItem>
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
  projectIconText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
}));
