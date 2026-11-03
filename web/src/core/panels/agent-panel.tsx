// Port of archive/expo-app:packages/app/src/panels/agent-panel.tsx. The panel logic is the Expo file's (load and
// lookup states, reconnect toast, attention clearing, history sync, archive, tracks, rewind
// restore); the view is DOM and Tailwind. Keep the two in step until the cutover.
// Converted from the Expo file by archive/expo-app:web/scripts/port/agent-panel.py; edit it directly.
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { Button } from "~/components/ui/button";
import type { DaemonClient } from "@bytetrue/client/internal/daemon-client";
import type { TFunction } from "i18next";
import { ArrowDownToLine, ListChevronsDownUp, SquarePen } from "lucide-react";
import React, {
  memo,
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { shallow, useShallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { AgentStreamView, type AgentStreamViewHandle } from "@/agent-stream/view";
import { ArchivedAgentCallout } from "@/components/archived-agent-callout";
import { FileDropZone } from "@/components/file-drop/file-drop-zone";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { Composer } from "@/composer";
import { useWorkspaceHasDiffStat } from "@/composer/workspace-diff-stat";
import {
  composerPillClassName,
  resolveComposerTrackControlClearance,
  resolveComposerTrackTailClearance,
} from "@/composer/pill-styles";
import { getActiveMessageSubmissions } from "@/composer/submission/model";
import { RewindComposerRestoreProvider } from "@/components/rewind/composer-restore";
import { getProviderIcon } from "@/components/provider-icons";
import { type ToastApi, useToastApi } from "@/components/toast-host";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import type { WorkspaceComposerAttachment } from "@/attachments/types";
import { useWorkspaceAttachmentScopeKey } from "@/attachments/workspace-attachments-store";
import { COMPACT_FORM_FACTOR_WIDTH, useIsCompactFormFactor } from "@/constants/layout";
import { useAgentAttentionClear } from "@/hooks/use-agent-attention-clear";
import { useAgentInputDraft, type AgentInputDraft } from "@/composer/draft/input-draft";
import {
  type AgentScreenAgent,
  type AgentScreenContinuity,
  type AgentScreenMissingState,
  type AgentScreenViewState,
  useAgentScreenStateMachine,
} from "@/hooks/use-agent-screen-state-machine";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
import { reconcileMissingAgentStateWithPresentAgent } from "@/panels/agent-panel-load-state";
import {
  reconcileReconnectToastState,
  type ReconnectToastState,
} from "@/panels/reconnect-toast-state";
import { usePaneContext, usePaneFocus } from "@/panels/pane-context";
import { definePanel, type PanelDescriptor } from "@/panels/panel-registry";
import { RenderProfile } from "@/utils/render-profiler";
import { useHasPluginComposerPills } from "@/plugins";
import { buildDraftPanelDescriptor } from "@/panels/draft-panel-descriptor";
import {
  type HostRuntimeConnectionStatus,
  getHostRuntimeConnectionStatusSince,
  useHostRuntimeClient,
  useHostRuntimeConnectionStatus,
  useHostRuntimeIsConnected,
  useHostRuntimeLastError,
  useHosts,
} from "@/runtime/host-runtime";
import {
  deriveRouteBottomAnchorIntent,
  deriveRouteBottomAnchorRequest,
} from "@/screens/agent/agent-ready-screen-bottom-anchor";
import { WorkspaceDraftAgentTab } from "@/composer/draft/workspace-tab";
import { AgentTracks, hasAgentTracks } from "@/panels/agent-tracks";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import { buildDraftStoreKey, generateDraftId } from "@/stores/draft-keys";
import {
  selectAgentTimelineState,
  selectAgentTurnPresentation,
  type Agent,
  useSessionStore,
} from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { openWorkspaceChanges } from "@/workspace-tabs/open-supporting-view";
import { useSettings } from "@/hooks/use-settings";
import { ICON_SIZE } from "@/styles/theme";
import { Spinner } from "~/components/ui/spinner";
import type { PendingPermission } from "@/types/shared";
import type { StreamItem, TodoEntry } from "@/types/stream";
import type { ViewedTimelineStatus, ViewedTimelineUiBridge } from "@/timeline/viewed-timeline-sync";
import { useArchiveFinishedSubagents, useSubagentsForParent } from "@/subagents";
import { getInitDeferred, getInitKey } from "@/utils/agent-initialization";
import { derivePendingPermissionKey, normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import { applyLegacyDaemonWorkspaceOwnership } from "@/workspace/legacy-daemon-workspaces";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import { buildDraftAgentSetup, type ClientSlashCommand } from "@/client-slash-commands";

interface ChatAgentStateShape {
  serverId: string | null;
  id: string | null;
  provider?: Agent["provider"];
  status: Agent["status"] | null;
  cwd: string | null;
  workspaceId?: string;
  capabilities?: Agent["capabilities"];
  currentModeId?: Agent["currentModeId"];
  model?: Agent["model"];
  thinkingOptionId?: Agent["thinkingOptionId"];
  runtimeInfo?: Agent["runtimeInfo"];
  features?: Agent["features"];
  lastError?: Agent["lastError"] | null;
}

const RECONNECT_TOAST_DELAY_MS = 1_000;

const reconnectToastStateByServerId = new Map<string, ReconnectToastState>();
const RECONNECT_TOAST_ID = "agent-reconnecting";

interface ChatAgentSelectedState extends ChatAgentStateShape {
  archivedAt: Date | null;
  requiresAttention: boolean;
  attentionReason: Agent["attentionReason"] | null;
}

function resolveChatAgentFromSession(
  state: ReturnType<typeof useSessionStore.getState>,
  serverId: string,
  agentId: string | undefined,
): Agent | null {
  if (!agentId) return null;
  const session = state.sessions[serverId];
  return session?.agents?.get(agentId) ?? session?.agentDetails?.get(agentId) ?? null;
}

function readViewedTimelineError(input: {
  agentId: string | undefined;
  status: ViewedTimelineStatus;
  sync: ViewedTimelineUiBridge | null;
}): string | null {
  if (!input.agentId || input.status !== "error" || !input.sync) return null;
  return input.sync.getAgentTimelineError(input.agentId);
}

const EMPTY_CHAT_AGENT_STATE: ChatAgentSelectedState = {
  serverId: null,
  id: null,
  status: null,
  cwd: null,
  lastError: null,
  archivedAt: null,
  requiresAttention: false,
  attentionReason: null,
};

function selectChatAgentState(
  state: ReturnType<typeof useSessionStore.getState>,
  serverId: string,
  agentId: string | undefined,
): ChatAgentSelectedState {
  const agent = resolveChatAgentFromSession(state, serverId, agentId);
  if (!agent) return EMPTY_CHAT_AGENT_STATE;
  return {
    serverId: agent.serverId,
    id: agent.id,
    provider: agent.provider,
    status: agent.status,
    cwd: agent.cwd,
    workspaceId: agent.workspaceId,
    capabilities: agent.capabilities,
    currentModeId: agent.currentModeId,
    model: agent.model,
    thinkingOptionId: agent.thinkingOptionId,
    runtimeInfo: agent.runtimeInfo,
    features: agent.features,
    lastError: agent.lastError ?? null,
    archivedAt: agent.archivedAt ?? null,
    requiresAttention: agent.requiresAttention ?? false,
    attentionReason: agent.attentionReason ?? null,
  };
}

function buildChatAgentFromState(
  state: ChatAgentStateShape,
  projectPlacement: Agent["projectPlacement"] | null,
): AgentScreenAgent | null {
  if (!state.serverId || !state.id || !state.status || !state.cwd) {
    return null;
  }
  return {
    serverId: state.serverId,
    id: state.id,
    provider: state.provider,
    status: state.status,
    cwd: state.cwd,
    workspaceId: state.workspaceId,
    capabilities: state.capabilities,
    currentModeId: state.currentModeId,
    model: state.model,
    thinkingOptionId: state.thinkingOptionId,
    runtimeInfo: state.runtimeInfo,
    features: state.features,
    lastError: state.lastError ?? null,
    projectPlacement,
  };
}

function AgentLoadErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background" data-testid="agent-load-error">
      <div className="flex flex-1 flex-col items-center justify-center">
        <span className="text-center text-sm text-muted-foreground">
          {t("agentPanel.states.failedToLoad")}
        </span>
        <span className="mt-2 text-center text-sm text-muted-foreground">{message}</span>
        <div className="mt-4">
          <Button
            size="sm"
            variant="secondary"
            onClick={onRetry}
            data-testid="agent-load-error-retry"
          >
            {t("common.actions.retry")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function renderChatAgentNonReadyView(args: {
  viewState: AgentScreenViewState;
  effectiveAgent: AgentScreenAgent | null;
  t: TFunction;
  onRetryLoad: () => void;
}): React.ReactElement | null {
  const { viewState, effectiveAgent, t, onRetryLoad } = args;
  if (viewState.tag === "not_found") {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-background" data-testid="agent-not-found">
        <div className="flex flex-1 flex-col items-center justify-center">
          <span className="text-center text-sm text-muted-foreground">
            {t("agentPanel.states.notFound")}
          </span>
        </div>
      </div>
    );
  }
  if (viewState.tag === "error") {
    return <AgentLoadErrorView message={viewState.message} onRetry={onRetryLoad} />;
  }
  if (viewState.tag === "boot" || !effectiveAgent) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-background" data-testid="agent-loading">
        <div className="flex flex-1 flex-col items-center justify-center">
          <Spinner className="size-8 text-muted-foreground" />
        </div>
      </div>
    );
  }
  return null;
}

function formatProviderLabel(provider: Agent["provider"]): string {
  if (!provider) {
    return "Agent";
  }
  return provider
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resolveWorkspaceAgentTabLabel(title: string | null | undefined): string | null {
  if (typeof title !== "string") {
    return null;
  }
  const normalized = title.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.toLowerCase() === "new agent") {
    return null;
  }
  return normalized;
}

function shouldStoreFetchedAgentInActiveDirectory(agent: Agent): boolean {
  return !agent.archivedAt && Boolean(agent.projectPlacement);
}

type FetchAgentResult = Awaited<ReturnType<DaemonClient["fetchAgent"]>>;

function storeFetchedAgentDetail(input: {
  serverId: string;
  result: NonNullable<FetchAgentResult>;
}): Agent {
  const normalized = normalizeAgentSnapshot(input.result.agent, input.serverId);
  const hydrated: Agent = applyLegacyDaemonWorkspaceOwnership({
    serverId: input.serverId,
    agent: {
      ...normalized,
      projectPlacement: input.result.project,
    },
  });
  const store = useSessionStore.getState();

  if (shouldStoreFetchedAgentInActiveDirectory(hydrated)) {
    getHostRuntimeStore().acceptAgentSnapshot(input.serverId, hydrated);
  } else {
    store.setAgentDetails(input.serverId, (previous) => {
      const next = new Map(previous);
      next.set(hydrated.id, hydrated);
      return next;
    });
  }

  store.setPendingPermissions(input.serverId, (previous) => {
    const next = new Map(previous);
    for (const [key, pending] of next.entries()) {
      if (pending.agentId === hydrated.id) {
        next.delete(key);
      }
    }
    for (const request of hydrated.pendingPermissions) {
      const key = derivePendingPermissionKey(hydrated.id, request);
      next.set(key, { key, agentId: hydrated.id, request });
    }
    return next;
  });

  return hydrated;
}

function useAgentPanelDescriptor(
  target: { kind: "agent"; agentId: string },
  context: { serverId: string },
): PanelDescriptor {
  const descriptorState = useSessionStore(
    useShallow((state) => {
      const session = state.sessions[context.serverId];
      const agent =
        session?.agents?.get(target.agentId) ?? session?.agentDetails?.get(target.agentId) ?? null;
      return {
        provider: agent?.provider ?? "codex",
        title: agent?.title ?? null,
        status: agent?.status ?? null,
        pendingPermissionCount: agent?.pendingPermissions.length ?? 0,
        requiresAttention: agent?.requiresAttention ?? false,
        attentionReason: agent?.attentionReason ?? null,
        isTurnActive: selectAgentTurnPresentation(session, target.agentId).isActive,
      };
    }),
  );
  const provider = descriptorState.provider;
  const label = resolveWorkspaceAgentTabLabel(descriptorState.title);
  const icon = getProviderIcon(provider, context.serverId);

  return {
    label: label ?? "",
    subtitle: `${formatProviderLabel(provider)} agent`,
    tooltip: label ?? `${formatProviderLabel(provider)} agent`,
    titleState: label ? "ready" : "loading",
    icon,
    statusBucket: descriptorState.status
      ? deriveSidebarStateBucket({
          status: descriptorState.isTurnActive ? "running" : descriptorState.status,
          pendingPermissionCount: descriptorState.pendingPermissionCount,
          requiresAttention: descriptorState.requiresAttention,
          attentionReason: descriptorState.attentionReason,
        })
      : null,
  };
}

function AgentPanel() {
  const { serverId, workspaceId, target, openFileInWorkspace } = usePaneContext();
  const { isInteractive } = usePaneFocus();
  invariant(target.kind === "agent", "AgentPanel requires agent target");

  return (
    <AgentPanelContent
      serverId={serverId}
      workspaceId={workspaceId}
      agentId={target.agentId}
      isPaneFocused={isInteractive}
      onOpenWorkspaceFile={openFileInWorkspace}
    />
  );
}

function DraftPanel() {
  const {
    serverId,
    workspaceId,
    tabId,
    target,
    openFileInWorkspace,
    openImportSheet,
    retargetCurrentTab,
  } = usePaneContext();
  const { isInteractive } = usePaneFocus();
  invariant(target.kind === "draft", "DraftPanel requires draft target");

  const handleCreated = useCallback(
    (agentSnapshot: Parameters<typeof normalizeAgentSnapshot>[0]) => {
      const normalized = normalizeAgentSnapshot(agentSnapshot, serverId);
      const agent = applyLegacyDaemonWorkspaceOwnership({ serverId, agent: normalized });
      getHostRuntimeStore().acceptAgentSnapshot(serverId, agent);
      retargetCurrentTab({ kind: "agent", agentId: agentSnapshot.id });
    },
    [retargetCurrentTab, serverId],
  );

  return (
    <WorkspaceDraftAgentTab
      serverId={serverId}
      workspaceId={workspaceId}
      tabId={tabId}
      draftId={target.draftId}
      initialSetup={target.setup}
      isPaneFocused={isInteractive}
      onOpenWorkspaceFile={openFileInWorkspace}
      onCreated={handleCreated}
      onOpenImportSheet={openImportSheet}
    />
  );
}

export function AgentConversationPanel() {
  const { target } = usePaneContext();
  if (target.kind === "draft") {
    return <DraftPanel />;
  }
  if (target.kind === "agent") {
    return <AgentPanel />;
  }
  invariant(false, "AgentConversationPanel requires an agent or draft target");
}

export const agentPanelRegistration = definePanel("agent", {
  component: AgentConversationPanel,
  useDescriptor: useAgentPanelDescriptor,
});

export function useDraftPanelDescriptor(
  target: { kind: "draft"; draftId: string },
  context: { serverId: string },
) {
  const createDescriptorState = useCreateFlowStore(
    useShallow((state) => {
      const pending = state.pendingByDraftId[target.draftId];
      if (pending?.serverId !== context.serverId || pending.lifecycle !== "active") {
        return {
          isCreating: false,
          pendingPrompt: null,
        };
      }
      return {
        isCreating: true,
        pendingPrompt: pending.text,
      };
    }),
  );

  return buildDraftPanelDescriptor({
    ...createDescriptorState,
    icon: SquarePen,
  });
}

const EMPTY_STREAM_ITEMS: StreamItem[] = [];
const EMPTY_MESSAGE_SUBMISSIONS = [] as const;
const EMPTY_PENDING_PERMISSIONS = new Map<string, PendingPermission>();
const EMPTY_PENDING_PERMISSION_LIST: PendingPermission[] = [];

type RouteBottomAnchorRequest = ReturnType<typeof deriveRouteBottomAnchorRequest>;

function findActiveCreateHandoff(input: {
  pendingByDraftId: ReturnType<typeof useCreateFlowStore.getState>["pendingByDraftId"];
  serverId: string;
  agentId?: string;
}): boolean {
  if (!input.agentId) {
    return false;
  }
  return Object.values(input.pendingByDraftId).some(
    (pending) =>
      pending.lifecycle === "sent" &&
      pending.serverId === input.serverId &&
      pending.agentId === input.agentId,
  );
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isNotFoundErrorMessage(message: string): boolean {
  return /agent not found|not found/i.test(message);
}

type AgentLookupState =
  | { tag: "idle" }
  | { tag: "loading" }
  | { tag: "not_found"; message: string }
  | { tag: "error"; message: string };

function AgentPanelContent({
  serverId,
  workspaceId,
  agentId,
  isPaneFocused,
  onOpenWorkspaceFile,
}: {
  serverId: string;
  workspaceId: string;
  agentId: string;
  isPaneFocused: boolean;
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
}) {
  const { t } = useTranslation();
  const resolvedAgentId = agentId.trim() || undefined;
  const resolvedServerId = serverId.trim() || undefined;
  const daemons = useHosts();
  const runtimeServerId = resolvedServerId ?? "";
  const runtimeClient = useHostRuntimeClient(runtimeServerId);
  const runtimeIsConnected = useHostRuntimeIsConnected(runtimeServerId);
  const runtimeConnectionStatus = useHostRuntimeConnectionStatus(runtimeServerId);
  const runtimeLastError = useHostRuntimeLastError(runtimeServerId);
  const hasCachedAgent = useSessionStore((state) => {
    if (!resolvedServerId || !resolvedAgentId) return false;
    const session = state.sessions[resolvedServerId];
    return Boolean(
      session?.agents.has(resolvedAgentId) || session?.agentDetails.has(resolvedAgentId),
    );
  });

  const connectionServerId = resolvedServerId ?? null;
  const daemon = connectionServerId
    ? (daemons.find((entry) => entry.serverId === connectionServerId) ?? null)
    : null;
  const serverLabel =
    daemon?.label ?? connectionServerId ?? t("agentPanel.unavailable.selectedHost");
  const isUnknownDaemon = Boolean(connectionServerId && !daemon);
  const connectionStatus: HostRuntimeConnectionStatus =
    isUnknownDaemon && runtimeConnectionStatus === "connecting"
      ? "offline"
      : runtimeConnectionStatus;
  const lastConnectionError = runtimeLastError;

  if (!resolvedServerId || (!runtimeClient && !hasCachedAgent)) {
    return (
      <AgentSessionUnavailableState
        serverLabel={serverLabel}
        connectionStatus={connectionStatus}
        lastError={lastConnectionError}
        isUnknownDaemon={isUnknownDaemon}
        t={t}
      />
    );
  }

  return (
    <AgentPanelBody
      serverId={resolvedServerId}
      workspaceId={workspaceId}
      agentId={resolvedAgentId}
      isPaneFocused={isPaneFocused}
      client={runtimeClient}
      isConnected={runtimeIsConnected}
      connectionStatus={connectionStatus}
      onOpenWorkspaceFile={onOpenWorkspaceFile}
    />
  );
}

function AgentPanelBody({
  serverId,
  workspaceId,
  agentId,
  isPaneFocused,
  client,
  isConnected,
  connectionStatus,
  onOpenWorkspaceFile,
}: {
  serverId: string;
  workspaceId: string;
  agentId?: string;
  isPaneFocused: boolean;
  client: ReturnType<typeof useHostRuntimeClient>;
  isConnected: boolean;
  connectionStatus: HostRuntimeConnectionStatus;
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
}) {
  const { t } = useTranslation();
  const { isArchivingAgent: _isArchivingAgent } = useArchiveAgent();
  const hasSession = useSessionStore((state) => Boolean(state.sessions[serverId]));
  const projectPlacement = useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      if (!agentId) {
        return null;
      }
      const session = state.sessions[serverId];
      return (
        session?.agents?.get(agentId)?.projectPlacement ??
        session?.agentDetails?.get(agentId)?.projectPlacement ??
        null
      );
    },
    (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b),
  );
  const agentState = useSessionStore(
    useShallow((state) => selectChatAgentState(state, serverId, agentId)),
  );
  const [lookupState, setLookupState] = useState<AgentLookupState>({ tag: "idle" });
  const lookupAttemptTokenRef = useRef(0);
  const retryAgentLookup = useCallback(() => setLookupState({ tag: "idle" }), []);
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const resolvePendingAgent = useWorkspaceLayoutStore((state) => state.resolvePendingAgent);

  useEffect(() => {
    lookupAttemptTokenRef.current += 1;
    setLookupState({ tag: "idle" });
  }, [agentId, serverId]);

  useEffect(() => {
    if (!agentId) {
      return;
    }
    if (agentState.id) {
      if (workspaceKey) {
        resolvePendingAgent(workspaceKey, agentId);
      }
      if (lookupState.tag !== "idle") {
        setLookupState({ tag: "idle" });
      }
      return;
    }
    if (!client || !isConnected || !hasSession) {
      return;
    }
    if (lookupState.tag === "loading" || lookupState.tag === "not_found") {
      return;
    }

    setLookupState({ tag: "loading" });
    const attemptToken = ++lookupAttemptTokenRef.current;

    client
      .fetchAgent({ agentId })
      .then((result) => {
        if (attemptToken !== lookupAttemptTokenRef.current) {
          return;
        }
        if (!result) {
          if (workspaceKey) {
            resolvePendingAgent(workspaceKey, agentId);
          }
          setLookupState({
            tag: "not_found",
            message: `Agent not found: ${agentId}`,
          });
          return;
        }

        storeFetchedAgentDetail({ serverId, result });
        if (workspaceKey) {
          resolvePendingAgent(workspaceKey, agentId);
        }
        setLookupState({ tag: "idle" });
        return;
      })
      .catch((error) => {
        if (attemptToken !== lookupAttemptTokenRef.current) {
          return;
        }
        const message = toErrorMessage(error);
        if (isNotFoundErrorMessage(message)) {
          if (workspaceKey) {
            resolvePendingAgent(workspaceKey, agentId);
          }
          setLookupState({ tag: "not_found", message });
          return;
        }
        setLookupState({ tag: "error", message });
      });
  }, [
    agentId,
    agentState.id,
    client,
    hasSession,
    isConnected,
    lookupState.tag,
    resolvePendingAgent,
    serverId,
    workspaceKey,
  ]);

  if (lookupState.tag === "not_found") {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-background" data-testid="agent-not-found">
        <div className="flex flex-1 flex-col items-center justify-center">
          <span className="text-center text-sm text-muted-foreground">
            {t("agentPanel.states.notFound")}
          </span>
        </div>
      </div>
    );
  }

  if (lookupState.tag === "error") {
    return <AgentLoadErrorView message={lookupState.message} onRetry={retryAgentLookup} />;
  }

  const agent: AgentScreenAgent | null =
    agentState.serverId && agentState.id && agentState.status && agentState.cwd
      ? {
          serverId: agentState.serverId,
          id: agentState.id,
          provider: agentState.provider,
          status: agentState.status,
          cwd: agentState.cwd,
          workspaceId: agentState.workspaceId,
          capabilities: agentState.capabilities,
          currentModeId: agentState.currentModeId,
          model: agentState.model,
          thinkingOptionId: agentState.thinkingOptionId,
          runtimeInfo: agentState.runtimeInfo,
          features: agentState.features,
          lastError: agentState.lastError ?? null,
          projectPlacement,
        }
      : null;

  if (!agent) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-background" data-testid="agent-loading">
        <div className="flex flex-1 flex-col items-center justify-center">
          <Spinner className="size-8 text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <ChatAgentContent
      serverId={serverId}
      workspaceId={workspaceId}
      agentId={agentId}
      isPaneFocused={isPaneFocused}
      client={client}
      isConnected={isConnected}
      connectionStatus={connectionStatus}
      onOpenWorkspaceFile={onOpenWorkspaceFile}
    />
  );
}

