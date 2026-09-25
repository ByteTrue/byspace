import { useCallback, useMemo, type ReactElement, type ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ChevronDown, Search } from "lucide-react-native";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { ICON_SIZE } from "@/styles/theme";
import {
  WORKER_SORT_OPTIONS,
  WORKER_STATUS_OPTIONS,
  type WorkerSort,
  type WorkerStatusFilter,
} from "@/workers/worker-filters";

/**
 * The roster's filter row.
 *
 * Laid out as the reference product has it: a search field, then one compact
 * dropdown per filter showing its label and current value, and the number of
 * workers the filters leave in view at the far end. That count is of the
 * *visible* set, because the row's job is to say what you are looking at.
 *
 * No environment filter. The reference's separates local from remote runs, and
 * this domain has no remote worker, so there is no field to filter on rather
 * than no data to show.
 */
export interface WorkerFilterBarProps {
  onSearchChange: (value: string) => void;
  status: WorkerStatusFilter;
  onStatusChange: (value: WorkerStatusFilter) => void;
  roleId: string | null;
  onRoleChange: (value: string | null) => void;
  roles: readonly { id: string; label: string }[];
  sort: WorkerSort;
  onSortChange: (value: WorkerSort) => void;
  visibleCount: number;
}

export function WorkerFilterBar({
  onSearchChange,
  status,
  onStatusChange,
  roleId,
  onRoleChange,
  roles,
  sort,
  onSortChange,
  visibleCount,
}: WorkerFilterBarProps): ReactElement {
  const statusLabel = labelFor(WORKER_STATUS_OPTIONS, status, "All");
  const sortLabel = labelFor(WORKER_SORT_OPTIONS, sort, "Default");
  const roleLabel =
    roleId === null ? "All roles" : (roles.find((role) => role.id === roleId)?.label ?? roleId);

  const statusItems = useMemo(
    () =>
      WORKER_STATUS_OPTIONS.map((option) => (
        <FilterMenuItem
          key={option.value}
          label={option.label}
          value={option.value}
          selected={option.value === status}
          onSelect={onStatusChange}
          testID={`worker-filter-status-${option.value}`}
        />
      )),
    [status, onStatusChange],
  );

  const roleItems = useMemo(
    () => [
      <FilterMenuItem
        key="__all"
        label="All roles"
        value={null}
        selected={roleId === null}
        onSelect={onRoleChange}
        testID="worker-filter-role-all"
      />,
      ...roles.map((role) => (
        <FilterMenuItem
          key={role.id}
          label={role.label}
          value={role.id}
          selected={role.id === roleId}
          onSelect={onRoleChange}
          testID={`worker-filter-role-${role.id}`}
        />
      )),
    ],
    [roles, roleId, onRoleChange],
  );

  const sortItems = useMemo(
    () =>
      WORKER_SORT_OPTIONS.map((option) => (
        <FilterMenuItem
          key={option.value}
          label={option.label}
          value={option.value}
          selected={option.value === sort}
          onSelect={onSortChange}
          testID={`worker-filter-sort-${option.value}`}
        />
      )),
    [sort, onSortChange],
  );

  return (
    <View style={styles.bar} testID="worker-filter-bar">
      <View style={styles.searchBox}>
        <Search size={ICON_SIZE.sm} />
        <View style={styles.searchInput}>
          <TextInput
            initialValue=""
            onChangeText={onSearchChange}
            placeholder="Search name or role…"
            testID="worker-search"
          />
        </View>
      </View>

      <FilterDropdown
        label="Runtime status"
        value={statusLabel}
        testID="worker-filter-status"
        items={statusItems}
      />
      <FilterDropdown
        label="Role"
        value={roleLabel}
        testID="worker-filter-role"
        items={roleItems}
      />
      <FilterDropdown
        label="Sort by"
        value={sortLabel}
        testID="worker-filter-sort"
        items={sortItems}
      />

      <Text style={styles.count} testID="worker-filter-count">
        {`${visibleCount} worker${visibleCount === 1 ? "" : "s"}`}
      </Text>
    </View>
  );
}

function labelFor<T extends string>(
  options: readonly { value: T; label: string }[],
  value: T,
  fallback: string,
): string {
  return options.find((option) => option.value === value)?.label ?? fallback;
}

/**
 * One filter control.
 *
 * The label sits inside the trigger beside the value, as the reference has it:
 * with three filters on one row, a label floating above each would spend a
 * second line saying what the value already implies.
 */
function FilterDropdown({
  label,
  value,
  testID,
  items,
}: {
  label: string;
  value: string;
  testID: string;
  items: ReactNode;
}): ReactElement {
  const triggerStyle = useMemo(() => [styles.trigger], []);
  const accessibilityLabel = useMemo(() => `${label}: ${value}`, [label, value]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        testID={testID}
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        <View style={styles.triggerContent}>
          <Text style={styles.triggerLabel}>{label}</Text>
          <Text style={styles.triggerValue}>{value}</Text>
          <ChevronDown size={ICON_SIZE.sm} />
        </View>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" minWidth={168} maxWidth={240}>
        {items}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One option.
 *
 * `selected` is the menu's own prop: it draws the check and nothing else, so a
 * chosen row does not also look filled in.
 */
function FilterMenuItem<TValue extends string | null>({
  label,
  value,
  selected,
  onSelect,
  testID,
}: {
  label: string;
  value: TValue;
  selected: boolean;
  onSelect: (value: TValue) => void;
  testID: string;
}): ReactElement {
  // Bound here rather than at the call site, so choosing an option is still one
  // stable function across renders.
  const handleSelect = useCallback(() => onSelect(value), [onSelect, value]);
  return (
    <DropdownMenuItem testID={testID} selected={selected} onSelect={handleSelect}>
      {label}
    </DropdownMenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexGrow: 1,
    flexBasis: 220,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  searchInput: { flex: 1, minWidth: 0 },
  trigger: {
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  triggerContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  triggerLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  triggerValue: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  count: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginLeft: "auto",
  },
}));
