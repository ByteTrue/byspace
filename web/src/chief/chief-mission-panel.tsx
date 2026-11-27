import type {
  ChiefEvent,
  ChiefMissionSnapshot,
  ChiefMissionStatus,
  ChiefMissionUpgradeRequest,
  ChiefSystemAttention,
  ChiefThreadSnapshot,
} from "@bytetrue/protocol/messages";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/ui/alert";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { ItemGroup } from "@/ui/item";
import { Spinner } from "@/ui/spinner";
import { ChiefDecisionBanner } from "@/chief/chief-decision-banner";
import { ChiefThreadRow, type ChiefThreadOperation } from "@/chief/chief-thread-row";
import { useChiefMissions } from "@/chief/use-chief-missions";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { toErrorMessage } from "@/lib/error-messages";
import { showAlert } from "@/platform/alert";
import { keepFocusElsewhere } from "@/platform/menu-focus";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import {
  groupThreadsByOutcome,
  hasActiveSystemAttention,
  missionNeedsHumanAttention,
  selectMissionForAgent,
  useChiefStore,
  type ChiefThreadOutcomeGroup,
} from "@/stores/chief-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { cn } from "cn";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  History,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";

export interface ChiefMissionPanelProps {
  serverId: string;
  chiefAgentId: string;
  onOpenAgent?: (agentId: string, workspaceId?: string | null) => void;
}

const MISSION_STATUS_TONE: Record<ChiefMissionStatus, string> = {
  active: "text-foreground",
  waiting_human: "text-status-warning",
  completed: "text-status-success",
  failed: "text-status-danger",
  canceled: "text-muted-foreground",
};

const OUTCOME_GROUP_ORDER: readonly ChiefThreadOutcomeGroup[] = [
  "needsAttention",
  "readyToLand",
  "inProgress",
  "completed",
];

const EMPTY_EVENTS: readonly ChiefEvent[] = [];

type UpgradeTargetTier = ChiefMissionUpgradeRequest["targetTier"];

interface MissionUpgradeRequest {
  missionId: string;
  targetTier: UpgradeTargetTier;
  dirtyPolicy?: ChiefMissionUpgradeRequest["dirtyPolicy"];
}

interface MissionUpgradeState {
  pendingTier: UpgradeTargetTier | null;
  error: string | null;
  retry: MissionUpgradeRequest | null;
}

const EMPTY_UPGRADE_STATE: MissionUpgradeState = {
  pendingTier: null,
  error: null,
  retry: null,
};

function isDirtyUpgradeError(message: string): boolean {
  return /dirty|uncommitted|carry_into_thread_1|fail_if_dirty/i.test(message);
}

