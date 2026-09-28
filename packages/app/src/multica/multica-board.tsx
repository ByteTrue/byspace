import { type ReactElement, type Ref, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useRouter } from "expo-router";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Bell, KanbanSquare, List, UserRound, UsersRound } from "lucide-react-native";

import { buildHostWorkspaceRoute } from "@/utils/host-routes";

import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import type { MulticaIssueSummary } from "@bytetrue/protocol/multica/rpc-schemas";
import { IssueMetaLine } from "@/multica/multica-activity";
import { useMulticaCatalog } from "@/multica/multica-catalog";
import { MULTICA_SECRETARY_WORKSPACE_TITLE } from "@bytetrue/protocol/multica/rpc-schemas";

/**
 * The multica board: status columns with issue cards, after the reference
 * product's board layout — plus its interaction surface: drag a card within
 * a column or across columns (status and position written together, the
 * source's DragMoveUpdates semantics), a List view over the same data, and
 * filter chips over status, priority and assignee.
 *
 * Card order is the store's order (position ASC, then created_at DESC, then
 * number DESC): position ranks a card within its column, and every move
 * writes a position, so the board never re-sorts by anything else.
 */
export function MulticaBoard({ serverId }: { serverId: string }): ReactElement {
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const online = runtimeSnapshot?.connectionStatus === "online";
  const router = useRouter();

  const [view, setView] = useState<"board" | "list">("board");
  const [filters, setFilters] = useState<MulticaFilters>(emptyFilters);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const statusesQuery = useFetchQuery({
    queryKey: ["multicaStatuses", serverId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaStatusList();
    },
    enabled: online,
    retry: false,
    dataShape: "value",
    staleTimeMs: 60_000,
  });

  const issuesQuery = useFetchQuery({
    queryKey: ["multicaIssues", serverId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaIssueList({});
    },
    enabled: online,
    retry: false,
    dataShape: "list",
    staleTimeMs: 3_000,
    refetchInterval: 5_000,
  });

  const live = useMulticaLiveState(serverId);
  const catalog = useMulticaCatalog(serverId);

  const openIssue = useCallback(
    (issueId: string) => {
      router.push(`/multica/issue?serverId=${serverId}&issueId=${issueId}`);
    },
    [router, serverId],
  );

  // The store already returns position order; filtering is the only
  // transformation the board applies.
  const issues = useMemo(() => {
    // Retired channel issues are tombstoned, not deleted — they keep their
    // history but no longer belong on the board.
    const work = (issuesQuery.data?.issues ?? []).filter(
      (issue) => !issue.title.startsWith("[retired]"),
    );
    return filterIssues(work, filters);
  }, [issuesQuery.data, filters]);

  const moveIssue = useCallback(
    (issue: MulticaIssueSummary, status: string, position: number) => {
      if (!client) return;
      const write = (): Promise<unknown> =>
        client.multicaIssueUpdate({
          issueId: issue.id,
          expectedRevision: issue.revision,
          status,
          position,
        });
      void write()
        .then(() => issuesQuery.refetch())
        .catch(() => issuesQuery.refetch());
    },
    [client, issuesQuery],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDraggingId(String(event.active.id));
  }, []);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggingId(null);
      const issue = issues.find((entry) => entry.id === String(event.active.id));
      const target = readDropTarget(event, issues);
      if (!issue || !target) {
        return;
      }
      if (issue.status === target.status && issue.position === target.position) {
        return;
      }
      moveIssue(issue, target.status, target.position);
    },
    [issues, moveIssue],
  );
  const handleDragCancel = useCallback(() => setDraggingId(null), []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const statuses = (statusesQuery.data?.statuses ?? []).filter(
    (status) => status.category !== "closed",
  );
  const draggingIssue = draggingId
    ? (issues.find((issue) => issue.id === draggingId) ?? null)
    : null;
  const setViewToBoard = useCallback(() => setView("board"), []);
  const setViewToList = useCallback(() => setView("list"), []);

  if (issuesQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <KanbanSquare size={18} color="#888" />
        <Text style={styles.heading}>Board</Text>
        <Text style={styles.headerCount}>
          {issues.length} {issues.length === 1 ? "issue" : "issues"}
        </Text>
        <View style={styles.displayToggle}>
          <ViewToggle active={view === "board"} label="Board" onPress={setViewToBoard} />
          <ViewToggle active={view === "list"} label="List" onPress={setViewToList} />
        </View>
        <InboxBell unread={live.inboxUnread} />
        {live.workingAgentIds.size > 0 ? (
          <View style={styles.workingPill}>
            <View style={styles.workingDot} />
            <Text style={styles.workingPillText}>
              {live.workingAgentIds.size} {live.workingAgentIds.size === 1 ? "agent" : "agents"}{" "}
              working
            </Text>
          </View>
        ) : null}
        <RostersPill serverId={serverId} />
        {live.secretaryWorkspaceId ? (
          <SecretaryPill serverId={serverId} workspaceId={live.secretaryWorkspaceId} />
        ) : null}
      </View>
      <FilterBar
        statuses={statuses.map((status) => ({ key: status.key, name: status.name }))}
        filters={filters}
        agents={catalog.agents}
        onFilters={setFilters}
      />
      {view === "board" ? (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <ScrollView horizontal contentContainerStyle={styles.lanes}>
            {statuses.map((status) => (
              <BoardColumn
                key={status.key}
                statusKey={status.key}
                title={status.name}
                color={status.color}
                issues={issues.filter((issue) => issue.status === status.key)}
                agentNameById={catalog.agentNameById}
                workingIssueIds={live.workingIssueIds}
                onOpen={openIssue}
              />
            ))}
          </ScrollView>
          <DragOverlay dropAnimation={null}>
            {draggingIssue ? (
              <View style={styles.overlayCard}>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {draggingIssue.title}
                </Text>
              </View>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <IssueList
          issues={issues}
          statusColorByKey={new Map(statuses.map((status) => [status.key, status.color]))}
          agentNameById={catalog.agentNameById}
          onOpen={openIssue}
        />
      )}
    </View>
  );
}

interface MulticaFilters {
  readonly statuses: readonly string[];
  readonly priorities: readonly string[];
  readonly assignees: readonly string[];
}

const emptyFilters: MulticaFilters = { statuses: [], priorities: [], assignees: [] };

const PRIORITY_OPTIONS = ["urgent", "high", "medium", "low", "none"] as const;

function filterIssues(
  issues: readonly MulticaIssueSummary[],
  filters: MulticaFilters,
): MulticaIssueSummary[] {
  return issues.filter(
    (issue) =>
      (filters.statuses.length === 0 || filters.statuses.includes(issue.status)) &&
      (filters.priorities.length === 0 || filters.priorities.includes(issue.priority)) &&
      (filters.assignees.length === 0 ||
        (issue.assigneeId !== null && filters.assignees.includes(issue.assigneeId))),
  );
}

/**
 * Where a drop landed: a column body or a card. The position is the slot at
 * the insertion index — above the first, below the last, or the midpoint
 * between two neighbours; an empty column starts at the store's top slot.
 */
function readDropTarget(
  event: DragEndEvent,
  issues: readonly MulticaIssueSummary[],
): { status: string; position: number } | null {
  const over = event.over;
  if (!over) {
    return null;
  }
  const overId = String(over.id);
  const draggedId = String(event.active.id);
  if (overId.startsWith("column:")) {
    const status = overId.slice("column:".length);
    const column = issues.filter((issue) => issue.status === status && issue.id !== draggedId);
    return { status, position: slotPosition(column, column.length) };
  }
  const overIssue = issues.find((issue) => issue.id === overId);
  if (!overIssue) {
    return null;
  }
  const column = issues.filter(
    (issue) => issue.status === overIssue.status && issue.id !== draggedId,
  );
  const index = column.findIndex((issue) => issue.id === overId);
  return { status: overIssue.status, position: slotPosition(column, index) };
}

function slotPosition(column: readonly MulticaIssueSummary[], index: number): number {
  if (column.length === 0) {
    return -1;
  }
  if (index <= 0) {
    return column[0].position - 1;
  }
  if (index >= column.length) {
    return column[column.length - 1].position + 1;
  }
  return (column[index - 1].position + column[index].position) / 2;
}

function ViewToggle({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      style={[styles.viewToggleItem, active && styles.viewToggleItemActive]}
      onPress={onPress}
      testID={`multica-view-${label.toLowerCase()}`}
    >
      {label === "Board" ? (
        <KanbanSquare size={12} color="#888" />
      ) : (
        <List size={12} color="#888" />
      )}
      <Text style={[styles.viewToggleText, active && styles.viewToggleTextActive]}>{label}</Text>
    </Pressable>
  );
}

function FilterBar({
  statuses,
  filters,
  agents,
  onFilters,
}: {
  statuses: readonly { key: string; name: string }[];
  filters: MulticaFilters;
  agents: readonly { id: string; name: string }[];
  onFilters: (filters: MulticaFilters) => void;
}): ReactElement {
  const hasFilters =
    filters.statuses.length > 0 || filters.priorities.length > 0 || filters.assignees.length > 0;
  const handleClear = useCallback(() => onFilters(emptyFilters), [onFilters]);
  return (
    <ScrollView horizontal contentContainerStyle={styles.filterBar}>
      {statuses.map((status) => (
        <FilterChipToggle
          key={status.key}
          label={status.name}
          group="statuses"
          value={status.key}
          active={filters.statuses.includes(status.key)}
          filters={filters}
          onFilters={onFilters}
        />
      ))}
      <View style={styles.filterDivider} />
      {PRIORITY_OPTIONS.map((priority) => (
        <FilterChipToggle
          key={priority}
          label={priority}
          group="priorities"
          value={priority}
          active={filters.priorities.includes(priority)}
          filters={filters}
          onFilters={onFilters}
        />
      ))}
      <View style={styles.filterDivider} />
      {agents.map((agent) => (
        <FilterChipToggle
          key={agent.id}
          label={agent.name}
          group="assignees"
          value={agent.id}
          active={filters.assignees.includes(agent.id)}
          filters={filters}
          onFilters={onFilters}
        />
      ))}
      {hasFilters ? (
        <Pressable style={styles.filterClear} onPress={handleClear} testID="multica-filter-clear">
          <Text style={styles.filterClearText}>Clear</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function FilterChipToggle({
  label,
  group,
  value,
  active,
  filters,
  onFilters,
}: {
  label: string;
  group: keyof MulticaFilters;
  value: string;
  active: boolean;
  filters: MulticaFilters;
  onFilters: (filters: MulticaFilters) => void;
}): ReactElement {
  const handlePress = useCallback(() => {
    const current = filters[group];
    const next = current.includes(value)
      ? current.filter((entry) => entry !== value)
      : [...current, value];
    onFilters({ ...filters, [group]: next });
  }, [filters, group, value, onFilters]);
  return <FilterChip label={label} active={active} onPress={handlePress} />;
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      style={[styles.filterChip, active && styles.filterChipActive]}
      onPress={onPress}
      testID={`multica-filter-${label}`}
    >
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function IssueList({
  issues,
  statusColorByKey,
  agentNameById,
  onOpen,
}: {
  issues: readonly MulticaIssueSummary[];
  statusColorByKey: ReadonlyMap<string, string>;
  agentNameById: ReadonlyMap<string, string>;
  onOpen: (issueId: string) => void;
}): ReactElement {
  return (
    <ScrollView contentContainerStyle={styles.listBody}>
      {issues.map((issue) => (
        <IssueRow
          key={issue.id}
          issue={issue}
          color={statusColorByKey.get(issue.status) ?? "#999"}
          agentName={issue.assigneeId ? (agentNameById.get(issue.assigneeId) ?? null) : null}
          onOpen={onOpen}
        />
      ))}
      {issues.length === 0 ? <Text style={styles.listEmpty}>Nothing matches.</Text> : null}
    </ScrollView>
  );
}

function IssueRow({
  issue,
  color,
  agentName,
  onOpen,
}: {
  issue: MulticaIssueSummary;
  color: string;
  agentName: string | null;
  onOpen: (issueId: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onOpen(issue.id), [issue.id, onOpen]);
  return (
    <Pressable style={styles.listRow} onPress={handlePress} testID={`multica-list-row-${issue.id}`}>
      <View style={[styles.columnDot, { backgroundColor: color }]} />
      <Text style={styles.listRowTitle} numberOfLines={1}>
        {issue.title}
      </Text>
      <Text style={styles.cardNumber}>#{issue.number ?? "—"}</Text>
      <Text style={styles.listRowPriority}>{issue.priority}</Text>
      <Text style={styles.listRowAssignee} numberOfLines={1}>
        {agentName ?? "unassigned"}
      </Text>
    </Pressable>
  );
}

/** The rosters' front door: agents and squads, the two management faces. */
function RostersPill({ serverId }: { serverId: string }): ReactElement {
  const router = useRouter();
  const handlePress = useCallback(() => {
    router.push(`/multica/agents?serverId=${serverId}`);
  }, [router, serverId]);
  return (
    <Pressable style={styles.officePill} onPress={handlePress} testID="multica-rosters-entry">
      <UsersRound size={13} color="#888" />
      <Text style={styles.officePillText}>Rosters</Text>
    </Pressable>
  );
}

function InboxBell({ unread }: { unread: number }): ReactElement {
  const router = useRouter();
  const handlePress = useCallback(() => {
    router.push("/multica-inbox");
  }, [router]);
  return (
    <Pressable style={styles.bell} onPress={handlePress} testID="multica-inbox-entry">
      <Bell size={15} color="#888" />
      {unread > 0 ? (
        <View style={styles.bellBadge}>
          <Text style={styles.bellBadgeText}>{unread}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * The owner's front door: the secretary's standing workspace. It opens the
 * repo's ordinary workspace surface — chats, composer, terminals — because
 * talking to the secretary is talking to an agent, not using a bespoke UI.
 */
function SecretaryPill({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}): ReactElement {
  const router = useRouter();
  const handlePress = useCallback(() => {
    router.push(buildHostWorkspaceRoute(serverId, workspaceId));
  }, [router, serverId, workspaceId]);
  return (
    <Pressable style={styles.officePill} onPress={handlePress} testID="multica-secretary-entry">
      <UserRound size={13} color="#888" />
      <Text style={styles.officePillText}>Chief of Staff</Text>
    </Pressable>
  );
}

function BoardColumn({
  statusKey,
  title,
  color,
  issues,
  agentNameById,
  workingIssueIds,
  onOpen,
}: {
  statusKey: string;
  title: string;
  color: string;
  issues: readonly MulticaIssueSummary[];
  agentNameById: ReadonlyMap<string, string>;
  workingIssueIds: ReadonlySet<string>;
  onOpen: (issueId: string) => void;
}): ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${statusKey}` });
  return (
    <View style={styles.column}>
      <View style={styles.columnHeader}>
        <View style={[styles.columnDot, { backgroundColor: color }]} />
        <Text style={styles.columnTitle}>{title}</Text>
        <Text style={styles.columnCount}>{issues.length}</Text>
      </View>
      <View
        ref={setNodeRef as unknown as Ref<View>}
        style={[styles.columnBody, isOver && styles.columnBodyOver]}
        testID={`multica-column-${statusKey}`}
      >
        <ScrollView contentContainerStyle={styles.columnList}>
          {issues.map((issue) => (
            <DraggableCard
              key={issue.id}
              issue={issue}
              agentName={issue.assigneeId ? (agentNameById.get(issue.assigneeId) ?? null) : null}
              working={workingIssueIds.has(issue.id)}
              onOpen={onOpen}
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function DraggableCard({
  issue,
  agentName,
  working,
  onOpen,
}: {
  issue: MulticaIssueSummary;
  agentName: string | null;
  working: boolean;
  onOpen: (issueId: string) => void;
}): ReactElement {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: issue.id });
  const handlePress = useCallback(() => onOpen(issue.id), [issue.id, onOpen]);
  return (
    <View
      ref={setNodeRef as unknown as Ref<View>}
      {...(listeners as Record<string, unknown>)}
      {...(attributes as unknown as Record<string, unknown>)}
    >
      <Pressable style={styles.card} onPress={handlePress} testID={`multica-issue-${issue.id}`}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {issue.title}
        </Text>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardNumber}>#{issue.number ?? "—"}</Text>
          {issue.priority !== "none" && issue.priority !== null ? (
            <Text style={styles.cardPriority}>{issue.priority}</Text>
          ) : null}
          {working ? (
            <View style={styles.cardWorking}>
              <View style={styles.workingDot} />
              <Text style={styles.cardWorkingText}>Working</Text>
            </View>
          ) : null}
        </View>
        <IssueMetaLine
          actorName={agentName}
          actorId={issue.assigneeId}
          updatedAt={issue.updatedAt}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  page: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[4],
  },
  heading: { color: theme.colors.foreground, fontSize: theme.fontSize.base, fontWeight: "600" },
  headerCount: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  displayToggle: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    overflow: "hidden",
  },
  viewToggleItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: theme.spacing[2],
  },
  viewToggleItemActive: { backgroundColor: theme.colors.surface2 },
  viewToggleText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  viewToggleTextActive: { color: theme.colors.foreground },
  filterBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[2],
  },
  filterDivider: {
    width: 1,
    height: 14,
    backgroundColor: theme.colors.border,
    marginHorizontal: 4,
  },
  filterChip: {
    paddingVertical: 2,
    paddingHorizontal: theme.spacing[2],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  filterChipActive: { backgroundColor: theme.colors.surface2 },
  filterChipText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  filterChipTextActive: { color: theme.colors.foreground },
  filterClear: { paddingVertical: 2, paddingHorizontal: theme.spacing[2] },
  filterClearText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  officePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    marginLeft: "auto",
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: 999,
    backgroundColor: theme.colors.surface2,
  },
  officePillText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  lanes: {
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[4],
  },
  column: { width: 252 },
  columnHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  columnDot: { width: 8, height: 8, borderRadius: 4 },
  columnTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, fontWeight: "600" },
  columnCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginLeft: "auto",
  },
  columnBody: { minHeight: 120 },
  columnBodyOver: { backgroundColor: theme.colors.surface2, borderRadius: theme.borderRadius.md },
  columnList: { gap: theme.spacing[1] },
  card: {
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    gap: theme.spacing[1],
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, fontWeight: "500" },
  cardHeaderRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  cardNumber: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  cardPriority: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textTransform: "uppercase",
  },
  overlayCard: {
    width: 240,
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.foreground,
  },
  workingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: 999,
    backgroundColor: theme.colors.surface2,
  },
  workingPillText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  bell: { flexDirection: "row", alignItems: "center", padding: theme.spacing[1] },
  bellBadge: {
    marginLeft: 3,
    paddingHorizontal: 4,
    borderRadius: 999,
    backgroundColor: "#ef4444",
  },
  bellBadgeText: { color: "#fff", fontSize: 10, fontWeight: "600" },
  workingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#f59e0b" },
  cardWorking: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginLeft: "auto",
  },
  cardWorkingText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  listBody: { paddingHorizontal: theme.spacing[4], paddingBottom: theme.spacing[4], gap: 2 },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.sm,
  },
  listRowTitle: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  listRowPriority: {
    width: 60,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textTransform: "uppercase",
  },
  listRowAssignee: {
    width: 120,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  listEmpty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[3],
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
}));

/**
 * The board's live layer: which issues have work in flight right now, and
 * where the secretary's standing workspace lives. Both are lookups over
 * existing surfaces (the task queue and the workspace registry) that the
 * board alone consumes, so they sit next to the board rather than in the
 * shared catalog.
 */
function useMulticaLiveState(serverId: string): {
  workingIssueIds: ReadonlySet<string>;
  workingAgentIds: ReadonlySet<string>;
  secretaryWorkspaceId: string | null;
  inboxUnread: number;
} {
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const online = runtimeSnapshot?.connectionStatus === "online";

  const runningQuery = useFetchQuery({
    queryKey: ["multicaRunningTasks", serverId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaTaskRunningList();
    },
    enabled: online,
    retry: false,
    dataShape: "value",
    staleTimeMs: 2_000,
    refetchInterval: 3_000,
  });

  const inboxQuery = useFetchQuery({
    queryKey: ["multicaInboxUnread", serverId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaInboxList();
    },
    enabled: online,
    retry: false,
    dataShape: "value",
    staleTimeMs: 2_000,
    refetchInterval: 5_000,
  });

  const workspacesQuery = useFetchQuery({
    queryKey: ["multicaWorkspaces", serverId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.fetchWorkspaces();
    },
    enabled: online,
    retry: false,
    dataShape: "list",
    staleTimeMs: 10_000,
  });

  // The badge answers "is anyone working on this issue right now", so it
  // keys on the running task's issue — the card's assignee may be unset
  // (work claimed by mention, like the reference product's comment flows).
  const workingIssueIds = useMemo(() => {
    const set = new Set<string>();
    for (const task of runningQuery.data?.tasks ?? []) {
      // run_only autopilot tasks carry no issue: they put no badge anywhere.
      if (task.issueId !== null) {
        set.add(task.issueId);
      }
    }
    return set;
  }, [runningQuery.data]);

  const workingAgentIds = useMemo(() => {
    const set = new Set<string>();
    for (const task of runningQuery.data?.tasks ?? []) {
      set.add(task.agentId);
    }
    return set;
  }, [runningQuery.data]);

  const secretaryWorkspaceId = useMemo(
    () =>
      (workspacesQuery.data?.entries ?? []).find(
        (workspace) => workspace.name === MULTICA_SECRETARY_WORKSPACE_TITLE,
      )?.id ?? null,
    [workspacesQuery.data],
  );

  return {
    workingIssueIds,
    workingAgentIds,
    secretaryWorkspaceId,
    inboxUnread: inboxQuery.data?.unread ?? 0,
  };
}
