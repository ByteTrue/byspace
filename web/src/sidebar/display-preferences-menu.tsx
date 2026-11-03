import { useCallback, useMemo, useState, type ComponentType, type ReactNode } from "react";
import {
  Captions,
  Circle,
  CircleCheck,
  CircleDashed,
  Clock,
  Diff,
  EyeOff,
  Folder,
  GitBranch,
  GitPullRequest,
  Globe,
  Server,
  Settings2,
  Tag,
  Type,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { workspaceLabelKey } from "@bytetrue/protocol/workspace-labels";
import {
  SIDEBAR_CHECKS_DISPLAYS,
  type SidebarChecksDisplay,
} from "@/components/sidebar/display-preferences/checks-display";
import {
  useSidebarDisplayPreferences,
  type SidebarTrailingChoice,
} from "@/components/sidebar/display-preferences/model";
import {
  SIDEBAR_ROW_ITEMS,
  type SidebarRowItem,
} from "@/components/sidebar/display-preferences/row-items";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import type { WorkspaceTitleSource } from "@/hooks/use-settings";
import { useHosts } from "@/runtime/host-runtime";
import {
  hasActiveSidebarLabelFilter,
  SIDEBAR_UNLABELLED_LABEL_KEY,
  type SidebarGroupMode,
} from "@/stores/sidebar-view-store";
import { resolveSidebarProjectIconTargets } from "@/utils/sidebar-project-row-model";
import { useProjectIcons } from "@/projects/icons";
import { useWorkspaceLabelProjection } from "@/workspace-labels";
import { keepOpen } from "~/components/menu-kit";
import { HostStatusDot } from "~/components/host-status-dot";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { ProjectIcon } from "~/sidebar/status-visuals";
import { SidebarIconButton } from "~/sidebar/sidebar-icon-button";
import { WorkspaceLabelManagerModal } from "@/workspace-labels/manager-modal";
import { WorkspaceLabelDot } from "@/workspace-labels/swatch";

type Icon = ComponentType<{ className?: string }>;

const GROUPING: ReadonlyArray<[SidebarGroupMode, Icon, string]> = [
  ["project", Folder, "sidebar.display.grouping.project"],
  ["status", CircleDashed, "sidebar.display.grouping.status"],
];
const TITLE_SOURCES: ReadonlyArray<[WorkspaceTitleSource, Icon, string]> = [
  ["title", Type, "sidebar.display.titleSource.title"],
  ["branch", GitBranch, "sidebar.display.titleSource.branch"],
];
const ROW_ITEMS: Record<SidebarRowItem, [Icon, string]> = {
  branch: [GitBranch, "sidebar.display.show.branch"],
  project: [Folder, "sidebar.display.show.project"],
  host: [Server, "sidebar.display.show.host"],
  changeRequest: [GitPullRequest, "sidebar.display.show.changeRequest"],
  services: [Globe, "sidebar.display.show.services"],
  labels: [Tag, "sidebar.display.show.labels"],
};
const CHECKS_DISPLAYS: Record<SidebarChecksDisplay, [Icon, string]> = {
  iconAndText: [Captions, "sidebar.display.checks.iconAndText"],
  icon: [CircleCheck, "sidebar.display.checks.icon"],
  none: [EyeOff, "sidebar.display.checks.none"],
};
const TRAILING: ReadonlyArray<[SidebarTrailingChoice, Icon, string]> = [
  ["diff", Diff, "sidebar.display.show.diff"],
  ["timestamp", Clock, "sidebar.display.show.timestamp"],
];

/** Marks a submenu whose filter is narrowing the list, so it shows from the root without opening it. */
function FilterIndicator({ on }: { on: boolean }) {
  return on ? (
    <span
      className="-mr-0.5 ml-auto size-1.5 rounded-full bg-primary"
      aria-hidden="true"
      data-testid="menu-sub-indicator"
    />
  ) : null;
}

/** The current choice beside a submenu's label, pushed right against its chevron. */
function SubValue({ children }: { children: string }) {
  return (
    // -mr-0.5: the Expo app keeps 6px between a submenu's value and its chevron (the row gap is 8).
    <span className="-mr-0.5 min-w-0 flex-1 truncate text-right text-muted-foreground">
      {children}
    </span>
  );
}

/** A checkbox row that toggles one value and keeps the menu open, as the Expo app's multi-selects do. */
function ToggleItem<T>({
  value,
  checked,
  onToggle,
  testId,
  children,
}: {
  value: T;
  checked: boolean;
  onToggle: (value: T) => void;
  testId: string;
  children: ReactNode;
}) {
  const handleSelect = useMemo(() => keepOpen(() => onToggle(value)), [onToggle, value]);
  return (
    <DropdownMenuCheckboxItem checked={checked} onSelect={handleSelect} data-testid={testId}>
      {children}
    </DropdownMenuCheckboxItem>
  );
}

/** A checkbox row that runs an action and keeps the menu open ("All hosts", "All projects"). */
function ActionToggleItem({
  checked,
  onSelect,
  testId,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  testId: string;
  children: ReactNode;
}) {
  const handleSelect = useMemo(() => keepOpen(onSelect), [onSelect]);
  return (
    <DropdownMenuCheckboxItem checked={checked} onSelect={handleSelect} data-testid={testId}>
      {children}
    </DropdownMenuCheckboxItem>
  );
}

/** A submenu holding one radio choice, its current value shown on the trigger. */
function RadioSubmenu<T extends string>({
  label,
  icon: TriggerIcon,
  showValue = true,
  value,
  options,
  onChange,
  triggerTestId,
  optionTestId,
}: {
  label: string;
  icon?: Icon;
  /** Root-level choices show their value on the trigger; nested ones (Checks) show an icon instead. */
  showValue?: boolean;
  value: T;
  options: ReadonlyArray<[T, Icon, string]>;
  onChange: (value: T) => void;
  triggerTestId: string;
  optionTestId: (value: T) => string;
}) {
  const { t } = useTranslation();
  const current = options.find(([option]) => option === value)?.[2];
  const handleChange = useCallback((next: string) => onChange(next as T), [onChange]);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid={triggerTestId}>
        {TriggerIcon ? <TriggerIcon /> : null}
        {label}
        {showValue && current ? <SubValue>{t(current)}</SubValue> : null}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup value={value} onValueChange={handleChange}>
          {options.map(([option, ItemIcon, labelKey]) => (
            <DropdownMenuRadioItem key={option} value={option} data-testid={optionTestId(option)}>
              <ItemIcon />
              {t(labelKey)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

const groupingTestId = (value: SidebarGroupMode) => `sidebar-grouping-${value}`;
const titleSourceTestId = (value: WorkspaceTitleSource) =>
  `sidebar-workspace-title-source-${value}`;
const checksDisplayTestId = (value: SidebarChecksDisplay) => `sidebar-checks-display-${value}`;
const CHECKS_OPTIONS: ReadonlyArray<[SidebarChecksDisplay, Icon, string]> =
  SIDEBAR_CHECKS_DISPLAYS.map((value) => [
    value,
    CHECKS_DISPLAYS[value][0],
    CHECKS_DISPLAYS[value][1],
  ]);

type DisplayPreferences = ReturnType<typeof useSidebarDisplayPreferences>;

function ShowSubmenu({ preferences }: { preferences: DisplayPreferences }) {
  const { t } = useTranslation();
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid="sidebar-display-show">
        {t("sidebar.display.show.label")}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {SIDEBAR_ROW_ITEMS.map((item) => {
          const [ItemIcon, labelKey] = ROW_ITEMS[item];
          return (
            <ToggleItem
              key={item}
              value={item}
              checked={preferences.rowItems[item]}
              onToggle={preferences.toggleRowItem}
              testId={`sidebar-row-item-${item}`}
            >
              <ItemIcon />
              {t(labelKey)}
            </ToggleItem>
          );
        })}
        <RadioSubmenu
          label={t("sidebar.display.show.checks")}
          icon={CircleCheck}
          showValue={false}
          value={preferences.checksDisplay}
          options={CHECKS_OPTIONS}
          onChange={preferences.setChecksDisplay}
          triggerTestId="sidebar-display-checks"
          optionTestId={checksDisplayTestId}
        />
        <DropdownMenuSeparator />
        {TRAILING.map(([choice, ItemIcon, labelKey]) => (
          <ToggleItem
            key={choice}
            value={choice}
            checked={preferences.trailing === choice}
            onToggle={preferences.toggleTrailing}
            testId={`sidebar-workspace-trailing-${choice}`}
          >
            <ItemIcon />
            {t(labelKey)}
          </ToggleItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function HostFilterSubmenu({ preferences }: { preferences: DisplayPreferences }) {
  const { t } = useTranslation();
  const hosts = useHosts();
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid="sidebar-display-host-filter">
        {t("sidebar.display.hostFilter.label")}
        <FilterIndicator on={preferences.hostFilters.length > 0} />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <ActionToggleItem
          checked={preferences.hostFilters.length === 0}
          onSelect={preferences.clearHostFilters}
          testId="sidebar-host-filter-all"
        >
          {t("sidebar.display.hostFilter.all")}
        </ActionToggleItem>
        {hosts.map((host) => (
          <ToggleItem
            key={host.serverId}
            value={host.serverId}
            checked={preferences.hostFilters.includes(host.serverId)}
            onToggle={preferences.toggleHostFilter}
            testId={`sidebar-host-filter-${host.serverId}`}
          >
            <span data-testid={`sidebar-host-filter-status-${host.serverId}`} className="flex">
              <HostStatusDot serverId={host.serverId} />
            </span>
            <span className="truncate">{host.label?.trim() || host.serverId}</span>
          </ToggleItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function ProjectFilterSubmenu({ preferences }: { preferences: DisplayPreferences }) {
  const { t } = useTranslation();
  const { allProjects, resolvedProjectFilters } = useSidebarModel();
  const iconTargets = useMemo(() => resolveSidebarProjectIconTargets(allProjects), [allProjects]);
  const iconByViewKey = useProjectIcons({ projects: iconTargets });
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid="sidebar-display-project-filter">
        {t("sidebar.display.projectFilter.label")}
        <FilterIndicator on={resolvedProjectFilters.length > 0} />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto">
        <ActionToggleItem
          checked={resolvedProjectFilters.length === 0}
          onSelect={preferences.clearProjectFilters}
          testId="sidebar-project-filter-all"
        >
          {t("sidebar.display.projectFilter.all")}
        </ActionToggleItem>
        {allProjects.map((project) => (
          <ToggleItem
            key={project.viewKey}
            value={project.viewKey}
            checked={resolvedProjectFilters.includes(project.viewKey)}
            onToggle={preferences.toggleProjectFilter}
            testId={`sidebar-project-filter-${project.viewKey}`}
          >
            <ProjectIcon
              iconDataUri={iconByViewKey.get(project.viewKey) ?? null}
              displayName={project.projectName}
              projectViewKey={project.viewKey}
              size={14}
            />
            <span className="truncate">{project.projectName}</span>
          </ToggleItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function LabelFilterSubmenu({
  preferences,
  onManage,
}: {
  preferences: DisplayPreferences;
  onManage: () => void;
}) {
  const { t } = useTranslation();
  const { labels } = useWorkspaceLabelProjection();
  const labelFilterActive = hasActiveSidebarLabelFilter(preferences.labelFilter);
  const clearFilter = useMemo(
    () => keepOpen(preferences.clearLabelFilter),
    [preferences.clearLabelFilter],
  );
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid="sidebar-display-label-filter">
        {t("workspaceLabels.title")}
        <FilterIndicator on={labelFilterActive} />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {labels.map((label) => (
          <ToggleItem
            key={workspaceLabelKey(label.name)}
            value={label.name}
            checked={preferences.labelFilter.labels.includes(workspaceLabelKey(label.name))}
            onToggle={preferences.toggleLabelFilter}
            testId={`sidebar-label-filter-option-${label.name}`}
          >
            {/* The Expo app's menu leading slot: the dot centred in a 16px box, on the icons' rail */}
            <span className="flex size-4 shrink-0 items-center justify-center">
              <WorkspaceLabelDot color={label.color} />
            </span>
            <span className="truncate">{label.name}</span>
          </ToggleItem>
        ))}
        <ToggleItem
          value={SIDEBAR_UNLABELLED_LABEL_KEY}
          checked={preferences.labelFilter.labels.includes(SIDEBAR_UNLABELLED_LABEL_KEY)}
          onToggle={preferences.toggleLabelFilter}
          testId="sidebar-label-filter-option-unlabelled"
        >
          {/* The Expo app's UNLABELLED_MARK: the dot's hollow stand-in, 11px, in the same slot */}
          <span className="flex size-4 shrink-0 items-center justify-center">
            <Circle size={11} className="text-muted-foreground" />
          </span>
          {t("workspaceLabels.unlabelled")}
        </ToggleItem>
        {labelFilterActive ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={clearFilter} data-testid="sidebar-label-filter-clear">
              {t("workspaceLabels.filter.clear")}
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onManage} data-testid="sidebar-label-manage">
          {t("workspaceLabels.manage.open")}
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** The Expo app's SidebarDisplayPreferencesMenu: grouping, titles, what each row shows, and filters. */
export function SidebarDisplayPreferencesMenu() {
  const { t } = useTranslation();
  const preferences = useSidebarDisplayPreferences();
  const hosts = useHosts();
  const { allProjects } = useSidebarModel();
  const { labels } = useWorkspaceLabelProjection();
  const [managerOpen, setManagerOpen] = useState(false);
  const openManager = useCallback(() => setManagerOpen(true), []);
  const closeManager = useCallback(() => setManagerOpen(false), []);
  const showHostFilter = hosts.length > 1;
  const showProjectFilter = allProjects.length > 1;
  const showLabelFilter = labels.length > 0 || hasActiveSidebarLabelFilter(preferences.labelFilter);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarIconButton
            label={t("sidebar.display.trigger")}
            data-testid="sidebar-display-preferences-menu"
            className="[&_svg]:size-3.5"
          >
            <Settings2 />
          </SidebarIconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-[232px]"
          data-testid="sidebar-display-preferences-content"
        >
          <RadioSubmenu
            label={t("sidebar.display.grouping.label")}
            value={preferences.grouping}
            options={GROUPING}
            onChange={preferences.setGrouping}
            triggerTestId="sidebar-display-grouping"
            optionTestId={groupingTestId}
          />
          <RadioSubmenu
            label={t("sidebar.display.titleSource.label")}
            value={preferences.titleSource}
            options={TITLE_SOURCES}
            onChange={preferences.setTitleSource}
            triggerTestId="sidebar-display-title-source"
            optionTestId={titleSourceTestId}
          />
          <ShowSubmenu preferences={preferences} />
          {showHostFilter || showProjectFilter ? <DropdownMenuSeparator /> : null}
          {showHostFilter ? <HostFilterSubmenu preferences={preferences} /> : null}
          {showProjectFilter ? <ProjectFilterSubmenu preferences={preferences} /> : null}
          {showLabelFilter ? (
            <>
              <DropdownMenuSeparator />
              <LabelFilterSubmenu preferences={preferences} onManage={openManager} />
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <WorkspaceLabelManagerModal visible={managerOpen} onClose={closeManager} />
    </>
  );
}