function MissionAttentionStrip({
  attention,
  workspaceId,
  onOpenAgent,
}: {
  attention: ChiefSystemAttention;
  workspaceId?: string | null;
  onOpenAgent: (agentId: string, workspaceId?: string | null) => void;
}): ReactElement {
  const { t } = useTranslation();
  const isFatal = attention.severity === "fatal";
  const Icon = isFatal ? CircleAlert : TriangleAlert;
  const attentionAgentId = attention.agentId?.trim() || null;

  const handleOpenAgent = useCallback(() => {
    if (attentionAgentId) {
      onOpenAgent(attentionAgentId, workspaceId);
    }
  }, [attentionAgentId, onOpenAgent, workspaceId]);

  return (
    <Alert
      variant={isFatal ? "destructive" : "default"}
      data-testid={`chief-mission-attention-${attention.kind}`}
    >
      <Icon className={isFatal ? undefined : "text-status-warning"} />
      <AlertTitle className="flex flex-wrap items-center gap-2">
        <span>{t(`chief.attention.kinds.${attention.kind}`)}</span>
        <Badge
          variant="secondary"
          className={isFatal ? "text-status-danger" : "text-status-warning"}
        >
          {t(`chief.attention.severity.${attention.severity}`)}
        </Badge>
      </AlertTitle>
      <AlertDescription className="space-y-1">
        <p>{attention.summary}</p>
        {attention.autoActionTaken ? (
          <p className="text-xs text-muted-foreground">{attention.autoActionTaken}</p>
        ) : null}
      </AlertDescription>
      {attentionAgentId ? (
        <AlertAction>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleOpenAgent}
            data-testid="chief-mission-attention-open-agent"
          >
            {t("chief.actions.openConversation")}
            <ArrowUpRight data-icon="inline-end" />
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}

function MissionTabButton({
  mission,
  isSelected,
  onSelect,
}: {
  mission: ChiefMissionSnapshot;
  isSelected: boolean;
  onSelect: (missionId: string) => void;
}): ReactElement {
  const attentionNeeded = missionNeedsHumanAttention(mission);
  const handleSelect = useCallback(() => {
    onSelect(mission.id);
  }, [mission.id, onSelect]);

  return (
    <Button
      type="button"
      size="xs"
      variant={isSelected ? "secondary" : "ghost"}
      onClick={handleSelect}
      data-testid={`chief-mission-tab-${mission.id}`}
      className="max-w-[240px] gap-1.5"
    >
      {attentionNeeded ? (
        <span className="size-1.5 shrink-0 rounded-full bg-status-dot-warning" />
      ) : null}
      <span className="truncate">{mission.title?.trim() || mission.goal || mission.id}</span>
      <span className="text-muted-foreground">{mission.tier}</span>
    </Button>
  );
}

function MissionHeader({
  mission,
  isExpanded,
  isRefreshing,
  upgradingTier,
  onUpgrade,
  onToggleEvents,
  onRefresh,
}: {
  mission: ChiefMissionSnapshot;
  isExpanded: boolean;
  isRefreshing: boolean;
  upgradingTier: UpgradeTargetTier | null;
  onUpgrade: (targetTier: UpgradeTargetTier) => void;
  onToggleEvents: () => void;
  onRefresh: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const isTerminalMission =
    mission.status === "completed" || mission.status === "failed" || mission.status === "canceled";
  const canUpgradeToL1 = !isTerminalMission && mission.tier === "L0";
  const canUpgradeToL2 = !isTerminalMission && (mission.tier === "L0" || mission.tier === "L1");

  const handleUpgradeL1 = useCallback(() => onUpgrade("L1"), [onUpgrade]);
  const handleUpgradeL2 = useCallback(() => onUpgrade("L2"), [onUpgrade]);

  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <CollapsibleTrigger
            type="button"
            className="inline-flex items-center gap-1.5 text-left text-sm font-medium text-foreground hover:text-foreground/80"
            data-testid="chief-mission-toggle"
          >
            {isExpanded ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}
            <span>{mission.title?.trim() || t("chief.panel.untitledMission")}</span>
          </CollapsibleTrigger>
          <Badge variant="outline" data-testid="chief-mission-tier-badge">
            {mission.tier}
          </Badge>
          <Badge
            variant="secondary"
            className={MISSION_STATUS_TONE[mission.status]}
            data-testid="chief-mission-status-badge"
          >
            {t(`chief.missionStatus.${mission.status}`)}
          </Badge>
        </div>
        {mission.goal ? (
          <p className="text-sm text-muted-foreground" data-testid="chief-mission-goal">
            {mission.goal}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {canUpgradeToL1 ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={upgradingTier !== null}
            onClick={handleUpgradeL1}
            data-testid="chief-mission-upgrade-L1"
          >
            {upgradingTier === "L1" ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <ShieldCheck data-icon="inline-start" />
            )}
            {t("chief.actions.upgradeToL1")}
          </Button>
        ) : null}
        {canUpgradeToL2 ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={upgradingTier !== null}
            onClick={handleUpgradeL2}
            data-testid="chief-mission-upgrade-L2"
          >
            {upgradingTier === "L2" ? <Spinner data-icon="inline-start" /> : null}
            {t("chief.actions.upgradeToL2")}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onToggleEvents}
          aria-label={t("chief.actions.toggleActivity")}
          data-testid="chief-mission-events-toggle"
        >
          <History />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label={t("chief.actions.refresh")}
          data-testid="chief-mission-refresh"
        >
          <RefreshCw className={cn(isRefreshing && "animate-spin")} />
        </Button>
      </div>
    </div>
  );
}

function MissionOutcomeGroups({
  mission,
  showCompletedThreads,
  pendingOperations,
  threadErrors,
  onToggleCompleted,
  onOpenAgent,
  onRunThreadOperation,
}: {
  mission: ChiefMissionSnapshot;
  showCompletedThreads: boolean;
  pendingOperations: Readonly<Record<string, ChiefThreadOperation>>;
  threadErrors: Readonly<Record<string, string>>;
  onToggleCompleted: () => void;
  onOpenAgent: (agentId: string, workspaceId?: string | null) => void;
  onRunThreadOperation: (thread: ChiefThreadSnapshot, operation: ChiefThreadOperation) => void;
}): ReactElement {
  const { t } = useTranslation();
  const groupedThreads = useMemo(() => groupThreadsByOutcome(mission.threads), [mission.threads]);

  if (mission.threads.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="chief-mission-no-threads">
        {t("chief.panel.noThreads")}
      </p>
    );
  }

  const hasNonCompletedThreads =
    groupedThreads.needsAttention.length > 0 ||
    groupedThreads.readyToLand.length > 0 ||
    groupedThreads.inProgress.length > 0;

  return (
    <div className="flex flex-col gap-3" data-testid="chief-mission-threads">
      {OUTCOME_GROUP_ORDER.map((groupKey) => {
        const threads = groupedThreads[groupKey];
        if (threads.length === 0) {
          return null;
        }
        const isCompletedGroup = groupKey === "completed" && hasNonCompletedThreads;
        const isGroupVisible = !isCompletedGroup || showCompletedThreads;
        return (
          <div
            key={groupKey}
            className="flex flex-col gap-1.5"
            data-testid={`chief-thread-group-${groupKey}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {t(`chief.groups.${groupKey}`, { count: threads.length })}
              </span>
              {isCompletedGroup ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={onToggleCompleted}
                  data-testid="chief-toggle-completed-threads"
                >
                  {showCompletedThreads
                    ? t("chief.actions.hideCompleted")
                    : t("chief.actions.showCompleted")}
                </Button>
              ) : null}
            </div>
            {isGroupVisible ? (
              <ItemGroup className="gap-2">
                {threads.map((thread) => (
                  <ChiefThreadRow
                    key={thread.id}
                    thread={thread}
                    pendingOperation={pendingOperations[thread.id] ?? null}
                    error={threadErrors[thread.id] ?? null}
                    onOpenAgent={onOpenAgent}
                    onRunOperation={onRunThreadOperation}
                  />
                ))}
              </ItemGroup>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function MissionEventsList({ events }: { events: readonly ChiefEvent[] }): ReactElement {
  const { t } = useTranslation();
  const recent = useMemo(() => events.slice(-10).toReversed(), [events]);

  return (
    <div
      className="flex flex-col gap-1 border-t pt-2 text-xs text-muted-foreground"
      data-testid="chief-mission-events"
    >
      <span className="font-medium">{t("chief.panel.recentActivity")}</span>
      {recent.length === 0 ? (
        <span>{t("chief.panel.noEvents")}</span>
      ) : (
        recent.map((event) => (
          <div key={event.seq} className="flex items-baseline gap-2">
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              #{event.seq}
            </span>
            <span className="min-w-0 flex-1 truncate text-foreground">{event.summary}</span>
          </div>
        ))
      )}
    </div>
  );
}

function getDecisionBannerKey(mission: ChiefMissionSnapshot): string {
  return mission.pendingDecision?.id ?? "no-decision";
}

export function ChiefMissionPanel({
  serverId,
  chiefAgentId,
  onOpenAgent,
}: ChiefMissionPanelProps): ReactElement | null {
  const { t } = useTranslation();
  const { config: daemonConfig } = useDaemonConfig(serverId);
  const {
    missions,
    status,
    error,
    eventsByMissionId,
    refresh,
    loadMissionEvents,
    resolveDecision,
    upgradeMission,
    mergeCheckThread,
    landThread,
    cancelThread,
  } = useChiefMissions({ serverId, chiefAgentId, enabled: true });

  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [showCompletedThreads, setShowCompletedThreads] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [upgradeStates, setUpgradeStates] = useState<Readonly<Record<string, MissionUpgradeState>>>(
    {},
  );
  const pendingUpgradeMissionIds = useRef(new Set<string>());
  const [pendingOperations, setPendingOperations] = useState<
    Readonly<Record<string, ChiefThreadOperation>>
  >({});
  const [threadErrors, setThreadErrors] = useState<Readonly<Record<string, string>>>({});
  const pendingThreadIds = useRef(new Set<string>());
  const landingStrategy = daemonConfig?.chief?.landing?.strategy ?? "squash";

  const openWorkerAgent = useCallback(
    (agentId: string, workspaceId?: string | null) => {
      if (onOpenAgent) {
        onOpenAgent(agentId, workspaceId);
        return;
      }
      navigateToAgent({ serverId, agentId, ...(workspaceId ? { workspaceId } : {}) });
    },
    [onOpenAgent, serverId],
  );

  const activeMission: ChiefMissionSnapshot | null = useMemo(() => {
    if (missions.length === 0) {
      return null;
    }
    if (selectedMissionId) {
      const match = missions.find((mission) => mission.id === selectedMissionId);
      if (match) {
        return match;
      }
    }
    return missions[0] ?? null;
  }, [missions, selectedMissionId]);

  const activeMissionId = activeMission?.id ?? null;
  const {
    pendingTier: upgradingTier,
    error: upgradeError,
    retry: upgradeRetry,
  } = (activeMissionId ? upgradeStates[activeMissionId] : undefined) ?? EMPTY_UPGRADE_STATE;
  useEffect(() => {
    if (!showEvents || activeMissionId === null) {
      return;
    }
    void loadMissionEvents(activeMissionId);
  }, [activeMissionId, loadMissionEvents, showEvents]);

  const handleSelectMission = useCallback((missionId: string) => {
    setSelectedMissionId(missionId);
  }, []);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    void refresh().finally(() => setIsRefreshing(false));
  }, [refresh]);

  const handleToggleEvents = useCallback(() => {
    setShowEvents((current) => !current);
  }, []);

  const handleToggleCompleted = useCallback(() => {
    setShowCompletedThreads((current) => !current);
  }, []);

  const runUpgrade = useCallback(
    async (request: MissionUpgradeRequest) => {
      const { missionId, targetTier } = request;
      if (pendingUpgradeMissionIds.current.has(missionId)) {
        return;
      }
      pendingUpgradeMissionIds.current.add(missionId);
      setUpgradeStates((current) => ({
        ...current,
        [missionId]: { pendingTier: targetTier, error: null, retry: null },
      }));
      try {
        await upgradeMission(request);
      } catch (err) {
        const upgradeMessage = toErrorMessage(err);
        setUpgradeStates((current) => ({
          ...current,
          [missionId]: {
            pendingTier: targetTier,
            error: upgradeMessage,
            retry: isDirtyUpgradeError(upgradeMessage)
              ? { missionId, targetTier, dirtyPolicy: "carry_into_thread_1" }
              : null,
          },
        }));
      } finally {
        pendingUpgradeMissionIds.current.delete(missionId);
        setUpgradeStates((current) => {
          const state = current[missionId];
          if (!state) {
            return current;
          }
          return {
            ...current,
            [missionId]: { ...state, pendingTier: null },
          };
        });
      }
    },
    [upgradeMission],
  );

  const handleUpgrade = useCallback(
    (targetTier: UpgradeTargetTier) => {
      if (activeMissionId !== null) {
        void runUpgrade({ missionId: activeMissionId, targetTier });
      }
    },
    [activeMissionId, runUpgrade],
  );

  const handleCarryDirtyUpgrade = useCallback(() => {
    if (upgradeRetry) {
      void runUpgrade(upgradeRetry);
    }
  }, [runUpgrade, upgradeRetry]);

  const runThreadOperation = useCallback(
    async (thread: ChiefThreadSnapshot, operation: ChiefThreadOperation) => {
      if (pendingThreadIds.current.has(thread.id)) {
        return;
      }
      pendingThreadIds.current.add(thread.id);
      setPendingOperations((current) => ({ ...current, [thread.id]: operation }));
      setThreadErrors((current) => {
        if (!(thread.id in current)) {
          return current;
        }
        const next = { ...current };
        delete next[thread.id];
        return next;
      });

      try {
        if (operation === "mergeCheck") {
          await mergeCheckThread({ threadId: thread.id, missionId: thread.missionId });
          return;
        }
        if (operation === "land") {
          const confirmed = await confirmDialog({
            title: t("chief.actions.landConfirmTitle"),
            message: t("chief.actions.landConfirmMessage", {
              title: thread.title,
              strategy: landingStrategy,
            }),
            confirmLabel: t("chief.actions.land"),
            cancelLabel: t("common.actions.cancel"),
            destructive: false,
          });
          if (!confirmed) {
            return;
          }
          await landThread({
            threadId: thread.id,
            missionId: thread.missionId,
            strategy: landingStrategy,
            commitMessage: thread.title,
          });
          return;
        }

        const confirmed = await confirmDialog({
          title: t("chief.actions.cancelConfirmTitle"),
          message: t("chief.actions.cancelConfirmMessage", { title: thread.title }),
          confirmLabel: t("chief.actions.cancelThread"),
          cancelLabel: t("common.actions.cancel"),
          destructive: true,
        });
        if (!confirmed) {
          return;
        }
        await cancelThread({
          threadId: thread.id,
          missionId: thread.missionId,
          reason: "Canceled by user from mission panel",
        });
      } catch (err) {
        const message = toErrorMessage(err);
        setThreadErrors((current) => ({ ...current, [thread.id]: message }));
      } finally {
        pendingThreadIds.current.delete(thread.id);
        setPendingOperations((current) => {
          const next = { ...current };
          delete next[thread.id];
          return next;
        });
      }
    },
    [cancelThread, landThread, landingStrategy, mergeCheckThread, t],
  );

  if (status === "error" && missions.length === 0) {
    return (
      <div className="border-b px-4 py-3" data-testid="chief-mission-panel-error">
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>{t("chief.panel.loadError")}</AlertTitle>
          <AlertDescription>{error ?? t("chief.errors.unknownError")}</AlertDescription>
          <AlertAction>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              {t("common.actions.retry")}
            </Button>
          </AlertAction>
        </Alert>
      </div>
    );
  }

  if (!activeMission) {
    return null;
  }

  const activeMissionAttention = hasActiveSystemAttention(activeMission.systemAttention)
    ? activeMission.systemAttention
    : null;
  const missionEvents = eventsByMissionId.get(activeMission.id) ?? EMPTY_EVENTS;

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={setIsExpanded}
      className="border-b bg-background"
      data-testid="chief-mission-panel"
    >
      <div className="mx-auto flex w-full max-w-[820px] flex-col gap-3 px-4 py-3">
        {missions.length > 1 ? (
          <div className="flex flex-wrap items-center gap-1.5" data-testid="chief-mission-tabs">
            {missions.map((mission) => (
              <MissionTabButton
                key={mission.id}
                mission={mission}
                isSelected={mission.id === activeMission.id}
                onSelect={handleSelectMission}
              />
            ))}
          </div>
        ) : null}

        <MissionHeader
          mission={activeMission}
          isExpanded={isExpanded}
          isRefreshing={isRefreshing}
          upgradingTier={upgradingTier}
          onUpgrade={handleUpgrade}
          onToggleEvents={handleToggleEvents}
          onRefresh={handleRefresh}
        />

        <CollapsibleContent className="flex max-h-[45vh] flex-col gap-3 overflow-y-auto pr-0.5">
          {upgradeError ? (
            <Alert variant="destructive" data-testid="chief-mission-upgrade-error">
              <CircleAlert />
              <AlertTitle>{t("chief.errors.upgradeFailed")}</AlertTitle>
              <AlertDescription>{upgradeError}</AlertDescription>
              {upgradeRetry ? (
                <AlertAction>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={upgradingTier !== null}
                    onClick={handleCarryDirtyUpgrade}
                    data-testid="chief-mission-upgrade-carry-dirty"
                  >
                    {t("chief.actions.carryChangesToThread1")}
                  </Button>
                </AlertAction>
              ) : null}
            </Alert>
          ) : null}

          {activeMissionAttention ? (
            <MissionAttentionStrip
              attention={activeMissionAttention}
              workspaceId={activeMission.baseWorkspaceId}
              onOpenAgent={openWorkerAgent}
            />
          ) : null}

          <ChiefDecisionBanner
            key={getDecisionBannerKey(activeMission)}
            mission={activeMission}
            onResolveDecision={resolveDecision}
          />

          <MissionOutcomeGroups
            mission={activeMission}
            showCompletedThreads={showCompletedThreads}
            pendingOperations={pendingOperations}
            threadErrors={threadErrors}
            onToggleCompleted={handleToggleCompleted}
            onOpenAgent={openWorkerAgent}
            onRunThreadOperation={runThreadOperation}
          />

          {showEvents ? <MissionEventsList events={missionEvents} /> : null}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function SoloAgentUpgradeAction({
  serverId,
  agentId,
}: {
  serverId: string;
  agentId: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const upgradeMission = useChiefStore((state) => state.upgradeMission);
  const existingMission = useChiefStore((state) =>
    selectMissionForAgent(state.servers[serverId]?.missions, agentId),
  );
  const [isUpgrading, setIsUpgrading] = useState(false);

  const runUpgrade = useCallback(
    async (targetTier: "L1" | "L2") => {
      if (!client || !isConnected || isUpgrading) {
        return;
      }
      setIsUpgrading(true);
      try {
        await upgradeMission({
          serverId,
          client,
          options: existingMission
            ? { missionId: existingMission.id, targetTier }
            : { soloAgentId: agentId, targetTier },
        });
      } catch (err) {
        const message = toErrorMessage(err);
        if (targetTier === "L2" && isDirtyUpgradeError(message)) {
          const confirmed = await confirmDialog({
            title: t("chief.actions.dirtyUpgradeConfirmTitle"),
            message: t("chief.actions.dirtyUpgradeConfirmMessage"),
            confirmLabel: t("chief.actions.carryChangesToThread1"),
            cancelLabel: t("common.actions.cancel"),
          });
          if (confirmed) {
            try {
              await upgradeMission({
                serverId,
                client,
                options: {
                  ...(existingMission
                    ? { missionId: existingMission.id }
                    : { soloAgentId: agentId }),
                  targetTier: "L2",
                  dirtyPolicy: "carry_into_thread_1",
                },
              });
              return;
            } catch (retryErr) {
              showAlert(t("chief.errors.upgradeFailed"), toErrorMessage(retryErr));
              return;
            }
          }
          return;
        }
        showAlert(t("chief.errors.upgradeFailed"), message);
      } finally {
        setIsUpgrading(false);
      }
    },
    [agentId, client, existingMission, isConnected, isUpgrading, serverId, t, upgradeMission],
  );

  const handleSelectL1 = useCallback(() => {
    void runUpgrade("L1");
  }, [runUpgrade]);

  const handleSelectL2 = useCallback(() => {
    void runUpgrade("L2");
  }, [runUpgrade]);

  if (!client || !isConnected) {
    return null;
  }
  if (existingMission && existingMission.tier === "L2") {
    return null;
  }

  const canUpgradeToL1 = !existingMission || existingMission.tier === "L0";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isUpgrading}
          data-testid="solo-agent-upgrade-trigger"
          className="pointer-events-auto gap-1.5"
        >
          {isUpgrading ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ShieldCheck data-icon="inline-start" />
          )}
          <span>{isUpgrading ? t("chief.actions.upgrading") : t("chief.actions.orchestrate")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={keepFocusElsewhere}>
        {canUpgradeToL1 ? (
          <DropdownMenuItem onSelect={handleSelectL1} data-testid="solo-agent-upgrade-L1">
            {t("chief.actions.upgradeSoloToL1")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={handleSelectL2} data-testid="solo-agent-upgrade-L2">
          {t("chief.actions.upgradeSoloToL2")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
