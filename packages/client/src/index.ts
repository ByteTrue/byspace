import type {
  AgentSnapshotPayload,
  CreateAgentRequestMessage,
  FetchWorkspacesRequestMessage,
  FetchWorkspacesResponseMessage,
  GetProvidersSnapshotResponseMessage,
  ListAvailableProvidersResponse,
  ListProviderFeaturesRequestMessage,
  ListProviderFeaturesResponseMessage,
  ListProviderModelsResponseMessage,
  ListProviderModesResponseMessage,
  MutableDaemonConfig,
  MutableDaemonConfigPatch,
  ProviderDiagnosticResponseMessage,
  ProjectPlacementPayload,
  RefreshProvidersSnapshotResponseMessage,
  SendAgentMessageRequest,
  SessionOutboundMessage,
  WorkspaceDescriptorPayload,
} from "@bytetrue/byspace-protocol/messages";
import { DaemonClient } from "./daemon-client.js";
import type {
  FetchAgentTimelineCursor,
  FetchAgentTimelineDirection,
  FetchAgentTimelinePayload,
  FetchAgentTimelineProjection,
} from "./daemon-client.js";

export { DaemonClient };
export type {
  DaemonClientConfig,
  DaemonEvent,
  WebSocketFactory,
  WebSocketLike,
} from "./daemon-client.js";

export type ConnectionState =
  | { status: "idle" }
  | { status: "connecting"; attempt: number }
  | { status: "connected" }
  | { status: "disconnected"; reason?: string }
  | { status: "disposed" };

export interface BySpaceLogger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface BySpaceClientConfig {
  url: string;
  clientId?: string;
  appVersion?: string;
  runtimeGeneration?: number | null;
  password?: string;
  authHeader?: string;
  suppressSendErrors?: boolean;
  logger?: BySpaceLogger;
  connectTimeoutMs?: number;
  e2ee?: {
    enabled?: boolean;
    daemonPublicKeyB64?: string;
  };
  reconnect?: {
    enabled?: boolean;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };
  runtimeMetricsIntervalMs?: number;
  runtimeMetricsWindowMs?: number;
}

export type BySpaceWorkspace = WorkspaceDescriptorPayload;
export type BySpaceAgent = AgentSnapshotPayload;
export type BySpaceWorkspaceListOptions = Omit<
  FetchWorkspacesRequestMessage,
  "type" | "requestId"
> & {
  requestId?: string;
};

export interface BySpaceWorkspaceListResult {
  requestId: string;
  subscriptionId?: string | null;
  entries: BySpaceWorkspace[];
  pageInfo: FetchWorkspacesResponseMessage["payload"]["pageInfo"];
}

export interface BySpaceWorkspaceOpenOptions {
  cwd: string;
  requestId?: string;
}

export interface BySpaceWorkspaceOpenResult {
  requestId: string;
  workspace: BySpaceWorkspaceHandle | null;
  error: string | null;
}

export interface BySpaceWorkspaceArchiveResult {
  requestId: string;
  workspaceId: string;
  archivedAt: string | null;
  error: string | null;
}

export type BySpaceWorkspaceUpdate = Extract<
  SessionOutboundMessage,
  { type: "workspace_update" }
>["payload"];

export type BySpaceWorkspaceUpdateHandler = (update: BySpaceWorkspaceUpdate) => void;

/**
 * A handle is a stable typed reference to a daemon resource. Its identity is the
 * daemon id, and `latest()` only returns the most recent snapshot this handle has
 * seen through construction, `refetch()`, or this handle's local subscription.
 */
export interface BySpaceWorkspaceHandle {
  readonly id: string;
  latest(): BySpaceWorkspace | null;
  /**
   * Fetches a fresh workspace snapshot through the existing workspace list RPC,
   * exact-matches this handle id from the result, and updates `latest()`.
   */
  refetch(options?: { requestId?: string }): Promise<BySpaceWorkspace | null>;
  archive(requestId?: string): Promise<BySpaceWorkspaceArchiveResult>;
  /**
   * Subscribes to already-emitted daemon workspace_update events for this id.
   * This returns a local unsubscribe function; it does not own app cache state or
   * send a daemon unsubscribe RPC. Call `workspaces.list({ subscribe: {} })` when
   * the daemon should start streaming workspace directory updates.
   */
  subscribe(handler: (update: BySpaceWorkspaceUpdate) => void): () => void;
}

