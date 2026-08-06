import { useRef, ReactNode, useCallback, useEffect } from "react";
import { AppState } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useClientActivity } from "@/hooks/use-client-activity";
import { useAppVisible } from "@/hooks/use-app-visible";
import { prefetchProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { generateMessageId, type StreamItem } from "@/types/stream";
import type { AgentAttachment, SessionOutboundMessage } from "@bytetrue/byspace-protocol/messages";
import { parseServerInfoStatusPayload } from "@bytetrue/byspace-protocol/messages";
import {
  buildAgentAttentionNotificationPayload,
  type AgentAttentionReason,
  type AgentAttentionNotificationPayload,
  type NotificationPermissionRequest,
} from "@bytetrue/byspace-protocol/agent-attention-notification";
import type { DaemonClient } from "@bytetrue/byspace-client/internal/daemon-client";
import type { AgentSessionConfig } from "@bytetrue/byspace-protocol/agent-types";
import type { GitSetupOptions } from "@bytetrue/byspace-protocol/messages";
import type { AgentPermissionResponse } from "@bytetrue/byspace-protocol/agent-types";
import { getHostRuntimeStore, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore, type MessageEntry, type SessionState } from "@/stores/session-store";
import { useWorkspaceSetupStore } from "@/stores/workspace-setup-store";
import { sendOsNotification } from "@/utils/os-notifications";
import { getIsAppActivelyVisible } from "@/utils/app-visibility";
import { encodeImages } from "@/utils/encode-images";
import { derivePendingPermissionKey } from "@/utils/agent-snapshots";
import type { AttachmentMetadata } from "@/attachments/types";
import { patchWorkspaceScripts } from "@/contexts/session-workspace-scripts";
import { useToast } from "@/contexts/toast-context";
import { toErrorMessage } from "@/utils/error-messages";
import { showProviderNoticeToast } from "@/utils/provider-notice-toast";
import { applyCheckoutStatusUpdateFromEvent } from "@/git/checkout-status-cache";
import { useProviderSubagentStore } from "@/subagents/provider-store";
import { revalidateSessionAfterResume } from "@/contexts/session-resume-revalidation";

// Re-export types from session-store and draft-store for backward compatibility
export type { DraftInput } from "@/stores/draft-store";
export type {
  MessageEntry,
  Agent,
  ExplorerEntry,
  ExplorerFile,
  ExplorerEntryKind,
  ExplorerFileKind,
  ExplorerEncoding,
  AgentFileExplorerState,
} from "@/stores/session-store";

const FOCUS_AFTER_VISIBILITY_DEDUPE_MS = 250;

const findLatestAssistantMessageText = (items: StreamItem[]): string | null => {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item.kind === "assistant_message") {
      return item.text;
    }
  }
  return null;
};

const getLatestPermissionRequest = (
  session: SessionState | undefined,
  agentId: string,
): NotificationPermissionRequest | null => {
  if (!session) {
    return null;
  }

  let latest: NotificationPermissionRequest | null = null;
  for (const pending of session.pendingPermissions.values()) {
    if (pending.agentId === agentId) {
      latest = pending.request;
    }
  }
  if (latest) {
    return latest;
  }

  const agentPending = session.agents.get(agentId)?.pendingPermissions;
  if (agentPending && agentPending.length > 0) {
    return agentPending[agentPending.length - 1] as NotificationPermissionRequest;
  }

  return null;
};

interface AgentAttentionNotificationInput {
  notification?: AgentAttentionNotificationPayload;
  reason: AgentAttentionReason;
  serverId: string;
  workspaceId: string | undefined;
  agentId: string;
  assistantMessage: string | null;
  permissionRequest: NotificationPermissionRequest | null;
}