function ChatAgentContent({
  serverId,
  workspaceId,
  agentId,
  isPaneFocused,
  client,
  isConnected,
  connectionStatus,
  onOpenWorkspaceFile,
}: {
  serverId: string;
  workspaceId: string;
  agentId?: string;
  isPaneFocused: boolean;
  client: ReturnType<typeof useHostRuntimeClient>;
  isConnected: boolean;
  connectionStatus: HostRuntimeConnectionStatus;
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
}) {
  const { t } = useTranslation();
  const isPaneVisible = useRetainedPanelActive();
  const toastApi = useToastApi();
  const { isArchivingAgent } = useArchiveAgent();
  const streamViewRef = useRef<AgentStreamViewHandle>(null);
  const clearOnAgentBlurRef = useRef<() => void>(() => {});
  const wasPaneFocusedRef = useRef(isPaneFocused);
  const reconnectToastPresentedRef = useRef(false);
  const initAttemptTokenRef = useRef(0);
  const routeBottomAnchorRequestRef = useRef<{
    routeKey: string;
    reason: "initial-entry" | "resume";
  } | null>(null);
  const agentState = useSessionStore(
    useShallow((state) => selectChatAgentState(state, serverId, agentId)),
  );
  const projectPlacement = useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      if (!agentId) {
        return null;
      }
      const session = state.sessions[serverId];
      return (
        session?.agents?.get(agentId)?.projectPlacement ??
        session?.agentDetails?.get(agentId)?.projectPlacement ??
        null
      );
    },
    (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b),
  );
  const isInitializingFromMap = useSessionStore((state) =>
    agentId ? (state.sessions[serverId]?.initializingAgents?.get(agentId) ?? false) : false,
  );
  const historySyncGeneration = useSessionStore(
    (state) => state.sessions[serverId]?.historySyncGeneration ?? 0,
  );
  const replicaTimelineStatus = useSessionStore((state) =>
    agentId
      ? selectAgentTimelineState(state.sessions[serverId], agentId).status
      : ("cold" as const),
  );
  const hasAppliedAuthoritativeHistory = replicaTimelineStatus === "synced";
  const agentHistorySyncGeneration = useSessionStore((state) =>
    agentId ? (state.sessions[serverId]?.agentHistorySyncGeneration?.get(agentId) ?? -1) : -1,
  );
  const viewedTimelineSync = useSessionStore(
    (state) => state.sessions[serverId]?.viewedTimelineSync ?? null,
  );
  const subscribeToVisibilityCatchUp = useCallback(
    (listener: () => void) => viewedTimelineSync?.subscribe(listener) ?? (() => {}),
    [viewedTimelineSync],
  );
  const readTimelineStatus = useCallback(
    () =>
      !agentId || !viewedTimelineSync
        ? ("ready" as const)
        : viewedTimelineSync.getAgentTimelineStatus(agentId),
    [agentId, viewedTimelineSync],
  );
  const timelineStatus = useSyncExternalStore(
    subscribeToVisibilityCatchUp,
    readTimelineStatus,
    readTimelineStatus,
  );
  const visibilityCatchUpStatus = isPaneVisible ? timelineStatus : "ready";
  const visibilityCatchUpError = readViewedTimelineError({
    agentId,
    status: visibilityCatchUpStatus,
    sync: viewedTimelineSync,
  });
  const hasActiveCreateHandoff = useCreateFlowStore((state) =>
    findActiveCreateHandoff({ pendingByDraftId: state.pendingByDraftId, serverId, agentId }),
  );
  const hasSession = useSessionStore((state) => Boolean(state.sessions[serverId]));
  const [missingAgentState, setMissingAgentState] = useState<AgentScreenMissingState>({
    kind: "idle",
  });

  const hasHydratedHistoryBefore =
    hasAppliedAuthoritativeHistory || replicaTimelineStatus === "painted";

  const attentionController = useAgentAttentionClear({
    agentId,
    client,
    isConnected,
    requiresAttention: agentState.requiresAttention,
    attentionReason: agentState.attentionReason,
    isScreenFocused: isPaneFocused,
  });
  useEffect(() => {
    clearOnAgentBlurRef.current = attentionController.clearOnAgentBlur;
  }, [attentionController.clearOnAgentBlur]);

  const shouldPresentReconnectToast =
    isPaneVisible && connectionStatus !== "online" && connectionStatus !== "idle";

  useEffect(() => {
    if (connectionStatus === "online" || connectionStatus === "idle") {
      reconnectToastStateByServerId.delete(serverId);
    }

    if (!shouldPresentReconnectToast) {
      if (reconnectToastPresentedRef.current) {
        reconnectToastPresentedRef.current = false;
        toastApi.dismiss(RECONNECT_TOAST_ID);
      }
      return;
    }

    const startedAt = getHostRuntimeConnectionStatusSince(serverId) ?? Date.now();
    const previousReconnectToastState = reconnectToastStateByServerId.get(serverId);
    const reconnectToastState = reconcileReconnectToastState(
      previousReconnectToastState,
      startedAt,
    );
    if (reconnectToastState !== previousReconnectToastState) {
      reconnectToastStateByServerId.set(serverId, reconnectToastState);
    }

    if (reconnectToastState.presented) {
      if (!reconnectToastPresentedRef.current) {
        reconnectToastPresentedRef.current = true;
        toastApi.show(t("agentPanel.states.reconnecting"), {
          durationMs: null,
          icon: (
            <span
              data-testid="agent-reconnecting-status-dot"
              className="block size-2 rounded-full bg-amber-500"
            />
          ),
          testID: "agent-reconnecting-toast",
          id: RECONNECT_TOAST_ID,
        });
      }
      return;
    }

    const delayMs = Math.max(0, startedAt + RECONNECT_TOAST_DELAY_MS - Date.now());
    const timer = setTimeout(() => {
      if (reconnectToastStateByServerId.get(serverId) !== reconnectToastState) {
        return;
      }
      reconnectToastState.presented = true;
      reconnectToastPresentedRef.current = true;
      toastApi.show(t("agentPanel.states.reconnecting"), {
        durationMs: null,
        icon: (
          <span
            data-testid="agent-reconnecting-status-dot"
            className="block size-2 rounded-full bg-amber-500"
          />
        ),
        testID: "agent-reconnecting-toast",
        id: RECONNECT_TOAST_ID,
      });
    }, delayMs);

    return () => clearTimeout(timer);
  }, [connectionStatus, serverId, shouldPresentReconnectToast, toastApi, t]);

  const isArchivingCurrentAgent = Boolean(agentId && isArchivingAgent({ serverId, agentId }));

  useEffect(() => {
    if (wasPaneFocusedRef.current && !isPaneFocused) {
      clearOnAgentBlurRef.current();
    }
    wasPaneFocusedRef.current = isPaneFocused;
  }, [isPaneFocused]);

  useEffect(() => {
    return () => {
      if (wasPaneFocusedRef.current) {
        clearOnAgentBlurRef.current();
      }
    };
  }, []);

  const isInitializing = agentId ? isInitializingFromMap : false;
  const isHistorySyncing = useMemo(() => {
    if (!agentId || !isInitializing) {
      return false;
    }
    const initKey = getInitKey(serverId, agentId);
    return Boolean(getInitDeferred(initKey));
  }, [agentId, isInitializing, serverId]);
  const needsAuthoritativeSync = useMemo(() => {
    if (!agentId) {
      return false;
    }
    return agentHistorySyncGeneration < historySyncGeneration;
  }, [agentHistorySyncGeneration, agentId, historySyncGeneration]);

  const agent = useMemo<AgentScreenAgent | null>(
    () => buildChatAgentFromState(agentState, projectPlacement),
    [agentState, projectPlacement],
  );
  const continuity = useMemo<AgentScreenContinuity>(() => {
    if (!hasActiveCreateHandoff || !agentId) {
      return { kind: "none" };
    }
    return {
      kind: "optimistic-create",
      agent: {
        serverId,
        id: agentId,
        status: "running",
        cwd: agent?.cwd ?? ".",
        projectPlacement: agent?.projectPlacement ?? null,
      },
    };
  }, [agent, agentId, hasActiveCreateHandoff, serverId]);

  const viewState = useAgentScreenStateMachine({
    routeKey: `${serverId}:${agentId ?? ""}`,
    input: {
      agent: agent ?? null,
      isArchived: agentState.archivedAt !== null,
      missingAgentState,
      isConnected,
      isArchivingCurrentAgent,
      isHistorySyncing,
      needsAuthoritativeSync,
      visibilityCatchUpStatus,
      visibilityCatchUpError,
      continuity,
      hasHydratedHistoryBefore,
    },
  });

  const effectiveAgent = viewState.tag === "ready" ? viewState.agent : null;
  const routeEntryKey = agentId ? `${serverId}:${agentId}` : null;
  routeBottomAnchorRequestRef.current = deriveRouteBottomAnchorIntent({
    cachedIntent: routeBottomAnchorRequestRef.current,
    routeKey: routeEntryKey,
    hasAppliedAuthoritativeHistoryAtEntry: hasAppliedAuthoritativeHistory,
  });
  const routeBottomAnchorRequest = useMemo(
    () =>
      deriveRouteBottomAnchorRequest({
        intent: routeBottomAnchorRequestRef.current,
        effectiveAgentId: effectiveAgent?.id ?? null,
      }),
    [effectiveAgent?.id],
  );

  const handleComposerHeightChange = useCallback(
    (_height: number) => {
      if (!agentId) {
        return;
      }
      streamViewRef.current?.prepareForViewportChange();
    },
    [agentId],
  );

  const handleMessageSent = useCallback(() => {
    if (!agentId) {
      return;
    }
    streamViewRef.current?.scrollToBottom("message-sent");
  }, [agentId]);

  const handleRewindComplete = useCallback(() => {
    streamViewRef.current?.scrollToBottom("rewind");
  }, []);

  const retryAgentLoad = useCallback(() => {
    setMissingAgentState({ kind: "idle" });
    if (!agentId || !viewedTimelineSync) return;
    viewedTimelineSync.retryVisibleAgentTimeline(agentId);
  }, [agentId, viewedTimelineSync]);

  const retryTimelineSync = useCallback(() => {
    if (!agentId || !viewedTimelineSync) return;
    viewedTimelineSync.retryVisibleAgentTimeline(agentId);
  }, [agentId, viewedTimelineSync]);

  useEffect(() => {
    initAttemptTokenRef.current += 1;
    setMissingAgentState({ kind: "idle" });
  }, [agentId, serverId]);

  useEffect(() => {
    if (!agentId) {
      return;
    }
    if (agentState.archivedAt) {
      return;
    }
    if (agentState.id && hasAppliedAuthoritativeHistory) {
      if (
        missingAgentState.kind === "resolving" ||
        missingAgentState.kind === "not_found" ||
        missingAgentState.kind === "error"
      ) {
        setMissingAgentState(reconcileMissingAgentStateWithPresentAgent);
      }
      return;
    }
    if (
      !client ||
      !viewedTimelineSync ||
      !isPaneVisible ||
      !isConnected ||
      !hasSession ||
      visibilityCatchUpStatus !== "ready"
    ) {
      return;
    }
    if (
      missingAgentState.kind === "resolving" ||
      missingAgentState.kind === "not_found" ||
      missingAgentState.kind === "error"
    ) {
      return;
    }

    setMissingAgentState({ kind: "resolving" });
    const attemptToken = ++initAttemptTokenRef.current;

    Promise.resolve()
      .then(async () => {
        if (attemptToken !== initAttemptTokenRef.current) {
          return;
        }
        const currentSession = useSessionStore.getState().sessions[serverId];
        const currentAgent =
          currentSession?.agents.get(agentId) ?? currentSession?.agentDetails.get(agentId);
        if (!currentAgent) {
          const result = await client.fetchAgent({ agentId });
          if (attemptToken !== initAttemptTokenRef.current) {
            return;
          }
          if (!result) {
            setMissingAgentState({
              kind: "not_found",
              message: `Agent not found: ${agentId}`,
            });
            return;
          }
          storeFetchedAgentDetail({ serverId, result });
        }
        if (attemptToken !== initAttemptTokenRef.current) {
          return;
        }
        setMissingAgentState({ kind: "idle" });
        return;
      })
      .catch((error) => {
        if (attemptToken !== initAttemptTokenRef.current) {
          return;
        }
        const message = toErrorMessage(error);
        if (isNotFoundErrorMessage(message)) {
          setMissingAgentState({ kind: "not_found", message });
          return;
        }
        setMissingAgentState({ kind: "error", message });
      });
  }, [
    agentState.id,
    agentState.archivedAt,
    hasAppliedAuthoritativeHistory,
    agentId,
    client,
    hasSession,
    isConnected,
    isPaneVisible,
    missingAgentState.kind,
    serverId,
    viewedTimelineSync,
    visibilityCatchUpStatus,
  ]);

  const nonReadyView = renderChatAgentNonReadyView({
    viewState,
    effectiveAgent,
    t,
    onRetryLoad: retryAgentLoad,
  });
  if (nonReadyView) return nonReadyView;
  invariant(agentId, "agent id is defined when agent content is ready");
  invariant(effectiveAgent, "effectiveAgent is defined when the non-ready view is absent");
  const agentCwd = agentState.cwd;
  invariant(agentCwd, "agent cwd is defined when agent content is ready");
  const showHistorySyncOverlay =
    viewState.tag === "ready" &&
    viewState.sync.status === "catching_up" &&
    viewState.sync.ui === "overlay";
  const showHistorySyncError = viewState.tag === "ready" && viewState.sync.status === "sync_error";
  const isRetryingHistorySync =
    viewState.tag === "ready" &&
    viewState.sync.status === "sync_error" &&
    viewState.sync.isRetrying;

  return (
    <ChatAgentReadyContent
      serverId={serverId}
      workspaceId={workspaceId}
      agentId={agentId}
      isPaneFocused={isPaneFocused}
      isArchivingCurrentAgent={isArchivingCurrentAgent}
      agentState={agentState}
      effectiveAgent={effectiveAgent}
      routeBottomAnchorRequest={routeBottomAnchorRequest}
      hasAppliedAuthoritativeHistory={hasAppliedAuthoritativeHistory}
      toastApi={toastApi}
      streamViewRef={streamViewRef}
      handleComposerHeightChange={handleComposerHeightChange}
      handleMessageSent={handleMessageSent}
      handleRewindComplete={handleRewindComplete}
      showHistorySyncOverlay={showHistorySyncOverlay}
      showHistorySyncError={showHistorySyncError}
      isRetryingHistorySync={isRetryingHistorySync}
      cwd={agentCwd}
      retryTimelineSync={retryTimelineSync}
      onAttentionInputFocus={attentionController.clearOnInputFocus}
      onAttentionPromptSend={attentionController.clearOnPromptSend}
      onOpenWorkspaceFile={onOpenWorkspaceFile}
    />
  );
}