export interface BySpaceWorkspaceActions {
  list(options?: BySpaceWorkspaceListOptions): Promise<BySpaceWorkspaceListResult>;
  ref(workspace: string | BySpaceWorkspace): BySpaceWorkspaceHandle;
  open(
    input: string | BySpaceWorkspaceOpenOptions,
    requestId?: string,
  ): Promise<BySpaceWorkspaceOpenResult>;
  create(
    input: string | BySpaceWorkspaceOpenOptions,
    requestId?: string,
  ): Promise<BySpaceWorkspaceOpenResult>;
  archive(
    workspace: string | BySpaceWorkspaceHandle,
    requestId?: string,
  ): Promise<BySpaceWorkspaceArchiveResult>;
  /**
   * Local event subscription over the low-level driver's workspace_update stream.
   * The returned function only removes this SDK listener.
   */
  subscribe(handler: BySpaceWorkspaceUpdateHandler): () => void;
}

type BySpaceAgentSessionConfig = CreateAgentRequestMessage["config"];
type BySpaceAgentProvider = BySpaceAgentSessionConfig["provider"];
type BySpaceAgentConfigOverrides = Partial<Omit<BySpaceAgentSessionConfig, "provider" | "cwd">>;

export interface BySpaceAgentCreateOptions extends BySpaceAgentConfigOverrides {
  config?: BySpaceAgentSessionConfig;
  provider?: CreateAgentRequestMessage["config"]["provider"];
  cwd?: string;
  workspaceId?: string;
  initialPrompt?: string;
  clientMessageId?: string;
  outputSchema?: Record<string, unknown>;
  images?: CreateAgentRequestMessage["images"];
  attachments?: CreateAgentRequestMessage["attachments"];
  git?: CreateAgentRequestMessage["git"];
  worktreeName?: string;
  requestId?: string;
  labels?: Record<string, string>;
}

export interface BySpaceAgentRefetchResult {
  agent: BySpaceAgent;
  project: ProjectPlacementPayload | null;
}

export interface BySpaceAgentTimelineRefetchOptions {
  direction?: FetchAgentTimelineDirection;
  cursor?: FetchAgentTimelineCursor;
  limit?: number;
  projection?: FetchAgentTimelineProjection;
  requestId?: string;
}

export interface BySpaceAgentSendOptions {
  messageId?: string;
  images?: Array<{ data: string; mimeType: string }>;
  attachments?: SendAgentMessageRequest["attachments"];
}

export type BySpaceAgentUpdate = Extract<
  SessionOutboundMessage,
  { type: "agent_update" }
>["payload"];

export type BySpaceAgentStream = Extract<
  SessionOutboundMessage,
  { type: "agent_stream" }
>["payload"];

export type BySpaceAgentUpdateHandler = (update: BySpaceAgentUpdate) => void;

export interface BySpaceAgentTimelineHandle {
  /**
   * Fetches a fresh timeline page through the existing daemon RPC. If the daemon
   * includes an agent snapshot in the response, the parent handle's `latest()`
   * is updated to that snapshot.
   */
  refetch(options?: BySpaceAgentTimelineRefetchOptions): Promise<FetchAgentTimelinePayload>;
  /**
   * Local listener for agent_stream events matching this handle id. It does not
   * retain timeline entries or own application cache state.
   */
  subscribe(handler: (event: BySpaceAgentStream) => void): () => void;
}

/**
 * Agent handles follow the same identity/snapshot rule as workspace handles:
 * `id` is stable, while `latest()` is only the newest snapshot observed by this
 * handle through construction, `refetch()`, timeline refetch, archive, or local
 * agent_update subscription.
 */
