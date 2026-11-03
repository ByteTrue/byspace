// Port of packages/app/src/components/agent-list.tsx: the History list (day sections, search marks, long press to archive); DOM view.
// Converted from the Expo file by web/scripts/port/sessions-screen.py (tag archive/expo-app); edit it directly.
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "cn";
import { useLongPress } from "~/hooks/use-long-press";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useIsCompactFormFactor } from "@/constants/layout";
import { formatTimeAgo } from "@/utils/time";
import { type AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useSessionStore } from "@/stores/session-store";
import { Archive, ChevronRight } from "lucide-react";
import { getProviderIcon } from "@/components/provider-icons";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
import { HighlightedText } from "@/components/ui/highlighted-text";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import type { AgentSearchMatch } from "@bytetrue/protocol/messages";
import type { MatchRange } from "@bytetrue/protocol/search/text-match";

interface AgentListProps {
  agents: AggregatedAgent[];
  showCheckoutInfo?: boolean;
  /** packages/app's pull-to-refresh; React Native Web renders none, so the web list ignores them. */
  isRefreshing?: boolean;
  onRefresh?: () => void;
  selectedAgentId?: string;
  onAgentSelect?: () => void;
  listFooterComponent?: ReactElement | null;
  showAttentionIndicator?: boolean;
  showHostColumn?: boolean;
  /**
   * Where a search matched each row, keyed by `serverId:agentId`. Rows mark the
   * spans so the list can explain why a result is in it — the subsequence and
   * typo tiers match characters the eye would not find on its own.
   */
  searchMatchesByAgentKey?: Record<string, AgentSearchMatch[]>;
  /**
   * Renders one flat list in the given order instead of grouping by day. Day
   * headings claim the list is chronological, which is a lie once the caller
   * has ordered it by something else — relevance, for instance.
   */
  flat?: boolean;
}

type DateSectionKey = "today" | "yesterday" | "thisWeek" | "thisMonth" | "older";

const DATE_SECTION_ORDER = [
  "today",
  "yesterday",
  "thisWeek",
  "thisMonth",
  "older",
] as const satisfies readonly DateSectionKey[];

const LONG_PRESS_MS = 500;
const META_TEXT = "max-w-full text-sm leading-[normal] text-muted-foreground";
const META_SEPARATOR = "text-sm leading-[normal] text-muted-foreground opacity-70";
const COLUMN_META = "w-[132px] shrink-0 text-sm leading-[normal] text-muted-foreground";

type FlatListItem =
  | { type: "header"; key: string; section: DateSectionKey }
  | { type: "agent"; key: string; agent: AggregatedAgent };

function deriveDateSectionKey(lastActivityAt: Date): DateSectionKey {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const activityStart = new Date(
    lastActivityAt.getFullYear(),
    lastActivityAt.getMonth(),
    lastActivityAt.getDate(),
  );

  if (activityStart.getTime() >= todayStart.getTime()) {
    return "today";
  }
  if (activityStart.getTime() >= yesterdayStart.getTime()) {
    return "yesterday";
  }

  const diffTime = todayStart.getTime() - activityStart.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays <= 7) {
    return "thisWeek";
  }
  if (diffDays <= 30) {
    return "thisMonth";
  }
  return "older";
}

function formatDateSectionLabel(t: TFunction, section: DateSectionKey): string {
  switch (section) {
    case "today":
      return t("agentList.dateSections.today");
    case "yesterday":
      return t("agentList.dateSections.yesterday");
    case "thisWeek":
      return t("agentList.dateSections.thisWeek");
    case "thisMonth":
      return t("agentList.dateSections.thisMonth");
    case "older":
      return t("agentList.dateSections.older");
  }
}

function SessionBadge({
  label,
  icon,
  tone = "neutral",
}: {
  label: string;
  icon?: ReactElement;
  tone?: "neutral" | "warning" | "danger";
}) {
  let variant: StatusBadgeVariant = "muted";
  if (tone === "warning") variant = "warning";
  else if (tone === "danger") variant = "error";
  return <StatusBadge label={label} variant={variant} leading={icon} />;
}

function WorkspaceTitlePrefix({
  visible,
  workspaceName,
  ranges,
  testID,
}: {
  visible: boolean;
  workspaceName: string;
  ranges?: readonly MatchRange[];
  testID: string;
}) {
  if (!visible) {
    return null;
  }

  return (
    <>
      <HighlightedText
        text={workspaceName}
        ranges={ranges}
        className="max-w-[220px] shrink-0 text-sm leading-[normal] text-muted-foreground"
        numberOfLines={1}
        testID={testID}
      />
      <ChevronRight size={12} className="shrink-0 text-muted-foreground" />
    </>
  );
}

