import { MulticaShell } from "@/multica/multica-nav";
import { type ReactElement, useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useRouter } from "expo-router";
import {
  Archive,
  ArchiveRestore,
  Bell,
  Check,
  Filter,
  Inbox,
  MoreHorizontal,
} from "lucide-react-native";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { useIsCompactFormFactor } from "@/constants/layout";
import { ActorAvatar, formatRelativeTime } from "@/multica/multica-activity";
import { useMulticaCatalog } from "@/multica/multica-catalog";
import type { MulticaInboxItemSummary } from "@bytetrue/protocol/multica/rpc-schemas";

/**
 * The owner's action inbox, after the reference product's inbox page: a
 * queue of items that need a human — severity-tagged, pointing at issues —
 * which reads live (runs escalate at any moment) and which the owner files
 * away as they deal with each one.
 *
 * Two views (live / archived), severity filters, and a detail pane with the
 * actions: open the issue, mark read or unread, archive or unarchive.
 */
export function MulticaInbox({ serverId }: { serverId: string }): ReactElement {
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const online = runtimeSnapshot?.connectionStatus === "online";
  const router = useRouter();
  const isCompact = useIsCompactFormFactor();
  const catalog = useMulticaCatalog(serverId);

  const [archivedView, setArchivedView] = useState(false);
  const [filters, setFilters] = useState<{ severities: string[]; unreadOnly: boolean }>({
    severities: [],
    unreadOnly: false,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const inboxQuery = useFetchQuery({
    queryKey: ["multicaInbox", serverId, archivedView, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaInboxList({ archived: archivedView });
    },
    enabled: online,
    retry: false,
    dataShape: "value",
    staleTimeMs: 2_000,
    refetchInterval: 5_000,
  });

  const items = useMemo(
    () =>
      (inboxQuery.data?.items ?? []).filter(
        (item) =>
          (filters.severities.length === 0 || filters.severities.includes(item.severity)) &&
          (!filters.unreadOnly || !item.read),
      ),
    [inboxQuery.data, filters],
  );
  const selected = items.find((item) => item.id === selectedId) ?? null;

  const mark = useCallback(
    async (item: MulticaInboxItemSummary, read: boolean): Promise<void> => {
      if (!client) return;
      await client.multicaInboxMark({ id: item.id, read });
      await inboxQuery.refetch();
    },
    [client, inboxQuery],
  );

  const bulk = useCallback(
    (verb: "read-all" | "archive-all" | "archive-all-read") => {
      if (!client) return;
      const call =
        verb === "read-all"
          ? client.multicaInboxMarkAll()
          : client.multicaInboxArchiveAll({ readOnly: verb === "archive-all-read" });
      void call.then(() => inboxQuery.refetch()).catch(() => inboxQuery.refetch());
    },
    [client, inboxQuery],
  );
  const archive = useCallback(
    async (item: MulticaInboxItemSummary, archived: boolean): Promise<void> => {
      if (!client) return;
      await client.multicaInboxArchive({ id: item.id, archived });
      setSelectedId((current) => (current === item.id ? null : current));
      await inboxQuery.refetch();
    },
    [client, inboxQuery],
  );
  const openIssue = useCallback(
    (issueId: string) => {
      router.push(`/multica/issue?serverId=${serverId}&issueId=${issueId}`);
    },
    [router, serverId],
  );

  const toggleView = useCallback(() => {
    setArchivedView((value) => !value);
    setSelectedId(null);
  }, []);
  const clearSelection = useCallback(() => {
    setSelectedId(null);
  }, []);

  const listPane = (
    <InboxListPane
      items={items}
      unread={inboxQuery.data?.unread ?? 0}
      archivedView={archivedView}
      filters={filters}
      selectedId={selectedId}
      agentNameById={catalog.agentNameById}
      onToggleView={toggleView}
      onFilters={setFilters}
      onBulk={bulk}
      onSelect={setSelectedId}
    />
  );
  const detailPane = selected ? (
    <InboxDetailPane
      item={selected}
      agentName={selected.actorId ? (catalog.agentNameById.get(selected.actorId) ?? null) : null}
      onMark={mark}
      onArchive={archive}
      onOpenIssue={openIssue}
    />
  ) : (
    <View style={styles.detailEmpty}>
      <Text style={styles.detailEmptyText}>Select an item to read it.</Text>
    </View>
  );

  if (isCompact) {
    return selected ? (
      <View style={styles.page}>
        <Pressable style={styles.backRow} onPress={clearSelection} testID="multica-inbox-back">
          <Text style={styles.backText}>← Inbox</Text>
        </Pressable>
        {detailPane}
      </View>
    ) : (
      <View style={styles.page}>{listPane}</View>
    );
  }
  return (
    <MulticaShell serverId={serverId} active="inbox">
      <View style={styles.page}>
        <View style={styles.wideSplit}>
          <View style={styles.wideList}>{listPane}</View>
          <View style={styles.wideDetail}>
            <ScrollView contentContainerStyle={styles.wideDetailContent}>{detailPane}</ScrollView>
          </View>
        </View>
      </View>
    </MulticaShell>
  );
}

function InboxListPane({
  items,
  unread,
  archivedView,
  filters,
  selectedId,
  agentNameById,
  onToggleView,
  onFilters,
  onBulk,
  onSelect,
}: {
  items: readonly MulticaInboxItemSummary[];
  unread: number;
  archivedView: boolean;
  filters: { severities: string[]; unreadOnly: boolean };
  selectedId: string | null;
  agentNameById: ReadonlyMap<string, string>;
  onToggleView: () => void;
  onFilters: (filters: { severities: string[]; unreadOnly: boolean }) => void;
  onSelect: (id: string | null) => void;
  onBulk: (verb: "read-all" | "archive-all" | "archive-all-read") => void;
}): ReactElement {
  const emptyBecauseFiltered = filters.severities.length > 0 || filters.unreadOnly;
  return (
    <View style={styles.listPane}>
      <View style={styles.listHeader}>
        <Bell size={16} color="#888" />
        <Text style={styles.listTitle}>Inbox</Text>
        {unread > 0 && !archivedView ? (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadBadgeText}>{unread}</Text>
          </View>
        ) : null}
        <InboxFilterMenu filters={filters} onFilters={onFilters} />
        <InboxBulkMenu onBulk={onBulk} />
      </View>
      <ScrollView contentContainerStyle={styles.listBody}>
        {items.map((item) => (
          <InboxRowItem
            key={item.id}
            item={item}
            actorName={item.actorId ? (agentNameById.get(item.actorId) ?? null) : null}
            selected={selectedId === item.id}
            onSelect={onSelect}
          />
        ))}
        {items.length === 0 ? (
          <Text style={styles.listEmpty}>
            {emptyListMessage(emptyBecauseFiltered, archivedView)}
          </Text>
        ) : null}
        {!archivedView ? (
          <Pressable
            style={styles.archivedRow}
            onPress={onToggleView}
            testID="multica-inbox-archived-row"
          >
            <Archive size={14} color="#888" />
            <Text style={styles.archivedRowText}>Archived</Text>
            <Text style={styles.archivedRowChevron}>›</Text>
          </Pressable>
        ) : (
          <Pressable
            style={styles.archivedRow}
            onPress={onToggleView}
            testID="multica-inbox-live-row"
          >
            <Inbox size={14} color="#888" />
            <Text style={styles.archivedRowText}>Live</Text>
            <Text style={styles.archivedRowChevron}>›</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

function emptyListMessage(filtered: boolean, archived: boolean): string {
  if (filtered) {
    return "Nothing matches this filter — clear it to see the rest.";
  }
  return archived ? "Nothing filed away." : "Nothing needs you right now.";
}

const SEVERITIES = [
  { key: "action_required", label: "Needs you" },
  { key: "attention", label: "Attention" },
  { key: "info", label: "Info" },
] as const;

/**
 * The source's filter menu: a funnel in the list header opens the
 * dimensions (unread only, plus the severity set) instead of a row of
 * always-visible chips. Fewer visible controls, the same filter power.
 */
function InboxFilterMenu({
  filters,
  onFilters,
}: {
  filters: { severities: string[]; unreadOnly: boolean };
  onFilters: (filters: { severities: string[]; unreadOnly: boolean }) => void;
}): ReactElement {
  const activeCount = filters.severities.length + (filters.unreadOnly ? 1 : 0);
  const toggleUnread = useCallback(() => {
    onFilters({ ...filters, unreadOnly: !filters.unreadOnly });
  }, [filters, onFilters]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel="Filter inbox"
        testID="multica-inbox-filter"
        style={styles.menuIconButton}
      >
        <Filter size={14} color="#888" />
        {activeCount > 0 ? <View style={styles.filterDot} /> : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" offset={4} minWidth={180}>
        <DropdownMenuItem selected={filters.unreadOnly} onSelect={toggleUnread}>
          <Text style={styles.menuItemText}>Unread only</Text>
        </DropdownMenuItem>
        {SEVERITIES.map((severity) => (
          <SeverityMenuItem
            key={severity.key}
            label={severity.label}
            severityKey={severity.key}
            active={filters.severities.includes(severity.key)}
            filters={filters}
            onFilters={onFilters}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SeverityMenuItem({
  label,
  severityKey,
  active,
  filters,
  onFilters,
}: {
  label: string;
  severityKey: string;
  active: boolean;
  filters: { severities: string[]; unreadOnly: boolean };
  onFilters: (filters: { severities: string[]; unreadOnly: boolean }) => void;
}): ReactElement {
  const handleSelect = useCallback(() => {
    onFilters({
      ...filters,
      severities: active
        ? filters.severities.filter((key) => key !== severityKey)
        : [...filters.severities, severityKey],
    });
  }, [active, filters, onFilters, severityKey]);
  return (
    <DropdownMenuItem selected={active} onSelect={handleSelect}>
      <Text style={styles.menuItemText}>{label}</Text>
    </DropdownMenuItem>
  );
}

/** The header's bulk verbs, the source's `…` menu: read all, archive all,
 * archive the read ones. */
function InboxBulkMenu({
  onBulk,
}: {
  onBulk: (verb: "read-all" | "archive-all" | "archive-all-read") => void;
}): ReactElement {
  const readAll = useCallback(() => onBulk("read-all"), [onBulk]);
  const archiveAll = useCallback(() => onBulk("archive-all"), [onBulk]);
  const archiveAllRead = useCallback(() => onBulk("archive-all-read"), [onBulk]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel="Inbox actions"
        testID="multica-inbox-bulk"
        style={styles.menuIconButton}
      >
        <MoreHorizontal size={14} color="#888" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" offset={4} minWidth={180}>
        <DropdownMenuItem onSelect={readAll}>
          <Text style={styles.menuItemText}>Mark all read</Text>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={archiveAll}>
          <Text style={styles.menuItemText}>Archive all</Text>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={archiveAllRead}>
          <Text style={styles.menuItemText}>Archive all read</Text>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function InboxRowItem({
  item,
  actorName,
  selected,
  onSelect,
}: {
  item: MulticaInboxItemSummary;
  actorName: string | null;
  selected: boolean;
  onSelect: (id: string | null) => void;
}): ReactElement {
  const handlePress = useCallback(() => onSelect(item.id), [item.id, onSelect]);
  return (
    <Pressable
      style={[styles.row, selected && styles.rowSelected]}
      onPress={handlePress}
      testID={`multica-inbox-row-${item.id}`}
    >
      <View style={[styles.rowDot, { backgroundColor: severityColor(item.severity) }]} />
      <View style={styles.rowMain}>
        <Text style={[styles.rowTitle, !item.read && styles.rowTitleUnread]} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {actorName ?? item.actorId?.slice(0, 8) ?? "system"} ·{" "}
          {formatRelativeTime(item.createdAt)}
        </Text>
      </View>
      {!item.read ? <View style={styles.rowUnreadDot} /> : null}
    </Pressable>
  );
}

function severityColor(severity: string): string {
  switch (severity) {
    case "action_required":
      return "#ef4444";
    case "attention":
      return "#f59e0b";
    default:
      return "#9ca3af";
  }
}

function InboxDetailPane({
  item,
  agentName,
  onMark,
  onArchive,
  onOpenIssue,
}: {
  item: MulticaInboxItemSummary;
  agentName: string | null;
  onMark: (item: MulticaInboxItemSummary, read: boolean) => Promise<void>;
  onArchive: (item: MulticaInboxItemSummary, archived: boolean) => Promise<void>;
  onOpenIssue: (issueId: string) => void;
}): ReactElement {
  const handleOpenIssue = useCallback(() => {
    if (item.issueId) {
      onOpenIssue(item.issueId);
    }
  }, [item.issueId, onOpenIssue]);
  const handleMark = useCallback(() => {
    void onMark(item, !item.read);
  }, [item, onMark]);
  const handleArchive = useCallback(() => {
    void onArchive(item, !item.archived);
  }, [item, onArchive]);
  return (
    <View style={styles.detailPane}>
      <View style={styles.detailHeader}>
        <View style={[styles.rowDot, { backgroundColor: severityColor(item.severity) }]} />
        <Text style={styles.detailSeverity}>{item.severity.replace("_", " ")}</Text>
        <Text style={styles.detailTime}>{formatRelativeTime(item.createdAt)}</Text>
      </View>
      <Text style={styles.detailTitle}>{item.title}</Text>
      {item.actorId ? (
        <View style={styles.detailActor}>
          <ActorAvatar name={agentName ?? item.actorId.slice(0, 8)} id={item.actorId} />
          <Text style={styles.detailActorName}>{agentName ?? item.actorId.slice(0, 8)}</Text>
        </View>
      ) : null}
      {item.body ? (
        <View style={styles.detailBody}>
          <MarkdownRenderer text={item.body} compact />
        </View>
      ) : null}
      <View style={styles.detailActions}>
        {item.issueId ? (
          <DetailAction
            label="Open issue"
            onPress={handleOpenIssue}
            testID="multica-inbox-open-issue"
          />
        ) : null}
        <DetailAction
          label={item.read ? "Mark unread" : "Mark read"}
          iconKind={item.read ? null : "check"}
          onPress={handleMark}
          testID="multica-inbox-mark"
        />
        <DetailAction
          label={item.archived ? "Unarchive" : "Archive"}
          iconKind={item.archived ? "restore" : "archive"}
          onPress={handleArchive}
          testID="multica-inbox-archive"
        />
      </View>
    </View>
  );
}

type DetailActionIcon = "check" | "archive" | "restore" | null;

function DetailAction({
  label,
  iconKind,
  onPress,
  testID,
}: {
  label: string;
  iconKind?: DetailActionIcon;
  onPress: () => void;
  testID: string;
}): ReactElement {
  return (
    <Pressable style={styles.detailAction} onPress={onPress} testID={testID}>
      {iconKind === "check" ? <Check size={13} color="#888" /> : null}
      {iconKind === "archive" ? <Archive size={13} color="#888" /> : null}
      {iconKind === "restore" ? <ArchiveRestore size={13} color="#888" /> : null}
      <Text style={styles.detailActionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  page: { flex: 1, backgroundColor: theme.colors.background },
  wideSplit: { flex: 1, flexDirection: "row" },
  wideList: { width: 380, borderRightWidth: 1, borderRightColor: theme.colors.border },
  wideDetail: { flex: 1 },
  wideDetailContent: { padding: theme.spacing[4] },
  backRow: { padding: theme.spacing[3] },
  backText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  listPane: { flex: 1 },
  listHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[3],
  },
  listTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.base, fontWeight: "600" },
  unreadBadge: {
    paddingHorizontal: theme.spacing[2],
    borderRadius: 999,
    backgroundColor: "#ef4444",
  },
  unreadBadgeText: { color: "#fff", fontSize: theme.fontSize.sm, fontWeight: "600" },
  viewToggle: {
    marginLeft: "auto",
    paddingVertical: 2,
    paddingHorizontal: theme.spacing[2],
    borderRadius: 999,
    backgroundColor: theme.colors.surface2,
  },
  viewToggleText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  filterRow: {
    flexDirection: "row",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
    flexWrap: "wrap",
  },
  severityChip: {
    paddingVertical: 2,
    paddingHorizontal: theme.spacing[2],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  severityChipActive: { backgroundColor: theme.colors.surface2 },
  severityChipText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  severityChipTextActive: { color: theme.colors.foreground },
  menuIconButton: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
  },
  filterDot: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.accent,
  },
  menuItemText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  archivedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    marginTop: theme.spacing[2],
  },
  archivedRowText: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  archivedRowChevron: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  listBody: { padding: theme.spacing[3], gap: theme.spacing[1] },
  listEmpty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[3],
  },
  row: {
    flexDirection: "row",
    gap: theme.spacing[2],
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  rowSelected: { borderColor: theme.colors.foreground },
  rowDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  rowTitleUnread: { fontWeight: "600" },
  rowMeta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  rowUnreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#3b82f6", marginTop: 6 },
  detailEmpty: { flex: 1, alignItems: "center", justifyContent: "center" },
  detailEmptyText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  detailPane: { gap: theme.spacing[3], maxWidth: 720 },
  detailHeader: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  detailSeverity: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textTransform: "uppercase",
  },
  detailTime: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginLeft: "auto",
  },
  detailTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.lg, fontWeight: "600" },
  detailActor: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  detailActorName: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  detailBody: { paddingVertical: theme.spacing[1] },
  detailActions: { flexDirection: "row", gap: theme.spacing[2], flexWrap: "wrap" },
  detailAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: 3,
    paddingHorizontal: theme.spacing[2],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  detailActionText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
}));