export interface BySpaceAgentHandle {
  readonly id: string;
  readonly timeline: BySpaceAgentTimelineHandle;
  latest(): BySpaceAgent | null;
  refetch(requestId?: string): Promise<BySpaceAgentRefetchResult | null>;
  send(text: string, options?: BySpaceAgentSendOptions): Promise<void>;
  archive(): Promise<{ archivedAt: string }>;
  detach(): Promise<void>;
  subscribe(handler: (update: BySpaceAgentUpdate) => void): () => void;
}

export interface BySpaceAgentActions {
  ref(agent: string | BySpaceAgent): BySpaceAgentHandle;
  create(options: BySpaceAgentCreateOptions): Promise<BySpaceAgentHandle>;
  /**
   * Local event subscription over the low-level driver's agent_update stream.
   * The returned function only removes this SDK listener.
   */
  subscribe(handler: BySpaceAgentUpdateHandler): () => void;
}

export interface BySpaceProviderConfig extends BySpaceProviderConfigInput {
  provider: BySpaceAgentProvider;
}
export type BySpaceProviderFeatureValues = Record<string, unknown>;

export interface BySpaceProviderConfigInput {
  model?: string;
  modeId?: string;
  thinkingOptionId?: string;
  featureValues?: BySpaceProviderFeatureValues;
}

export type BySpaceProviderModelsResult = ListProviderModelsResponseMessage["payload"];
export type BySpaceProviderModesResult = ListProviderModesResponseMessage["payload"];
export type BySpaceProviderFeaturesInput = ListProviderFeaturesRequestMessage["draftConfig"];
export type BySpaceProviderFeaturesResult = ListProviderFeaturesResponseMessage["payload"];
export type BySpaceProviderAvailabilityResult = ListAvailableProvidersResponse["payload"];
export type BySpaceProviderSnapshotResult = GetProvidersSnapshotResponseMessage["payload"];
export type BySpaceProviderSnapshotUpdate = Extract<
  SessionOutboundMessage,
  { type: "providers_snapshot_update" }
>["payload"];
export type BySpaceProviderRefreshResult = RefreshProvidersSnapshotResponseMessage["payload"];
export type BySpaceProviderDiagnosticResult = ProviderDiagnosticResponseMessage["payload"];

export interface BySpaceProviderListOptions {
  cwd?: string;
  requestId?: string;
}

export interface BySpaceProviderRefreshOptions {
  cwd?: string;
  providers?: BySpaceAgentProvider[];
  requestId?: string;
}

export interface BySpaceProviderActions {
  codex(input?: BySpaceProviderConfigInput): BySpaceProviderConfig;
  claude(input?: BySpaceProviderConfigInput): BySpaceProviderConfig;
  opencode(input?: BySpaceProviderConfigInput): BySpaceProviderConfig;
  copilot(input?: BySpaceProviderConfigInput): BySpaceProviderConfig;
  config(provider: BySpaceAgentProvider, input?: BySpaceProviderConfigInput): BySpaceProviderConfig;
  listModels(
    provider: BySpaceAgentProvider,
    options?: BySpaceProviderListOptions,
  ): Promise<BySpaceProviderModelsResult>;
  listModes(
    provider: BySpaceAgentProvider,
    options?: BySpaceProviderListOptions,
  ): Promise<BySpaceProviderModesResult>;
  listFeatures(
    draftConfig: BySpaceProviderFeaturesInput,
    options?: { requestId?: string },
  ): Promise<BySpaceProviderFeaturesResult>;
  listAvailable(options?: { requestId?: string }): Promise<BySpaceProviderAvailabilityResult>;
  snapshot(options?: BySpaceProviderListOptions): Promise<BySpaceProviderSnapshotResult>;
  refresh(options?: BySpaceProviderRefreshOptions): Promise<BySpaceProviderRefreshResult>;
  diagnostic(
    provider: BySpaceAgentProvider,
    options?: { requestId?: string },
  ): Promise<BySpaceProviderDiagnosticResult>;
  subscribe(handler: (update: BySpaceProviderSnapshotUpdate) => void): () => void;
}