function SessionRowBadges({
  agent,
  archivedIcon,
  pendingPermissionCount,
  showDesktopAttention,
}: {
  agent: AggregatedAgent;
  archivedIcon: ReactElement;
  pendingPermissionCount: number;
  showDesktopAttention: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      {agent.archivedAt ? (
        <SessionBadge label={t("agentList.badges.archived")} icon={archivedIcon} />
      ) : null}
      {pendingPermissionCount > 0 ? (
        <SessionBadge
          label={t("agentList.badges.pending", { count: pendingPermissionCount })}
          tone="warning"
        />
      ) : null}
      {showDesktopAttention ? (
        <SessionBadge label={t("agentList.badges.attention")} tone="danger" />
      ) : null}
    </>
  );
}

function SessionRowTrailingAttention({
  isMobile,
  showAttentionIndicator,
  requiresAttention,
}: {
  isMobile: boolean;
  showAttentionIndicator: boolean;
  requiresAttention: boolean | undefined;
}) {
  const { t } = useTranslation();
  if (!isMobile || !showAttentionIndicator || !requiresAttention) {
    return null;
  }
  return (
    <div className="ml-2 flex">
      <SessionBadge label={t("agentList.badges.attention")} tone="danger" />
    </div>
  );
}

function SessionRowMetaLine({
  agent,
  projectName,
  branch,
  workspaceName,
  timeAgo,
  showHostColumn,
  rangesFor,
}: {
  agent: AggregatedAgent;
  projectName: string;
  branch: string;
  workspaceName: string;
  timeAgo: string;
  showHostColumn: boolean;
  rangesFor: (field: AgentSearchMatch["field"]) => readonly MatchRange[] | undefined;
}) {
  return (
    <span className="mt-0.5 flex flex-row flex-wrap items-center gap-1">
      <HighlightedText
        text={projectName}
        ranges={rangesFor("project")}
        className={META_TEXT}
        numberOfLines={1}
        testID={`agent-row-project-${agent.serverId}-${agent.id}`}
      />
      <span className={META_SEPARATOR}>·</span>
      <HighlightedText
        text={branch}
        ranges={rangesFor("branch")}
        className={META_TEXT}
        numberOfLines={1}
        testID={`agent-row-branch-${agent.serverId}-${agent.id}`}
      />
      <span className={META_SEPARATOR}>·</span>
      <HighlightedText
        text={workspaceName}
        ranges={rangesFor("workspace")}
        className={META_TEXT}
        numberOfLines={1}
        testID={`agent-row-workspace-${agent.serverId}-${agent.id}`}
      />
      <span className={META_SEPARATOR}>·</span>
      <span className={META_TEXT}>{timeAgo}</span>
      {showHostColumn && agent.serverLabel ? (
        <>
          <span className={META_SEPARATOR}>·</span>
          <span className={cn(META_TEXT, "truncate")}>{agent.serverLabel}</span>
        </>
      ) : null}
    </span>
  );
}

