/**
 * The product's own left rail, after the source's workspace nav: the face's
 * destinations live in one column with their counts, not scattered as pills
 * in page headers. A page wraps itself in MulticaShell and says which entry
 * it is; the rail carries the inbox's unread count and the secretary's
 * workspace door, the two entries a returning owner wants within reach.
 *
 * The source's nav also lists Projects, Skills, Runtimes, Analytics and
 * Settings — circles this replica does not have (see the graduated spec's
 * owed list). The rail lists what exists; an entry for a face that is not
 * there would be a dead door.
 */
import type { ReactElement, ReactNode } from "react";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { type Href, useRouter } from "expo-router";
import {
  Bell,
  Bot,
  KanbanSquare,
  ListTodo,
  Timer,
  Users,
  UsersRound,
  ArrowLeft,
} from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";

import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { useMulticaCatalog } from "@/multica/multica-catalog";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";

import { useMulticaLiveState } from "./multica-board";

export type MulticaNavKey = "board" | "mine" | "inbox" | "rosters" | "squads" | "autopilots";

interface NavEntry {
  readonly key: MulticaNavKey | "secretary";
  readonly label: string;
  readonly group: string;
}

const NAV_ENTRIES: readonly NavEntry[] = [
  { key: "board", label: "Board", group: "Work" },
  { key: "mine", label: "My issues", group: "Work" },
  { key: "inbox", label: "Inbox", group: "Work" },
  { key: "rosters", label: "Agents", group: "AI team" },
  { key: "squads", label: "Squads", group: "AI team" },
  { key: "autopilots", label: "Autopilots", group: "AI team" },
];

function routeFor(key: MulticaNavKey, serverId: string): Href {
  switch (key) {
    case "board":
      return `/multica?serverId=${serverId}`;
    case "mine":
      return `/multica/mine?serverId=${serverId}`;
    case "inbox":
      return `/multica-inbox?serverId=${serverId}`;
    case "rosters":
      return `/multica/agents?serverId=${serverId}`;
    case "squads":
      return `/multica/squads?serverId=${serverId}`;
    case "autopilots":
      return `/multica/autopilots?serverId=${serverId}`;
  }
}

export function MulticaShell({
  serverId,
  active,
  children,
}: {
  serverId: string;
  active: MulticaNavKey;
  children: ReactNode;
}): ReactElement {
  const compact = useIsCompactFormFactor();
  const rail = <MulticaNavRail serverId={serverId} active={active} compact={compact} />;
  if (compact) {
    // The rail becomes a top strip: the same destinations, one scroll wide,
    // so a phone keeps the face's map without giving up its width.
    return (
      <View style={styles.shell}>
        <ScrollView horizontal contentContainerStyle={styles.strip}>
          {rail}
        </ScrollView>
        <View style={styles.mainCompact}>{children}</View>
      </View>
    );
  }
  return (
    <View style={styles.shell}>
      <View style={styles.rail}>{rail}</View>
      <View style={styles.main}>{children}</View>
    </View>
  );
}