const ChatAgentReadyContent = memo(function ChatAgentReadyContent({
  serverId,
  workspaceId,
  agentId,
  isPaneFocused,
  isArchivingCurrentAgent,
  agentState,
  effectiveAgent,
  routeBottomAnchorRequest,
  hasAppliedAuthoritativeHistory,
  toastApi,
  streamViewRef,
  handleComposerHeightChange,
  handleMessageSent,
  handleRewindComplete,
  showHistorySyncOverlay,
  showHistorySyncError,
  isRetryingHistorySync,
  retryTimelineSync,
  cwd,
  onAttentionInputFocus,
  onAttentionPromptSend,
  onOpenWorkspaceFile,
}: {
  serverId: string;
  workspaceId: string;
  agentId: string;
  isPaneFocused: boolean;
  isArchivingCurrentAgent: boolean;
  agentState: ChatAgentSelectedState;
  effectiveAgent: AgentScreenAgent;
  routeBottomAnchorRequest: RouteBottomAnchorRequest;
  hasAppliedAuthoritativeHistory: boolean;
  toastApi: ToastApi;
  streamViewRef: React.RefObject<AgentStreamViewHandle | null>;
  handleComposerHeightChange: (height: number) => void;
  handleMessageSent: () => void;
  handleRewindComplete: () => void;
  showHistorySyncOverlay: boolean;
  showHistorySyncError: boolean;
  isRetryingHistorySync: boolean;
  retryTimelineSync: () => void;
  cwd: string;
  onAttentionInputFocus: () => void;
  onAttentionPromptSend: () => void;
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
}) {
  const { t } = useTranslation();
  const isPaneVisible = useRetainedPanelActive();
  const subagentRows = useSubagentsForParent({ serverId, parentAgentId: agentId });
  const tasks = useSessionStore((state): TodoEntry[] | undefined =>
    state.sessions[serverId]?.agentTasks.get(agentId),
  );
  const archiveFinishedSubagents = useArchiveFinishedSubagents({
    serverId,
    parentAgentId: agentId,
    rows: subagentRows,
  });
  const hasPluginComposerPills = useHasPluginComposerPills(serverId, workspaceId, agentId);
  const hasActiveComposer = !agentState.archivedAt && !isArchivingCurrentAgent;
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const handleCollapseAll = useCallback(
    () => streamViewRef.current?.collapseAll(),
    [streamViewRef],
  );
  const handleScrollToBottom = useCallback(
    () => streamViewRef.current?.scrollToBottom(),
    [streamViewRef],
  );
  const streamControls = useMemo(
    () =>
      hasActiveComposer && isPaneVisible ? (
        <AgentStreamHeaderControls
          showScrollToBottom={showScrollToBottom}
          onCollapseAll={handleCollapseAll}
          onScrollToBottom={handleScrollToBottom}
        />
      ) : null,
    [handleCollapseAll, handleScrollToBottom, hasActiveComposer, isPaneVisible, showScrollToBottom],
  );
  const hasVisibleAgentTracks =
    streamControls !== null ||
    hasAgentTracks({
      subagentRows,
      tasks,
      archiveFinishedStatus: archiveFinishedSubagents.status,
      hasPluginComposerPills,
    });
  const rawAgentInputDraft = useAgentInputDraft({
    draftKey: buildDraftStoreKey({
      serverId,
      agentId,
    }),
  });
  // Stabilize the agentInputDraft object identity so that memo(AgentComposerSection) can bail out
  // when only toast state changes (which does not affect any draft field).
  const {
    text,
    editText,
    replaceText,
    textReplacement,
    attachments,
    setAttachments,
    clear,
    isHydrated,
    attachmentFocusRequestId,
    composerState,
  } = rawAgentInputDraft;
  const agentInputDraft = useMemo(
    (): AgentInputDraft => ({
      text,
      editText,
      replaceText,
      textReplacement,
      attachments,
      setAttachments,
      clear,
      isHydrated,
      attachmentFocusRequestId,
      composerState,
    }),
    [
      text,
      editText,
      replaceText,
      textReplacement,
      attachments,
      setAttachments,
      clear,
      isHydrated,
      attachmentFocusRequestId,
      composerState,
    ],
  );
  const composerSection = (
    <RenderProfile id={`AgentComposerSection:${agentId}`}>
      <AgentComposerSection
        agentId={agentId}
        serverId={serverId}
        isPaneFocused={isPaneFocused}
        isArchivingCurrentAgent={isArchivingCurrentAgent}
        archivedAt={agentState.archivedAt}
        cwd={cwd}
        isSubmitLoading={false}
        agentInputDraft={agentInputDraft}
        onAttentionInputFocus={onAttentionInputFocus}
        onAttentionPromptSend={onAttentionPromptSend}
        onComposerHeightChange={handleComposerHeightChange}
        onMessageSent={handleMessageSent}
      />
    </RenderProfile>
  );
  const streamContent = (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <RenderProfile id={`AgentStreamSection:${agentId}`}>
        <AgentStreamSection
          streamViewRef={streamViewRef}
          serverId={serverId}
          workspaceId={workspaceId}
          agentId={agentId}
          agent={effectiveAgent}
          routeBottomAnchorRequest={routeBottomAnchorRequest}
          hasAppliedAuthoritativeHistory={hasAppliedAuthoritativeHistory}
          hasActiveComposer={hasActiveComposer}
          hasVisibleAgentTracks={hasVisibleAgentTracks}
          toast={toastApi}
          onOpenWorkspaceFile={onOpenWorkspaceFile}
          onScrollToBottomVisibilityChange={setShowScrollToBottom}
        />
      </RenderProfile>
      {hasActiveComposer ? (
        <AgentTracks
          serverId={serverId}
          workspaceId={workspaceId}
          agentId={agentId}
          cwd={cwd}
          subagentRows={subagentRows}
          tasks={tasks}
          archiveFinishedStatus={archiveFinishedSubagents.status}
          onArchiveFinished={archiveFinishedSubagents.archiveFinished}
          hasPluginComposerPills={hasPluginComposerPills}
          actions={streamControls}
        />
      ) : null}
    </div>
  );
  const contentContainer = (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden select-none">{streamContent}</div>
  );

  return (
    <RewindComposerRestoreProvider
      text={agentInputDraft.text}
      setText={agentInputDraft.replaceText}
      onRewindComplete={handleRewindComplete}
    >
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <DockedChatSurface disabled={isArchivingCurrentAgent}>
          {contentContainer}

          {showHistorySyncError ? (
            <div className="flex w-full flex-col items-center px-4 pt-2">
              <div className="w-full max-w-[820px]">
                <div
                  className="flex items-center justify-center gap-3 rounded-2xl border border-status-danger bg-card px-4 py-2"
                  data-testid="agent-timeline-sync-error"
                >
                  <span className="text-sm text-muted-foreground">
                    {t("agentPanel.states.timelineSyncFailed")}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={retryTimelineSync}
                    data-testid="agent-timeline-sync-retry"
                    disabled={isRetryingHistorySync}
                  >
                    {isRetryingHistorySync
                      ? t("agentPanel.states.timelineSyncRetrying")
                      : t("common.actions.retry")}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {composerSection}

          {showHistorySyncOverlay ? (
            <div
              className="absolute inset-0 z-40 flex items-center justify-center bg-background"
              data-testid="agent-history-overlay"
            >
              <Spinner className="size-8 text-muted-foreground" />
            </div>
          ) : null}
        </DockedChatSurface>

        {isArchivingCurrentAgent ? (
          <div
            className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-[rgba(8,10,14,0.86)] px-8"
            data-testid="agent-archiving-overlay"
          >
            <Spinner className="size-8 text-foreground" />
            <span className="text-center text-sm font-semibold text-foreground">
              {t("agentPanel.states.archivingTitle")}
            </span>
            <span className="text-center text-sm text-muted-foreground">
              {t("agentPanel.states.archivingSubtitle")}
            </span>
          </div>
        ) : null}
      </div>
    </RewindComposerRestoreProvider>
  );
});

function DockedChatSurface({ children, disabled }: { children: ReactNode; disabled: boolean }) {
  return (
    <FileDropZone className="flex min-h-0 flex-1 flex-col bg-background" disabled={disabled}>
      {children}
    </FileDropZone>
  );
}

const CHIEF_ROLE_LABEL = "byspace.agent-role";

const AgentStreamSection = memo(function AgentStreamSection({
  streamViewRef,
  serverId,
  workspaceId,
  agentId,
  agent,
  routeBottomAnchorRequest,
  hasAppliedAuthoritativeHistory,
  hasActiveComposer,
  hasVisibleAgentTracks,
  toast,
  onOpenWorkspaceFile,
  onScrollToBottomVisibilityChange,
}: {
  streamViewRef: React.RefObject<AgentStreamViewHandle | null>;
  serverId: string;
  workspaceId: string;
  agentId?: string;
  agent: AgentScreenAgent;
  routeBottomAnchorRequest: RouteBottomAnchorRequest;
  hasAppliedAuthoritativeHistory: boolean;
  hasActiveComposer: boolean;
  hasVisibleAgentTracks: boolean;
  toast: ToastApi;
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
  onScrollToBottomVisibilityChange: (visible: boolean) => void;
}) {
  const { t } = useTranslation();
  const isCompactFormFactor = useIsCompactFormFactor();
  const { openPreferredTarget } = usePaneContext();
  const client = useHostRuntimeClient(serverId);
  const agentLabels = useSessionStore((state) => {
    if (!agentId) return null;
    return state.sessions[serverId]?.agents.get(agentId)?.labels ?? null;
  });
  const isChiefAgent = agentLabels?.[CHIEF_ROLE_LABEL] === "chief";
  const handleSuggestionSelect = useCallback(
    (prompt: string) => {
      if (!client || !agentId) return;
      void client.sendMessage(agentId, prompt);
    },
    [client, agentId],
  );
  const emptySuggestions = useMemo(
    () =>
      isChiefAgent
        ? [
            {
              label: t("chief.suggestions.whatCanYouDo"),
              prompt: t("chief.suggestions.whatCanYouDo"),
            },
            {
              label: t("chief.suggestions.checkWorkspaces"),
              prompt: t("chief.suggestions.checkWorkspaces"),
            },
            {
              label: t("chief.suggestions.recentActivity"),
              prompt: t("chief.suggestions.recentActivity"),
            },
          ]
        : undefined,
    [isChiefAgent, t],
  );
  const handleOpenProviderSubagent = useCallback(
    (parentAgentId: string, subagentId: string) => {
      openPreferredTarget({ kind: "provider_subagent", parentAgentId, subagentId }, "subagents");
    },
    [openPreferredTarget],
  );
  const hasWorkspaceDiffStat = useWorkspaceHasDiffStat(serverId, workspaceId);
  const hasVisibleComposerTracks =
    hasActiveComposer && (hasVisibleAgentTracks || hasWorkspaceDiffStat);
  const bottomOverlayTailClearance = hasVisibleComposerTracks
    ? resolveComposerTrackTailClearance(isCompactFormFactor)
    : 0;
  const bottomOverlayControlClearance = hasVisibleComposerTracks
    ? resolveComposerTrackControlClearance(isCompactFormFactor)
    : 0;
  const streamItemsRaw = useSessionStore((state) =>
    agentId ? state.sessions[serverId]?.agentStreamTail?.get(agentId) : undefined,
  );
  const pendingMessageSubmissions = useSessionStore(
    useShallow((state) =>
      agentId
        ? getActiveMessageSubmissions(state.sessions[serverId]?.messageSubmissions.get(agentId))
        : EMPTY_MESSAGE_SUBMISSIONS,
    ),
  );
  const turnPresentation = useSessionStore(
    useShallow((state) =>
      agentId
        ? selectAgentTurnPresentation(state.sessions[serverId], agentId)
        : { isActive: false, isCancelling: false, startedAt: null, turnId: null },
    ),
  );
  const streamItems = streamItemsRaw ?? EMPTY_STREAM_ITEMS;
  const pendingPermissionList = useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      if (!agentId) {
        return EMPTY_PENDING_PERMISSION_LIST;
      }
      const allPendingPermissions = state.sessions[serverId]?.pendingPermissions;
      if (!allPendingPermissions) {
        return EMPTY_PENDING_PERMISSION_LIST;
      }
      const filtered: PendingPermission[] = [];
      for (const permission of allPendingPermissions.values()) {
        if (permission.agentId === agentId) {
          filtered.push(permission);
        }
      }
      return filtered.length > 0 ? filtered : EMPTY_PENDING_PERMISSION_LIST;
    },
    shallow,
  );
  const pendingPermissions = useMemo(() => {
    if (pendingPermissionList.length === 0) {
      return EMPTY_PENDING_PERMISSIONS;
    }
    return new Map(pendingPermissionList.map((permission) => [permission.key, permission]));
  }, [pendingPermissionList]);

  return (
    <AgentStreamView
      ref={streamViewRef}
      agentId={agent.id}
      serverId={serverId}
      context={agent}
      streamItems={streamItems}
      pendingPermissions={pendingPermissions}
      routeBottomAnchorRequest={routeBottomAnchorRequest}
      isAuthoritativeHistoryReady={hasAppliedAuthoritativeHistory}
      bottomOverlayTailClearance={bottomOverlayTailClearance}
      bottomOverlayControlClearance={bottomOverlayControlClearance}
      toast={toast}
      pendingMessageSubmissions={pendingMessageSubmissions}
      turnPresentation={turnPresentation}
      onOpenWorkspaceFile={onOpenWorkspaceFile}
      onOpenProviderSubagent={handleOpenProviderSubagent}
      showScrollToBottomButton={!hasActiveComposer}
      onScrollToBottomVisibilityChange={onScrollToBottomVisibilityChange}
      emptySuggestions={emptySuggestions}
      onEmptySuggestionSelect={handleSuggestionSelect}
    />
  );
});