export interface BySpaceConfigActions {
  /**
   * Reads daemon config through the existing config RPC. Provider profiles,
   * custom provider entries, keys/env, custom binaries, and provider enablement
   * are currently config-file-shaped daemon state, so the SDK exposes this raw
   * typed surface instead of pretending there are higher-level provider-settings
   * RPCs.
   */
  get(requestId?: string): Promise<{ requestId: string; config: MutableDaemonConfig }>;
  /**
   * Patches daemon config through the existing config RPC. The daemon validates
   * and persists supported fields; unsupported provider/settings workflows remain
   * daemon gaps until first-class RPCs exist.
   */
  patch(
    config: MutableDaemonConfigPatch,
    requestId?: string,
  ): Promise<{ requestId: string; config: MutableDaemonConfig }>;
}

export interface BySpaceClient {
  readonly workspaces: BySpaceWorkspaceActions;
  readonly agents: BySpaceAgentActions;
  readonly providers: BySpaceProviderActions;
  readonly config: BySpaceConfigActions;
  connect(): Promise<void>;
  close(): Promise<void>;
  ensureConnected(): void;
  getConnectionState(): ConnectionState;
}

export function createBySpaceClient(config: BySpaceClientConfig): BySpaceClient {
  const daemonClient = new DaemonClient({
    ...config,
    clientId: config.clientId ?? createGeneratedClientId(),
    clientType: "cli",
  });
  const createWorkspaceHandle = createWorkspaceHandleFactory(daemonClient);
  const createAgentHandle = createAgentHandleFactory(daemonClient);

  return {
    workspaces: {
      list: (options) => daemonClient.fetchWorkspaces(options),
      ref: (workspace) => createWorkspaceHandle(workspace),
      open: (input, requestId) =>
        openWorkspace(daemonClient, createWorkspaceHandle, input, requestId),
      create: (input, requestId) =>
        openWorkspace(daemonClient, createWorkspaceHandle, input, requestId),
      archive: (workspace, requestId) =>
        daemonClient.archiveWorkspace(resolveWorkspaceId(workspace), requestId),
      subscribe: (handler) =>
        daemonClient.on("workspace_update", (message) => {
          handler(message.payload);
        }),
    },
    agents: {
      ref: (agent) => createAgentHandle(agent),
      create: async (options) => {
        const agent = await daemonClient.createAgent(options);
        return createAgentHandle(agent);
      },
      subscribe: (handler) =>
        daemonClient.on("agent_update", (message) => {
          handler(message.payload);
        }),
    },
    providers: {
      codex: (input) => providerConfig("codex", input),
      claude: (input) => providerConfig("claude", input),
      opencode: (input) => providerConfig("opencode", input),
      copilot: (input) => providerConfig("copilot", input),
      config: (provider, input) => providerConfig(provider, input),
      listModels: (provider, options) => daemonClient.listProviderModels(provider, options),
      listModes: (provider, options) => daemonClient.listProviderModes(provider, options),
      listFeatures: (draftConfig, options) =>
        daemonClient.listProviderFeatures(draftConfig, options),
      listAvailable: (options) => daemonClient.listAvailableProviders(options),
      snapshot: (options) => daemonClient.getProvidersSnapshot(options),
      refresh: (options) => daemonClient.refreshProvidersSnapshot(options),
      diagnostic: (provider, options) => daemonClient.getProviderDiagnostic(provider, options),
      subscribe: (handler) =>
        daemonClient.on("providers_snapshot_update", (message) => {
          handler(message.payload);
        }),
    },
    config: {
      get: (requestId) => daemonClient.getDaemonConfig(requestId),
      patch: (patch, requestId) => daemonClient.patchDaemonConfig(patch, requestId),
    },
    connect: () => daemonClient.connect(),
    close: () => daemonClient.close(),
    ensureConnected: () => daemonClient.ensureConnected(),
    getConnectionState: () => daemonClient.getConnectionState(),
  };
}

type WorkspaceHandleFactory = (workspace: string | BySpaceWorkspace) => BySpaceWorkspaceHandle;
type AgentHandleFactory = (agent: string | BySpaceAgent) => BySpaceAgentHandle;