function MulticaNavRail({
  serverId,
  active,
  compact,
}: {
  serverId: string;
  active: MulticaNavKey;
  compact: boolean;
}): ReactElement {
  const router = useRouter();
  const live = useMulticaLiveState(serverId);
  const [query, setQuery] = useState("");
  const handleQuery = useCallback((text: string) => setQuery(text), []);
  const clearQuery = useCallback(() => setQuery(""), []);
  const groups: string[] = [];
  for (const entry of NAV_ENTRIES) {
    if (!groups.includes(entry.group)) {
      groups.push(entry.group);
    }
  }
  const openSecretary = useCallback(() => {
    if (live.secretaryWorkspaceId) {
      router.push(buildHostWorkspaceRoute(serverId, live.secretaryWorkspaceId));
    }
  }, [live.secretaryWorkspaceId, router, serverId]);
  const exitToBySpace = useCallback(() => {
    router.replace("/");
  }, [router]);
  return (
    <>
      {/*
       * The source is a standalone app and has no exit; this face lives
       * inside BySpace, so the rail carries the door back — the same
       * handleExit the practice line's console had, in rail form.
       */}
      <Pressable
        style={[styles.railRow, compact && styles.stripRow]}
        onPress={exitToBySpace}
        testID="multica-nav-exit"
      >
        <ArrowLeft size={14} color="#888" />
        <Text style={styles.railLabel} numberOfLines={1}>
          BySpace
        </Text>
      </Pressable>
      <View style={styles.searchBoxWrap}>
        <TextInput
          style={styles.searchInput}
          initialValue=""
          onChangeText={handleQuery}
          placeholder="Search…"
          placeholderTextColor="gray"
          testID="multica-rail-search"
        />
      </View>
      {query.trim() !== "" ? (
        <RailSearchResults serverId={serverId} query={query.trim()} onNavigate={clearQuery} />
      ) : null}
      {groups.map((group) => (
        <View key={group} style={compact ? styles.stripGroup : styles.railGroup}>
          {!compact ? <Text style={styles.railGroupLabel}>{group}</Text> : null}
          {NAV_ENTRIES.filter((entry) => entry.group === group).map((entry) => (
            <NavRow
              key={entry.key}
              entry={entry}
              serverId={serverId}
              active={active === entry.key}
              compact={compact}
              badge={entry.key === "inbox" ? live.inboxUnread : 0}
            />
          ))}
        </View>
      ))}
      {live.secretaryWorkspaceId ? (
        <Pressable
          style={[styles.railRow, compact && styles.stripRow]}
          onPress={openSecretary}
          testID="multica-nav-secretary"
        >
          <Bot size={14} color="#888" />
          <Text style={styles.railLabel} numberOfLines={1}>
            Chief of Staff
          </Text>
        </Pressable>
      ) : null}
    </>
  );
}

/**
 * The rail's search, the source's ⌘K dialog translated without a dialog:
 * the source has a cmdk overlay the repo has no mechanism for (its only
 * overlay is the bottom sheet), so typing filters inline and the results
 * list sits under the box. Same reach, one fewer mechanism.
 */
function RailSearchResults({
  serverId,
  query,
  onNavigate,
}: {
  serverId: string;
  query: string;
  onNavigate: () => void;
}): ReactElement {
  const router = useRouter();
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const client = runtimeSnapshot?.client ?? null;
  const online = runtimeSnapshot?.connectionStatus === "online";
  const catalog = useMulticaCatalog(serverId);
  const issuesQuery = useFetchQuery({
    queryKey: ["multicaRailSearch", serverId, runtimeSnapshot?.clientGeneration ?? 0],
    queryFn: async () => {
      if (!client) throw new Error("Target host client is unavailable");
      return client.multicaIssueList({});
    },
    enabled: online,
    retry: false,
    dataShape: "list",
    staleTimeMs: 5_000,
  });
  const needle = query.toLowerCase();
  const issues = (issuesQuery.data?.issues ?? [])
    .filter((issue) => issue.title.toLowerCase().includes(needle))
    .slice(0, 6);
  const agents = catalog.agents
    .filter((agent) => agent.name.toLowerCase().includes(needle))
    .slice(0, 4);
  const squads = catalog.squads
    .filter((squad) => squad.name.toLowerCase().includes(needle))
    .slice(0, 4);
  const openIssue = useCallback(
    (id: string) => {
      onNavigate();
      router.push(`/multica/issue?serverId=${serverId}&issueId=${id}`);
    },
    [onNavigate, router, serverId],
  );
  const openAgent = useCallback(
    (id: string) => {
      onNavigate();
      router.push(`/multica/agent?serverId=${serverId}&agentId=${id}`);
    },
    [onNavigate, router, serverId],
  );
  const openSquad = useCallback(
    (id: string) => {
      onNavigate();
      router.push(`/multica/squad?serverId=${serverId}&squadId=${id}`);
    },
    [onNavigate, router, serverId],
  );
  return (
    <View style={styles.searchResults}>
      {issues.map((issue) => (
        <IssueSearchRow key={`i:${issue.id}`} issue={issue} onOpen={openIssue} />
      ))}
      {agents.map((agent) => (
        <AgentSearchRow key={`a:${agent.id}`} agent={agent} onOpen={openAgent} />
      ))}
      {squads.map((squad) => (
        <SquadSearchRow key={`s:${squad.id}`} squad={squad} onOpen={openSquad} />
      ))}
      {issues.length + agents.length + squads.length === 0 ? (
        <Text style={styles.searchNone}>No matches.</Text>
      ) : null}
    </View>
  );
}