const AgentStreamControlButton = memo(function AgentStreamControlButton({
  Icon,
  onPress,
  accessibilityLabel,
  testID,
}: {
  Icon: ComponentType<{ size?: number; className?: string }>;
  onPress: () => void;
  accessibilityLabel: string;
  testID: string;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onPress}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
          aria-label={accessibilityLabel}
          data-testid={testID}
          className={composerPillClassName(
            isHovered,
            "pointer-events-auto shrink-0 active:bg-muted",
          )}
        >
          <Icon
            size={ICON_SIZE.sm}
            className={isHovered ? "text-foreground" : "text-muted-foreground"}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center">
        {accessibilityLabel}
      </TooltipContent>
    </Tooltip>
  );
});

const AgentStreamHeaderControls = memo(function AgentStreamHeaderControls({
  showScrollToBottom,
  onCollapseAll,
  onScrollToBottom,
}: {
  showScrollToBottom: boolean;
  onCollapseAll: () => void;
  onScrollToBottom: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="ml-auto flex shrink-0 items-center justify-end gap-1"
      data-testid="agent-stream-controls"
    >
      {showScrollToBottom ? (
        <AgentStreamControlButton
          Icon={ArrowDownToLine}
          onPress={onScrollToBottom}
          accessibilityLabel={t("agentStream.scrollToBottom")}
          testID="scroll-to-bottom-button"
        />
      ) : null}
      <AgentStreamControlButton
        Icon={ListChevronsDownUp}
        onPress={onCollapseAll}
        accessibilityLabel={t("agentStream.collapseAllToolCalls")}
        testID="collapse-all-tool-calls-button"
      />
    </div>
  );
});