function SessionRow({
  agent,
  searchMatches,
  isMobile,
  selectedAgentId,
  showAttentionIndicator,
  showHostColumn,
  onPress,
  onLongPress,
}: {
  agent: AggregatedAgent;
  searchMatches?: readonly AgentSearchMatch[];
  isMobile: boolean;
  selectedAgentId?: string;
  showAttentionIndicator: boolean;
  showHostColumn: boolean;
  onPress: (agent: AggregatedAgent) => void;
  onLongPress: (agent: AggregatedAgent) => void;
}) {
  const { t } = useTranslation();
  const timeAgo = formatTimeAgo(agent.lastActivityAt);
  const agentKey = `${agent.serverId}:${agent.id}`;
  const isSelected = selectedAgentId === agentKey;
  const projectName = agent.projectPlacement?.projectName ?? "";
  const branch = agent.projectPlacement?.checkout.currentBranch ?? "";
  const workspaceName = agent.projectPlacement?.workspaceName ?? "";
  const ProviderIcon = getProviderIcon(agent.provider, agent.serverId);
  const pendingPermissionCount = agent.pendingPermissionCount ?? 0;
  const rangesFor = useCallback(
    (field: AgentSearchMatch["field"]) =>
      searchMatches?.find((match) => match.field === field)?.ranges,
    [searchMatches],
  );

  const handlePress = useCallback(() => onPress(agent), [onPress, agent]);
  const handleLongPress = useCallback(() => onLongPress(agent), [onLongPress, agent]);
  // Pressable's long press: held still for 500ms, and the click that releases it does not open.
  const longPress = useLongPress(handleLongPress, LONG_PRESS_MS);

  const archivedIcon = useMemo(() => <Archive size={12} className="text-muted-foreground" />, []);
  const showDesktopAttention =
    !isMobile && showAttentionIndicator && Boolean(agent.requiresAttention);

  return (
    <button
      type="button"
      className={cn(
        "relative mb-0.5 flex w-full flex-row items-center overflow-hidden rounded-sm px-3 py-2 text-left select-none [-webkit-touch-callout:none] hover:bg-muted active:bg-muted",
        isSelected && "bg-muted",
      )}
      onClick={handlePress}
      {...longPress}
      data-testid={`agent-row-${agent.serverId}-${agent.id}`}
    >
      {isSelected ? (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-foreground"
        />
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <span className="flex flex-row flex-nowrap items-center gap-2 overflow-hidden">
          <WorkspaceTitlePrefix
            visible={!isMobile && Boolean(workspaceName)}
            workspaceName={workspaceName}
            ranges={rangesFor("workspace")}
            testID={`agent-row-workspace-${agent.serverId}-${agent.id}`}
          />
          <span className="flex w-4 shrink-0 items-center justify-center text-muted-foreground">
            <ProviderIcon size={14} color="currentColor" />
          </span>
          <HighlightedText
            text={agent.title || t("agentList.fallbackTitle")}
            ranges={agent.title ? rangesFor("title") : undefined}
            className={cn(
              "min-w-0 shrink text-sm leading-[normal] font-normal text-foreground",
              isSelected ? "opacity-100" : "opacity-86",
            )}
            numberOfLines={1}
          />
          <SessionRowBadges
            agent={agent}
            archivedIcon={archivedIcon}
            pendingPermissionCount={pendingPermissionCount}
            showDesktopAttention={showDesktopAttention}
          />
        </span>
        {isMobile ? (
          <SessionRowMetaLine
            agent={agent}
            projectName={projectName}
            branch={branch}
            workspaceName={workspaceName}
            timeAgo={timeAgo}
            showHostColumn={showHostColumn}
            rangesFor={rangesFor}
          />
        ) : null}
      </span>
      {!isMobile ? (
        <span className="flex shrink-0 flex-row items-center gap-3">
          <HighlightedText
            text={projectName}
            ranges={rangesFor("project")}
            className={COLUMN_META}
            numberOfLines={1}
            testID={`agent-row-project-${agent.serverId}-${agent.id}`}
          />
          {showHostColumn ? (
            <span className="ml-4 w-[120px] shrink-0 truncate text-right text-sm leading-[normal] text-muted-foreground">
              {agent.serverLabel}
            </span>
          ) : null}
          <HighlightedText
            text={branch}
            ranges={rangesFor("branch")}
            className={COLUMN_META}
            numberOfLines={1}
            testID={`agent-row-branch-${agent.serverId}-${agent.id}`}
          />
          <span className="w-[72px] shrink-0 truncate text-right text-sm leading-[normal] text-muted-foreground">
            {timeAgo}
          </span>
        </span>
      ) : null}
      <SessionRowTrailingAttention
        isMobile={isMobile}
        showAttentionIndicator={showAttentionIndicator}
        requiresAttention={agent.requiresAttention}
      />
    </button>
  );
}

function ArchiveActionSheet({
  open,
  title,
  archiveDisabled,
  onClose,
  onArchive,
}: {
  open: boolean;
  title: string;
  archiveDisabled: boolean;
  onClose: () => void;
  onArchive: () => void;
}) {
  const { t } = useTranslation();
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col justify-end outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          <div className="absolute inset-0 bg-black/35" onClick={onClose} />
          <div className="relative flex flex-col gap-4 rounded-t-[16px] bg-muted px-6 pt-4 pb-[max(env(safe-area-inset-bottom),24px)]">
            <div className="h-1 w-10 self-center rounded-full bg-muted-foreground opacity-30" />
            <DialogPrimitive.Title className="text-center text-sm leading-[normal] font-semibold text-foreground">
              {title}
            </DialogPrimitive.Title>
            <div className="flex flex-row gap-3">
              <button
                type="button"
                className="flex flex-1 items-center justify-center rounded-[10px] bg-card py-4 text-sm leading-[normal] font-semibold text-foreground"
                onClick={onClose}
                data-testid="agent-action-cancel"
              >
                {t("common.actions.cancel")}
              </button>
              <button
                type="button"
                disabled={archiveDisabled}
                className="flex flex-1 items-center justify-center rounded-[10px] bg-primary py-4 text-sm leading-[normal] font-semibold text-primary-foreground disabled:text-primary-foreground/50"
                onClick={onArchive}
                data-testid="agent-action-archive"
              >
                {t("agentList.archiveSheet.archive")}
              </button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function AgentList({
  agents,
  selectedAgentId,
  onAgentSelect,
  listFooterComponent,
  showAttentionIndicator = true,
  showHostColumn = false,
  searchMatchesByAgentKey,
  flat = false,
}: AgentListProps) {
  const { t } = useTranslation();
  const [actionAgent, setActionAgent] = useState<AggregatedAgent | null>(null);
  const isMobile = useIsCompactFormFactor();
  const { archiveAgent } = useArchiveAgent();

  const actionClient = useSessionStore((state) =>
    actionAgent?.serverId ? (state.sessions[actionAgent.serverId]?.client ?? null) : null,
  );

  const isActionSheetVisible = actionAgent !== null;
  const isActionDaemonUnavailable = Boolean(actionAgent?.serverId && !actionClient);

  const handleAgentPress = useCallback(
    (agent: AggregatedAgent) => {
      if (isActionSheetVisible) {
        return;
      }

      const serverId = agent.serverId;
      const agentId = agent.id;

      onAgentSelect?.();
      navigateToAgent({
        serverId,
        agentId,
        workspaceId: agent.workspaceId,
        pin: true,
      });
    },
    [isActionSheetVisible, onAgentSelect],
  );

  const handleAgentLongPress = useCallback(
    (agent: AggregatedAgent) => {
      const isRunning = agent.status === "running";
      if (isRunning) {
        setActionAgent(agent);
        return;
      }

      const client = useSessionStore.getState().sessions[agent.serverId]?.client ?? null;
      if (!client) {
        setActionAgent(agent);
        return;
      }
      void archiveAgent({ serverId: agent.serverId, agentId: agent.id }).catch(() => {});
    },
    [archiveAgent],
  );

  const handleCloseActionSheet = useCallback(() => {
    setActionAgent(null);
  }, []);

  const handleArchiveAgent = useCallback(() => {
    if (!actionAgent || !actionClient) {
      return;
    }
    // Timeout errors are swallowed — the daemon will still process the archive
    void archiveAgent({ serverId: actionAgent.serverId, agentId: actionAgent.id }).catch(() => {});
    setActionAgent(null);
  }, [actionAgent, actionClient, archiveAgent]);

  const flatItems = useMemo((): FlatListItem[] => {
    if (flat) {
      return agents.map((agent) => ({
        type: "agent" as const,
        key: `${agent.serverId}:${agent.id}`,
        agent,
      }));
    }

    const buckets = new Map<DateSectionKey, AggregatedAgent[]>();
    for (const agent of agents) {
      const section = deriveDateSectionKey(agent.lastActivityAt);
      const existing = buckets.get(section) ?? [];
      existing.push(agent);
      buckets.set(section, existing);
    }

    const result: FlatListItem[] = [];
    for (const section of DATE_SECTION_ORDER) {
      const data = buckets.get(section);
      if (!data || data.length === 0) {
        continue;
      }
      result.push({ type: "header", key: `header:${section}`, section });
      for (const agent of data) {
        result.push({ type: "agent", key: `${agent.serverId}:${agent.id}`, agent });
      }
    }
    return result;
  }, [agents, flat]);

  const renderItem = useCallback(
    (item: FlatListItem) => {
      if (item.type === "header") {
        return (
          <div key={item.key} className="mt-2 mb-2 flex flex-row items-center gap-3 px-3">
            <span className="text-sm leading-[normal] font-medium text-muted-foreground">
              {formatDateSectionLabel(t, item.section)}
            </span>
          </div>
        );
      }
      return (
        <SessionRow
          key={item.key}
          agent={item.agent}
          searchMatches={searchMatchesByAgentKey?.[item.key]}
          isMobile={isMobile}
          selectedAgentId={selectedAgentId}
          showAttentionIndicator={showAttentionIndicator}
          showHostColumn={showHostColumn}
          onPress={handleAgentPress}
          onLongPress={handleAgentLongPress}
        />
      );
    },
    [
      handleAgentLongPress,
      handleAgentPress,
      isMobile,
      searchMatchesByAgentKey,
      selectedAgentId,
      showAttentionIndicator,
      showHostColumn,
      t,
    ],
  );

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]">
        <div className="flex flex-col gap-1 px-3 pt-4 pb-6 md:px-6">
          {flatItems.map(renderItem)}
          {listFooterComponent}
        </div>
      </div>

      <ArchiveActionSheet
        open={isActionSheetVisible}
        title={
          isActionDaemonUnavailable
            ? t("agentList.archiveSheet.hostOffline")
            : t("agentList.archiveSheet.runningAgent")
        }
        archiveDisabled={isActionDaemonUnavailable}
        onClose={handleCloseActionSheet}
        onArchive={handleArchiveAgent}
      />
    </>
  );
}