function resolveAgentAttentionNotification(
  input: AgentAttentionNotificationInput,
): AgentAttentionNotificationPayload | null {
  if (input.notification) {
    // COMPAT(notificationWorkspaceId): added in v0.2.0, remove after 2027-01-23;
    // old daemons omit workspaceId, so the click route resolves it.
    return input.notification;
  }
  if (!input.workspaceId) {
    return null;
  }
  return buildAgentAttentionNotificationPayload({
    reason: input.reason,
    serverId: input.serverId,
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    assistantMessage: input.reason === "finished" ? input.assistantMessage : null,
    permissionRequest: input.reason === "permission" ? input.permissionRequest : null,
  });
}

type WorkspaceSetupProgressPayload = Extract<
  SessionOutboundMessage,
  { type: "workspace_setup_progress" }
>["payload"];

function applyToolResultToMessages(
  toolCallId: string,
  result: unknown,
): (prev: MessageEntry[]) => MessageEntry[] {
  return (prev) =>
    prev.map((msg) =>
      msg.type === "tool_call" && msg.id === toolCallId
        ? { ...msg, result, status: "completed" as const }
        : msg,
    );
}

function applyToolErrorToMessages(
  toolCallId: string,
  error: unknown,
): (prev: MessageEntry[]) => MessageEntry[] {
  return (prev) =>
    prev.map((msg) =>
      msg.type === "tool_call" && msg.id === toolCallId
        ? { ...msg, error, status: "failed" as const }
        : msg,
    );
}

interface SessionProviderSharedProps {
  children: ReactNode;
  serverId: string;
}

interface SessionProviderClientProps extends SessionProviderSharedProps {
  client: DaemonClient;
}

export type SessionProviderProps = SessionProviderClientProps;

function SessionProviderWithClient({ children, serverId, client }: SessionProviderClientProps) {
  return (
    <SessionProviderInternal serverId={serverId} client={client}>
      {children}
    </SessionProviderInternal>
  );
}

// SessionProvider: Daemon client message handler that updates Zustand store
export function SessionProvider(props: SessionProviderProps) {
  return <SessionProviderWithClient {...props} />;
}