const AgentComposerSection = memo(function AgentComposerSection({
  agentId,
  serverId,
  isPaneFocused,
  isArchivingCurrentAgent,
  archivedAt,
  cwd,
  isSubmitLoading,
  agentInputDraft,
  onAttentionInputFocus,
  onAttentionPromptSend,
  onComposerHeightChange,
  onMessageSent,
}: {
  agentId?: string;
  serverId: string;
  isPaneFocused: boolean;
  isArchivingCurrentAgent: boolean;
  archivedAt: Date | null;
  cwd: string;
  isSubmitLoading: boolean;
  agentInputDraft: AgentInputDraft;
  onAttentionInputFocus: () => void;
  onAttentionPromptSend: () => void;
  onComposerHeightChange: (height: number) => void;
  onMessageSent: () => void;
}) {
  if (!agentId) {
    return null;
  }
  if (archivedAt) {
    return <ArchivedAgentCallout serverId={serverId} agentId={agentId} />;
  }
  if (isArchivingCurrentAgent) {
    return null;
  }

  return (
    <ActiveAgentComposer
      agentId={agentId}
      serverId={serverId}
      isPaneFocused={isPaneFocused}
      cwd={cwd}
      isSubmitLoading={isSubmitLoading}
      agentInputDraft={agentInputDraft}
      onAttentionInputFocus={onAttentionInputFocus}
      onAttentionPromptSend={onAttentionPromptSend}
      onComposerHeightChange={onComposerHeightChange}
      onMessageSent={onMessageSent}
    />
  );
});