function createWorkspaceHandleFactory(daemonClient: DaemonClient): WorkspaceHandleFactory {
  return (workspace) => {
    const id = typeof workspace === "string" ? workspace : workspace.id;
    let latest = typeof workspace === "string" ? null : workspace;

    return {
      id,
      latest: () => latest,
      refetch: async (options) => {
        // Best-effort: fetches one page and matches by id client-side, so a workspace beyond
        // the first page won't be found. TODO: add a "get workspace by id" lookup and resolve
        // by exact id instead of paging.
        const result = await daemonClient.fetchWorkspaces({
          requestId: options?.requestId,
          page: { limit: 25 },
        });
        latest = result.entries.find((entry) => entry.id === id) ?? null;
        return latest;
      },
      archive: async (requestId) => {
        const result = await daemonClient.archiveWorkspace(id, requestId);
        if (latest) {
          latest = { ...latest, archivingAt: result.archivedAt };
        }
        return result;
      },
      subscribe: (handler) =>
        daemonClient.on("workspace_update", (message) => {
          const update = message.payload;
          if (update.kind === "upsert" && update.workspace.id === id) {
            latest = update.workspace;
            handler(update);
          }
          if (update.kind === "remove" && update.id === id) {
            latest = null;
            handler(update);
          }
        }),
    };
  };
}

function createAgentHandleFactory(daemonClient: DaemonClient): AgentHandleFactory {
  return (agent) => {
    const id = typeof agent === "string" ? agent : agent.id;
    let latest = typeof agent === "string" ? null : agent;

    const handle: BySpaceAgentHandle = {
      id,
      timeline: {
        refetch: async (options) => {
          const result = await daemonClient.fetchAgentTimeline(id, options);
          if (result.agent) {
            latest = result.agent;
          }
          return result;
        },
        subscribe: (handler) =>
          daemonClient.on("agent_stream", (message) => {
            if (message.payload.agentId === id) {
              handler(message.payload);
            }
          }),
      },
      latest: () => latest,
      refetch: async (requestId) => {
        const result = await daemonClient.fetchAgent({ agentId: id, requestId });
        latest = result?.agent ?? null;
        return result;
      },
      send: (text, options) => daemonClient.sendAgentMessage(id, text, options),
      archive: async () => {
        const result = await daemonClient.archiveAgent(id);
        if (latest) {
          latest = { ...latest, archivedAt: result.archivedAt };
        }
        return result;
      },
      detach: async () => {
        await daemonClient.detachAgent(id);
      },
      subscribe: (handler) =>
        daemonClient.on("agent_update", (message) => {
          const update = message.payload;
          if (update.kind === "upsert" && update.agent.id === id) {
            latest = update.agent;
            handler(update);
          }
          if (update.kind === "remove" && update.agentId === id) {
            latest = null;
            handler(update);
          }
        }),
    };

    return handle;
  };
}

async function openWorkspace(
  daemonClient: DaemonClient,
  createWorkspaceHandle: WorkspaceHandleFactory,
  input: string | BySpaceWorkspaceOpenOptions,
  requestId?: string,
): Promise<BySpaceWorkspaceOpenResult> {
  const options = typeof input === "string" ? { cwd: input, requestId } : input;
  const result = await daemonClient.openProject(options.cwd, options.requestId);
  return {
    ...result,
    workspace: result.workspace ? createWorkspaceHandle(result.workspace) : null,
  };
}

function resolveWorkspaceId(workspace: string | BySpaceWorkspaceHandle): string {
  return typeof workspace === "string" ? workspace : workspace.id;
}

function providerConfig(
  provider: BySpaceAgentProvider,
  input: BySpaceProviderConfigInput = {},
): BySpaceProviderConfig {
  return {
    provider,
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.modeId !== undefined ? { modeId: input.modeId } : {}),
    ...(input.thinkingOptionId !== undefined ? { thinkingOptionId: input.thinkingOptionId } : {}),
    ...(input.featureValues !== undefined ? { featureValues: input.featureValues } : {}),
  };
}

function createGeneratedClientId(): string {
  const randomId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `byspace-sdk-${randomId}`;
}