function SessionProviderInternal({ children, serverId, client }: SessionProviderClientProps) {
  const queryClient = useQueryClient();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const toast = useToast();

  // Zustand store actions
  const setMessages = useSessionStore((state) => state.setMessages);
  const setCurrentAssistantMessage = useSessionStore((state) => state.setCurrentAssistantMessage);
  const setInitializingAgents = useSessionStore((state) => state.setInitializingAgents);
  const bumpHistorySyncGeneration = useSessionStore((state) => state.bumpHistorySyncGeneration);
  const setWorkspaces = useSessionStore((state) => state.setWorkspaces);
  const flushAgentLastActivity = useSessionStore((state) => state.flushAgentLastActivity);
  const setPendingPermissions = useSessionStore((state) => state.setPendingPermissions);
  const updateSessionServerInfo = useSessionStore((state) => state.updateSessionServerInfo);
  const upsertWorkspaceSetupProgress = useWorkspaceSetupStore((state) => state.upsertProgress);

  // Track focused agent for heartbeat
  const focusedAgentId = useSessionStore(
    (state) => state.sessions[serverId]?.focusedAgentId ?? null,
  );
  const focusedTerminalId = useSessionStore(
    (state) => state.sessions[serverId]?.focusedTerminalId ?? null,
  );
  const _sessionStateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attentionNotifiedRef = useRef<Map<string, number>>(new Map());
  const appStateRef = useRef(AppState.currentState);
  const isAppVisible = useAppVisible();
  const previousAppVisibilityRef = useRef(isAppVisible);
  const lastTimelineVisibilityRefreshAtRef = useRef(0);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      appStateRef.current = nextState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (isAppVisible && !previousAppVisibilityRef.current) {
      lastTimelineVisibilityRefreshAtRef.current = Date.now();
    }
    previousAppVisibilityRef.current = isAppVisible;
    getHostRuntimeStore().setAgentTimelineActive(serverId, isAppVisible);
  }, [isAppVisible, serverId]);

  const handleAppResumed = useCallback(
    (awayMs: number) => {
      void revalidateSessionAfterResume({
        awayMs,
        serverId,
        bumpHistorySyncGeneration,
        refreshDirectories: () => getHostRuntimeStore().refreshDirectories(serverId),
      });
    },
    [bumpHistorySyncGeneration, serverId],
  );

  const refreshVisibleTimelines = useCallback(() => {
    const now = Date.now();
    if (now - lastTimelineVisibilityRefreshAtRef.current < FOCUS_AFTER_VISIBILITY_DEDUPE_MS) {
      return;
    }
    lastTimelineVisibilityRefreshAtRef.current = now;
    getHostRuntimeStore().refreshVisibleAgentTimelines(serverId);
  }, [serverId]);

  // Client activity tracking keeps daemon attention state current and repairs any timeline events
  // the browser or transport suspended while this desktop window was unfocused.
  useClientActivity({
    client,
    focusedAgentId,
    focusedTerminalId,
    onAppResumed: handleAppResumed,
    onWindowFocused: refreshVisibleTimelines,
  });

  const notifyAgentAttention = useCallback(
    (params: {
      agentId: string;
      reason: "finished" | "error" | "permission";
      timestamp: string;
      notification?: AgentAttentionNotificationPayload;
    }) => {
      const appState = appStateRef.current;
      const session = useSessionStore.getState().sessions[serverId];
      const attentionFocusedAgentId = session?.focusedAgentId ?? null;
      if (params.reason === "error") {
        return;
      }
      const isActivelyVisible = getIsAppActivelyVisible(appState);
      const isAwayFromAgent = !isActivelyVisible || attentionFocusedAgentId !== params.agentId;
      if (!isAwayFromAgent) {
        return;
      }

      const timestampMs = new Date(params.timestamp).getTime();
      const lastNotified = attentionNotifiedRef.current.get(params.agentId);
      if (lastNotified && lastNotified >= timestampMs) {
        return;
      }
      attentionNotifiedRef.current.set(params.agentId, timestampMs);

      const head = session?.agentStreamHead.get(params.agentId) ?? [];
      const tail = session?.agentStreamTail.get(params.agentId) ?? [];
      const assistantMessage =
        findLatestAssistantMessageText(head) ?? findLatestAssistantMessageText(tail);
      const permissionRequest = getLatestPermissionRequest(session, params.agentId);
      const workspaceId = session?.agents?.get(params.agentId)?.workspaceId;

      const notification = resolveAgentAttentionNotification({
        notification: params.notification,
        reason: params.reason,
        serverId,
        workspaceId,
        agentId: params.agentId,
        assistantMessage,
        permissionRequest,
      });
      if (!notification) {
        return;
      }

      void sendOsNotification({
        title: notification.title,
        body: notification.body,
        data: notification.data,
      });
    },
    [serverId],
  );

  useEffect(() => {
    const serverInfo = client.getLastServerInfoMessage();
    if (!serverInfo) {
      return;
    }

    updateSessionServerInfo(serverId, {
      serverId: serverInfo.serverId,
      hostname: serverInfo.hostname,
      version: serverInfo.version,
      ...(serverInfo.capabilities ? { capabilities: serverInfo.capabilities } : {}),
      ...(serverInfo.features ? { features: serverInfo.features } : {}),
    });
  }, [client, serverId, updateSessionServerInfo]);

  useEffect(() => {
    if (!isConnected) {
      return;
    }

    const serverInfo = client.getLastServerInfoMessage();
    if (!serverInfo?.features?.providersSnapshot) {
      return;
    }

    prefetchProvidersSnapshot(serverId, client);
  }, [client, isConnected, serverId]);

  // If the client drops mid-initialization, clear pending flags
  useEffect(() => {
    if (!isConnected) {
      flushAgentLastActivity();
      setInitializingAgents(serverId, new Map());
    }
  }, [flushAgentLastActivity, serverId, isConnected, setInitializingAgents]);

  const applyWorkspaceSetupProgress = useCallback(
    (payload: WorkspaceSetupProgressPayload) => {
      upsertWorkspaceSetupProgress({ serverId, payload });
    },
    [serverId, upsertWorkspaceSetupProgress],
  );

  // Non-timeline daemon handlers. HostRuntime owns the timeline replica and stream ordering.
  useEffect(() => {
    const unsubAgentAttention = client.onAgentAttentionRequired((notification) => {
      if (notification.shouldNotify) {
        notifyAgentAttention(notification);
      }
    });

    const unsubProviderSubagentUpdate = client.on("agent.provider_subagents.update", (message) => {
      if (message.type !== "agent.provider_subagents.update") return;
      useProviderSubagentStore.getState().applyUpdate(serverId, message.payload);
    });

    const unsubScriptStatusUpdate = client.on("script_status_update", (message) => {
      if (message.type !== "script_status_update") return;
      setWorkspaces(serverId, (prev) => patchWorkspaceScripts(prev, message.payload));
    });

    const unsubCheckoutStatusUpdate = client.on("checkout_status_update", (message) => {
      if (message.type !== "checkout_status_update") return;
      applyCheckoutStatusUpdateFromEvent({ queryClient, serverId, message });
    });

    const unsubWorkspaceSetupProgress = client.on("workspace_setup_progress", (message) => {
      if (message.type !== "workspace_setup_progress") return;
      applyWorkspaceSetupProgress(message.payload);
    });

    const unsubWorkspaceSetupStatusResponse = client.on(
      "workspace_setup_status_response",
      (message) => {
        if (message.type !== "workspace_setup_status_response") return;
        const { workspaceId, snapshot } = message.payload;
        if (snapshot) {
          applyWorkspaceSetupProgress({ workspaceId, ...snapshot });
        }
      },
    );

    const unsubStatus = client.on("status", (message) => {
      if (message.type !== "status") return;
      const serverInfo = parseServerInfoStatusPayload(message.payload);
      if (serverInfo) {
        updateSessionServerInfo(serverId, {
          serverId: serverInfo.serverId,
          hostname: serverInfo.hostname,
          version: serverInfo.version,
          ...(serverInfo.capabilities ? { capabilities: serverInfo.capabilities } : {}),
          ...(serverInfo.features ? { features: serverInfo.features } : {}),
        });
        return;
      }
    });

    const unsubPermissionRequest = client.on("agent_permission_request", (message) => {
      if (message.type !== "agent_permission_request") return;
      const { agentId, request } = message.payload;

      setPendingPermissions(serverId, (prev) => {
        const next = new Map(prev);
        const key = derivePendingPermissionKey(agentId, request);
        next.set(key, { key, agentId, request });
        return next;
      });
    });

    const unsubPermissionResolved = client.on("agent_permission_resolved", (message) => {
      if (message.type !== "agent_permission_resolved") return;
      const { requestId, agentId } = message.payload;

      setPendingPermissions(serverId, (prev) => {
        const next = new Map(prev);
        const derivedKey = `${agentId}:${requestId}`;
        if (!next.delete(derivedKey)) {
          for (const [key, pending] of next.entries()) {
            if (pending.agentId === agentId && pending.request.id === requestId) {
              next.delete(key);
              break;
            }
          }
        }
        return next;
      });
    });

    // COMPAT(voiceMode): added in v0.4.0, remove after 2027-02-04.
    // Old daemons may still emit Voice mode audio. Acknowledge it without playing it.
    const unsubAudioOutput = client.on("audio_output", async (message) => {
      await client.audioPlayed(message.payload.id).catch((error) => {
        console.warn("[Session] Failed to acknowledge legacy Voice mode audio:", error);
      });
    });

    const unsubActivity = client.on("activity_log", (message) => {
      if (message.type !== "activity_log") return;
      const data = message.payload;
      if (data.type === "system" && data.content.includes("Transcribing")) {
        return;
      }

      if (data.type === "tool_call" && data.metadata) {
        const toolCallId =
          typeof data.metadata.toolCallId === "string" ? data.metadata.toolCallId : "";
        const toolName = typeof data.metadata.toolName === "string" ? data.metadata.toolName : "";
        const args = data.metadata.arguments;

        setMessages(serverId, (prev) => [
          ...prev,
          {
            type: "tool_call",
            id: toolCallId,
            timestamp: Date.now(),
            toolName,
            args,
            status: "executing",
          },
        ]);
        return;
      }

      if (data.type === "tool_result" && data.metadata) {
        const toolCallId =
          typeof data.metadata.toolCallId === "string" ? data.metadata.toolCallId : "";
        const result = data.metadata.result;

        const applyToolResult = applyToolResultToMessages(toolCallId, result);
        setMessages(serverId, applyToolResult);
        return;
      }

      if (data.type === "error" && data.metadata && "toolCallId" in data.metadata) {
        const toolCallId =
          typeof data.metadata.toolCallId === "string" ? data.metadata.toolCallId : "";
        const error = data.metadata.error;

        const applyToolError = applyToolErrorToMessages(toolCallId, error);
        setMessages(serverId, applyToolError);
      }

      let activityType: "system" | "info" | "success" | "error" = "info";
      if (data.type === "error") activityType = "error";

      if (data.type === "transcript") {
        setMessages(serverId, (prev) => [
          ...prev,
          {
            type: "user",
            id: generateMessageId(),
            timestamp: Date.now(),
            message: data.content,
          },
        ]);
        return;
      }

      if (data.type === "assistant") {
        setMessages(serverId, (prev) => [
          ...prev,
          {
            type: "assistant",
            id: generateMessageId(),
            timestamp: Date.now(),
            message: data.content,
          },
        ]);
        setCurrentAssistantMessage(serverId, "");
        return;
      }

      setMessages(serverId, (prev) => [
        ...prev,
        {
          type: "activity",
          id: generateMessageId(),
          timestamp: Date.now(),
          activityType,
          message: data.content,
          metadata: data.metadata,
        },
      ]);
    });

    const unsubChunk = client.on("assistant_chunk", (message) => {
      if (message.type !== "assistant_chunk") return;
      setCurrentAssistantMessage(serverId, (prev) => prev + message.payload.chunk);
    });

    const unsubTerminalAttention = client.on("terminal_attention_required", (message) => {
      if (message.type !== "terminal_attention_required") {
        return;
      }
      if (!message.payload.shouldNotify) {
        return;
      }
      void sendOsNotification({
        title: message.payload.title,
        body: message.payload.body,
        // serverId + workspaceId + terminalId route a tap to the terminal tab; cwd is
        // carried as a fallback identifier when the daemon resolved no workspace.
        data: {
          serverId: message.payload.serverId ?? serverId,
          terminalId: message.payload.terminalId,
          cwd: message.payload.cwd,
          ...(message.payload.workspaceId ? { workspaceId: message.payload.workspaceId } : {}),
        },
      });
    });

    return () => {
      unsubProviderSubagentUpdate();
      unsubAgentAttention();
      unsubScriptStatusUpdate();
      unsubCheckoutStatusUpdate();
      unsubWorkspaceSetupProgress();
      unsubWorkspaceSetupStatusResponse();
      unsubStatus();
      unsubPermissionRequest();
      unsubPermissionResolved();
      unsubAudioOutput();
      unsubActivity();
      unsubChunk();
      unsubTerminalAttention();
    };
  }, [
    client,
    queryClient,
    serverId,
    setMessages,
    setCurrentAssistantMessage,
    setInitializingAgents,
    setWorkspaces,
    setPendingPermissions,
    notifyAgentAttention,
    applyWorkspaceSetupProgress,
    updateSessionServerInfo,
    toast,
  ]);

  const _cancelAgentRun = useCallback(
    (agentId: string) => {
      if (!client) {
        console.warn("[Session] cancelAgent skipped: daemon unavailable");
        return;
      }
      void client.cancelAgent(agentId).catch((error) => {
        console.error("[Session] Failed to cancel agent:", error);
      });
    },
    [client],
  );

  const _deleteAgent = useCallback(
    (agentId: string) => {
      if (!client) {
        console.warn("[Session] deleteAgent skipped: daemon unavailable");
        return;
      }
      void client.deleteAgent(agentId).catch((error) => {
        console.error("[Session] Failed to delete agent:", error);
      });
    },
    [client],
  );

  const _archiveAgent = useCallback(
    (agentId: string) => {
      if (!client) {
        console.warn("[Session] archiveAgent skipped: daemon unavailable");
        return;
      }
      void client.archiveAgent(agentId).catch((error) => {
        console.error("[Session] Failed to archive agent:", error);
      });
    },
    [client],
  );

  const _restartServer = useCallback(
    (reason?: string) => {
      if (!client) {
        console.warn("[Session] restartServer skipped: daemon unavailable");
        return;
      }
      void client.restartServer(reason).catch((error) => {
        console.error("[Session] Failed to restart server:", error);
      });
    },
    [client],
  );

  const _createAgent = useCallback(
    async ({
      config,
      initialPrompt,
      images,
      attachments,
      git,
      worktreeName,
      requestId,
    }: {
      config: AgentSessionConfig;
      initialPrompt: string;
      images?: AttachmentMetadata[];
      attachments?: AgentAttachment[];
      git?: GitSetupOptions;
      worktreeName?: string;
      requestId?: string;
    }) => {
      if (!client) {
        console.warn("[Session] createAgent skipped: daemon unavailable");
        return;
      }
      const trimmedPrompt = initialPrompt.trim();
      let imagesData: Array<{ data: string; mimeType: string }> | undefined;
      try {
        imagesData = await encodeImages(images);
      } catch (error) {
        console.error("[Session] Failed to prepare images for agent creation:", error);
      }
      await client.createAgent({
        config,
        ...(trimmedPrompt ? { initialPrompt: trimmedPrompt } : {}),
        ...(imagesData && imagesData.length > 0 ? { images: imagesData } : {}),
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
        ...(git ? { git } : {}),
        ...(worktreeName ? { worktreeName } : {}),
        ...(requestId ? { requestId } : {}),
      });
    },
    [client],
  );

  const _setAgentMode = useCallback(
    (agentId: string, modeId: string) => {
      if (!client) {
        console.warn("[Session] setAgentMode skipped: daemon unavailable");
        return;
      }
      void client
        .setAgentMode(agentId, modeId)
        .then((notice) => showProviderNoticeToast(toast, notice))
        .catch((error) => {
          console.error("[Session] Failed to set agent mode:", error);
          toast.error(toErrorMessage(error));
        });
    },
    [client, toast],
  );

  const _setAgentModel = useCallback(
    (agentId: string, modelId: string | null) => {
      if (!client) {
        console.warn("[Session] setAgentModel skipped: daemon unavailable");
        return;
      }
      void client.setAgentModel(agentId, modelId).catch((error) => {
        console.error("[Session] Failed to set agent model:", error);
        toast.error(toErrorMessage(error));
      });
    },
    [client, toast],
  );

  const _setAgentThinkingOption = useCallback(
    (agentId: string, thinkingOptionId: string | null) => {
      if (!client) {
        console.warn("[Session] setAgentThinkingOption skipped: daemon unavailable");
        return;
      }
      void client
        .setAgentThinkingOption(agentId, thinkingOptionId)
        .then((notice) => showProviderNoticeToast(toast, notice))
        .catch((error) => {
          console.error("[Session] Failed to set agent thinking option:", error);
          toast.error(toErrorMessage(error));
        });
    },
    [client, toast],
  );

  const _respondToPermission = useCallback(
    (agentId: string, requestId: string, response: AgentPermissionResponse) => {
      if (!client) {
        console.warn("[Session] respondToPermission skipped: daemon unavailable");
        return;
      }
      void client.respondToPermission(agentId, requestId, response).catch((error) => {
        console.error("[Session] Failed to respond to permission:", error);
      });
    },
    [client],
  );

  return children;
}