function ActiveAgentComposer({
  agentId,
  serverId,
  isPaneFocused,
  cwd,
  isSubmitLoading,
  agentInputDraft,
  onAttentionInputFocus,
  onAttentionPromptSend,
  onComposerHeightChange,
  onMessageSent,
}: {
  agentId: string;
  serverId: string;
  isPaneFocused: boolean;
  cwd: string;
  isSubmitLoading: boolean;
  agentInputDraft: AgentInputDraft;
  onAttentionInputFocus: () => void;
  onAttentionPromptSend: () => void;
  onComposerHeightChange: (height: number) => void;
  onMessageSent: () => void;
}) {
  const isCompactFormFactor = useIsCompactFormFactor();
  // The composer lays out for its own width, not the window's. A retained, hidden panel measures
  // 0: that is "not rendered", not "very narrow", so it never flips the layout.
  const inputAreaRef = useRef<HTMLDivElement | null>(null);
  const [isCompactComposerLayout, setIsCompactComposerLayout] = useState(isCompactFormFactor);
  useLayoutEffect(() => {
    const node = inputAreaRef.current;
    if (!node) return;
    const update = () => {
      const width = node.getBoundingClientRect().width;
      if (width > 0) setIsCompactComposerLayout(width < COMPACT_FORM_FACTOR_WIDTH);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const paneContext = usePaneContext();
  const openInSidePane = useSettings((settings) => settings.openInSidePane);
  const { workspaceId, tabId, retargetCurrentTab } = paneContext;
  const { archiveAgent } = useArchiveAgent();
  const closeWorkspaceTab = useWorkspaceLayoutStore((state) => state.closeTab);
  const hideWorkspaceAgent = useWorkspaceLayoutStore((state) => state.hideAgent);
  const unpinWorkspaceAgent = useWorkspaceLayoutStore((state) => state.unpinAgent);
  const workspaceAttachmentScopeKey = useWorkspaceAttachmentScopeKey({
    serverId,
    cwd,
    workspaceId,
  });
  const attachmentScopeKeys = useMemo(
    () => [workspaceAttachmentScopeKey],
    [workspaceAttachmentScopeKey],
  );
  const handleOpenWorkspaceAttachment = useCallback(
    (attachment: WorkspaceComposerAttachment) => {
      if (attachment.kind !== "review") {
        return;
      }
      openWorkspaceChanges({
        isCompact: isCompactFormFactor,
        workspaceKey: buildWorkspaceTabPersistenceKey({ serverId, workspaceId }),
        checkout: { serverId, cwd, isGit: true },
        preferences: openInSidePane,
      });
    },
    [cwd, isCompactFormFactor, openInSidePane, serverId, workspaceId],
  );

  const handleClientSlashCommand = useCallback(
    async (command: ClientSlashCommand) => {
      const agent = resolveChatAgentFromSession(useSessionStore.getState(), serverId, agentId);
      if (!agent) {
        throw new Error("Agent not found");
      }

      const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
      if (workspaceKey) {
        unpinWorkspaceAgent(workspaceKey, agentId);
        hideWorkspaceAgent(workspaceKey, agentId);
      }

      if (command.kind === "replace-agent-with-draft") {
        retargetCurrentTab({
          kind: "draft",
          draftId: generateDraftId(),
          setup: buildDraftAgentSetup(agent),
        });
      } else if (workspaceKey) {
        closeWorkspaceTab(workspaceKey, tabId);
      }

      await archiveAgent({ serverId, agentId });
    },
    [
      agentId,
      archiveAgent,
      closeWorkspaceTab,
      hideWorkspaceAgent,
      retargetCurrentTab,
      serverId,
      tabId,
      unpinWorkspaceAgent,
      workspaceId,
    ],
  );

  return (
    <div ref={inputAreaRef} className="w-full shrink pb-[env(safe-area-inset-bottom)]">
      <Composer
        agentId={agentId}
        serverId={serverId}
        workspaceId={workspaceId}
        externalKeyboardShift
        isPaneFocused={isPaneFocused}
        value={agentInputDraft.text}
        onChangeText={agentInputDraft.editText}
        textReplacement={agentInputDraft.textReplacement}
        attachments={agentInputDraft.attachments}
        attachmentScopeKeys={attachmentScopeKeys}
        onOpenWorkspaceAttachment={handleOpenWorkspaceAttachment}
        onChangeAttachments={agentInputDraft.setAttachments}
        cwd={cwd}
        clearDraft={agentInputDraft.clear}
        autoFocus
        autoFocusKey={String(agentInputDraft.attachmentFocusRequestId)}
        isSubmitLoading={isSubmitLoading}
        onAttentionInputFocus={onAttentionInputFocus}
        onAttentionPromptSend={onAttentionPromptSend}
        onComposerHeightChange={onComposerHeightChange}
        onMessageSent={onMessageSent}
        onClientSlashCommand={handleClientSlashCommand}
        isCompactLayout={isCompactComposerLayout}
      />
    </div>
  );
}

function AgentSessionUnavailableState({
  serverLabel,
  connectionStatus,
  lastError,
  isUnknownDaemon = false,
  t,
}: {
  serverLabel: string;
  connectionStatus: HostRuntimeConnectionStatus;
  lastError: string | null;
  isUnknownDaemon?: boolean;
  t: TFunction;
}) {
  if (isUnknownDaemon) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
          <span className="text-center text-sm text-muted-foreground">
            {t("agentPanel.unavailable.unknownHost", { serverLabel })}
          </span>
          <span className="mt-2 text-center text-sm text-muted-foreground">
            {t("agentPanel.unavailable.addHost")}
          </span>
        </div>
      </div>
    );
  }

  const isConnecting = connectionStatus === "connecting";
  const isPreparingSession = connectionStatus === "online";

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
        {isConnecting || isPreparingSession ? (
          <>
            <Spinner className="size-8 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              {isPreparingSession
                ? t("agentPanel.unavailable.preparingSession", { serverLabel })
                : t("agentPanel.unavailable.connecting", { serverLabel })}
            </span>
            <span className="mt-2 text-center text-sm text-muted-foreground">
              {isPreparingSession
                ? t("agentPanel.unavailable.showSoon")
                : t("agentPanel.unavailable.showWhenOnline")}
            </span>
          </>
        ) : (
          <>
            <span className="text-center text-sm font-semibold text-foreground">
              {t("agentPanel.unavailable.reconnectingTo", { serverLabel })}
            </span>
            <span className="text-center text-sm text-muted-foreground">
              {t("agentPanel.unavailable.showAgainWhenReachable")}
            </span>
            {lastError ? (
              <span className="text-center text-xs text-muted-foreground">{lastError}</span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