function IssueSearchRow({
  issue,
  onOpen,
}: {
  issue: { id: string; title: string; number: number | null };
  onOpen: (id: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onOpen(issue.id), [issue.id, onOpen]);
  return (
    <SearchResultRow
      label={issue.title}
      kind={`#${issue.number ?? ""}`}
      onPress={handlePress}
      testID={`multica-search-issue-${issue.id}`}
    />
  );
}

function AgentSearchRow({
  agent,
  onOpen,
}: {
  agent: { id: string; name: string };
  onOpen: (id: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onOpen(agent.id), [agent.id, onOpen]);
  return (
    <SearchResultRow
      label={agent.name}
      kind="agent"
      onPress={handlePress}
      testID={`multica-search-agent-${agent.id}`}
    />
  );
}

function SquadSearchRow({
  squad,
  onOpen,
}: {
  squad: { id: string; name: string };
  onOpen: (id: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onOpen(squad.id), [squad.id, onOpen]);
  return (
    <SearchResultRow
      label={squad.name}
      kind="squad"
      onPress={handlePress}
      testID={`multica-search-squad-${squad.id}`}
    />
  );
}

function SearchResultRow({
  label,
  kind,
  onPress,
  testID,
}: {
  label: string;
  kind: string;
  onPress: () => void;
  testID: string;
}): ReactElement {
  return (
    <Pressable style={styles.searchRow} onPress={onPress} testID={testID}>
      <Text style={styles.searchRowLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.searchRowKind}>{kind}</Text>
    </Pressable>
  );
}

function NavIcon({ entryKey }: { entryKey: string }): ReactElement {
  switch (entryKey) {
    case "board":
      return <KanbanSquare size={14} color="#888" />;
    case "mine":
      return <ListTodo size={14} color="#888" />;
    case "inbox":
      return <Bell size={14} color="#888" />;
    case "rosters":
      return <UsersRound size={14} color="#888" />;
    case "squads":
      return <Users size={14} color="#888" />;
    default:
      return <Timer size={14} color="#888" />;
  }
}

function NavRow({
  entry,
  serverId,
  active,
  compact,
  badge,
}: {
  entry: NavEntry;
  serverId: string;
  active: boolean;
  compact: boolean;
  badge: number;
}): ReactElement {
  const router = useRouter();
  const open = useCallback(() => {
    router.push(routeFor(entry.key as MulticaNavKey, serverId));
  }, [entry.key, router, serverId]);
  return (
    <Pressable
      style={[styles.railRow, compact && styles.stripRow, active && styles.railRowActive]}
      onPress={open}
      testID={`multica-nav-${entry.key}`}
    >
      <NavIcon entryKey={entry.key} />
      <Text style={styles.railLabel} numberOfLines={1}>
        {entry.label}
      </Text>
      {badge > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  searchBoxWrap: { paddingHorizontal: theme.spacing[2], paddingBottom: theme.spacing[2] },
  searchInput: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  searchResults: {
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    gap: 2,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: 3,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  searchRowLabel: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  searchRowKind: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  searchNone: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
  },
  shell: { flex: 1, flexDirection: "row", backgroundColor: theme.colors.surface0 },
  rail: {
    width: 176,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[2],
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    gap: theme.spacing[1],
  },
  railGroup: { gap: 2, marginBottom: theme.spacing[2] },
  railGroupLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginBottom: 2,
    paddingHorizontal: theme.spacing[2],
  },
  railRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  railRowActive: { backgroundColor: theme.colors.surface2 },
  railLabel: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  badge: {
    minWidth: 16,
    borderRadius: 8,
    backgroundColor: theme.colors.surface3,
    alignItems: "center",
    paddingHorizontal: 4,
  },
  badgeText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  strip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    padding: theme.spacing[2],
  },
  stripGroup: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  stripRow: { paddingHorizontal: theme.spacing[2], paddingVertical: 4 },
  main: { flex: 1 },
  mainCompact: { flex: 1 },
}));
