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
  WorkspaceCreateRequest,
} from "@bytetrue/byspace-protocol/messages";
import { DaemonClient } from "./daemon-client.js";
export { DaemonClient };
export type {
  DaemonClientConfig,
  DaemonEvent,
  WebSocketFactory,
  WebSocketLike,
} from "./daemon-client.js";
import type {
  FetchAgentsEntry,
  FetchAgentsOptions,
  FetchAgentsPageInfo,
  FetchAgentTimelineCursor,
  FetchAgentTimelineDirection,
  FetchAgentTimelinePayload,
  FetchAgentTimelineProjection,
  WaitForFinishResult,
} from "./daemon-client.js";

/**
 * Coding turns routinely run for minutes, so the handle waits far longer than
 * the transport's own conservative default.
 */
const DEFAULT_WAIT_FOR_FINISH_MS = 10 * 60_000;

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
  headers?: Record<string, string>;
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
export type BySpaceAgentListOptions = FetchAgentsOptions;

export interface BySpaceAgentListResult {
  requestId: string;
  subscriptionId?: string | null;
  entries: FetchAgentsEntry[];
  pageInfo: FetchAgentsPageInfo;
}
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

export type BySpaceWorkspaceCreateOptions = Omit<WorkspaceCreateRequest, "type" | "requestId"> & {
  requestId?: string;
};

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

export interface BySpaceWorkspaceHandle {
  readonly id: string;
  readonly projectId: string | null;
  readonly directory: string | null;
  readonly name: string | null;
  readonly status: BySpaceWorkspace["status"] | null;
  readonly agents: {
    create(options: BySpaceWorkspaceAgentCreateOptions): Promise<BySpaceAgentHandle>;
  };
  current(): BySpaceWorkspace | null;
  refresh(options?: { requestId?: string }): Promise<BySpaceWorkspace | null>;
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
  ): Promise<BySpaceWorkspaceHandle>;
  create(options: BySpaceWorkspaceCreateOptions): Promise<BySpaceWorkspaceHandle>;
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
export type BySpaceAgentProvider = BySpaceAgentSessionConfig["provider"];

export type BySpaceProviderFeatureValues = Record<string, unknown>;

export interface BySpaceAgentConfig {
  /** Provider and model in `provider/model` format. */
  provider: string;
  modeId?: BySpaceAgentSessionConfig["modeId"];
  thinkingOptionId?: BySpaceAgentSessionConfig["thinkingOptionId"];
  featureValues?: BySpaceProviderFeatureValues;
  /** JSON-safe provider-native settings, validated by the selected provider. */
  options?: BySpaceAgentSessionConfig["providerOptions"];
  systemPrompt?: BySpaceAgentSessionConfig["systemPrompt"];
  mcpServers?: BySpaceAgentSessionConfig["mcpServers"];
}

export interface BySpaceAgentCreateOptions {
  config: BySpaceAgentConfig;
  cwd: string;
  parent?: string | BySpaceAgentHandle;
  title?: BySpaceAgentSessionConfig["title"];
  env?: CreateAgentRequestMessage["env"];
  prompt?: string;
  clientMessageId?: string;
  outputSchema?: Record<string, unknown>;
  images?: CreateAgentRequestMessage["images"];
  attachments?: CreateAgentRequestMessage["attachments"];
  git?: CreateAgentRequestMessage["git"];
  worktree?: CreateAgentRequestMessage["worktree"];
  autoArchive?: CreateAgentRequestMessage["autoArchive"];
  requestId?: string;
  labels?: Record<string, string>;
}

export type BySpaceWorkspaceAgentCreateOptions = Omit<BySpaceAgentCreateOptions, "cwd">;

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

export interface BySpaceAgentRunOptions extends BySpaceAgentSendOptions {
  timeoutMs?: number;
}

export type BySpaceAgentRunResult = WaitForFinishResult;

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
   * includes an agent snapshot in the response, the parent handle is updated to
   * that value.
   */
  refetch(options?: BySpaceAgentTimelineRefetchOptions): Promise<FetchAgentTimelinePayload>;
  /**
   * Local listener for agent_stream events matching this handle id. It does not
   * retain timeline entries or own application cache state.
   */
  subscribe(handler: (event: BySpaceAgentStream) => void): () => void;
}

export interface BySpaceAgentHandle {
  readonly id: string;
  readonly workspaceId: string | null;
  readonly cwd: string | null;
  readonly status: BySpaceAgent["status"] | null;
  readonly timeline: BySpaceAgentTimelineHandle;
  current(): BySpaceAgent | null;
  refresh(requestId?: string): Promise<BySpaceAgentRefetchResult | null>;
  send(text: string, options?: BySpaceAgentSendOptions): Promise<void>;
  /** Sends a prompt and resolves when that turn finishes or needs attention. */
  run(text: string, options?: BySpaceAgentRunOptions): Promise<BySpaceAgentRunResult>;
  /** Waits for the current turn, including one started with `prompt`. */
  waitForFinish(timeoutMs?: number): Promise<BySpaceAgentRunResult>;
  archive(): Promise<{ archivedAt: string }>;
  detach(): Promise<void>;
  subscribe(handler: (update: BySpaceAgentUpdate) => void): () => void;
}

export interface BySpaceAgentActions {
  list(options?: BySpaceAgentListOptions): Promise<BySpaceAgentListResult>;
  ref(agent: string | BySpaceAgent): BySpaceAgentHandle;
  create(options: BySpaceAgentCreateOptions): Promise<BySpaceAgentHandle>;
  /**
   * Local event subscription over the low-level driver's agent_update stream.
   * The returned function only removes this SDK listener.
   */
  subscribe(handler: BySpaceAgentUpdateHandler): () => void;
}

export type BySpaceProviderModelsResult = ListProviderModelsResponseMessage["payload"];
export type BySpaceProviderModesResult = ListProviderModesResponseMessage["payload"];
type BySpaceProviderFeaturesDraft = ListProviderFeaturesRequestMessage["draftConfig"];
export interface BySpaceProviderFeaturesInput extends Omit<
  BySpaceProviderFeaturesDraft,
  "provider" | "model"
> {
  /** Provider and model in `provider/model` format. */
  provider: string;
}
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

export interface BySpaceProviderWaitOptions extends BySpaceProviderListOptions {
  timeoutMs?: number;
}

export interface BySpaceProviderActions {
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
  /** Resolves after the daemon's lazy provider discovery has finished. */
  waitForReady(options?: BySpaceProviderWaitOptions): Promise<BySpaceProviderSnapshotResult>;
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
  const createAgentHandle = createAgentHandleFactory(daemonClient);
  const createAgent = async (
    options: BySpaceAgentCreateOptions,
    placement?: { workspaceId: string; cwd: string },
  ) => {
    const { config: agentConfig, cwd, parent, title, prompt, ...requestOptions } = options;
    const { provider: providerModel, options: providerOptions, ...runtimeConfig } = agentConfig;
    const { provider, model } = parseProviderModel(providerModel);
    const effectiveCwd = placement?.cwd ?? cwd;
    const agent = await daemonClient.createAgent({
      ...requestOptions,
      config: {
        ...runtimeConfig,
        provider,
        model,
        cwd: effectiveCwd,
        ...(title !== undefined ? { title } : {}),
        ...(providerOptions !== undefined ? { providerOptions } : {}),
      },
      ...(placement ? { workspaceId: placement.workspaceId } : {}),
      ...(parent ? { callerAgentId: resolveAgentId(parent) } : {}),
      ...(prompt !== undefined ? { initialPrompt: prompt } : {}),
    });
    return createAgentHandle(agent);
  };
  const createWorkspaceHandle = createWorkspaceHandleFactory(daemonClient, createAgent);

  return {
    workspaces: {
      list: (options) => daemonClient.fetchWorkspaces(options),
      ref: (workspace) => createWorkspaceHandle(workspace),
      open: (input, requestId) =>
        openWorkspace(daemonClient, createWorkspaceHandle, input, requestId),
      create: async ({ requestId, ...options }) => {
        const result = await daemonClient.createWorkspace(options, requestId);
        if (result.error || !result.workspace) {
          throw new Error(result.error ?? "The daemon did not create a workspace");
        }
        return createWorkspaceHandle(result.workspace);
      },
      archive: (workspace, requestId) =>
        daemonClient.archiveWorkspace(resolveWorkspaceId(workspace), requestId),
      subscribe: (handler) =>
        daemonClient.on("workspace_update", (message) => {
          handler(message.payload);
        }),
    },
    agents: {
      list: (options) => daemonClient.fetchAgents(options),
      ref: (agent) => createAgentHandle(agent),
      create: (options) => createAgent(options),
      subscribe: (handler) =>
        daemonClient.on("agent_update", (message) => {
          handler(message.payload);
        }),
    },
    providers: {
      listModels: (provider, options) => daemonClient.listProviderModels(provider, options),
      listModes: (provider, options) => daemonClient.listProviderModes(provider, options),
      listFeatures: ({ provider: providerModel, ...draftConfig }, options) => {
        const { provider, model } = parseProviderModel(providerModel);
        return daemonClient.listProviderFeatures({ ...draftConfig, provider, model }, options);
      },
      listAvailable: (options) => daemonClient.listAvailableProviders(options),
      snapshot: (options) => daemonClient.getProvidersSnapshot(options),
      waitForReady: (options) => waitForProvidersReady(daemonClient, options),
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
type CreateAgent = (
  options: BySpaceAgentCreateOptions,
  placement?: { workspaceId: string; cwd: string },
) => Promise<BySpaceAgentHandle>;

function createWorkspaceHandleFactory(
  daemonClient: DaemonClient,
  createAgent: CreateAgent,
): WorkspaceHandleFactory {
  return (workspace) => {
    const id = typeof workspace === "string" ? workspace : workspace.id;
    let current = typeof workspace === "string" ? null : workspace;

    const refresh = async (options?: { requestId?: string }) => {
      let cursor: string | undefined;
      let requestId = options?.requestId;
      do {
        const result = await daemonClient.fetchWorkspaces({
          requestId,
          page: { limit: 200, ...(cursor ? { cursor } : {}) },
        });
        const match = result.entries.find((entry) => entry.id === id);
        if (match) {
          current = match;
          return current;
        }
        cursor = result.pageInfo.nextCursor ?? undefined;
        requestId = undefined;
      } while (cursor);
      current = null;
      return current;
    };

    return {
      id,
      get projectId() {
        return current?.projectId ?? null;
      },
      get directory() {
        return current?.workspaceDirectory ?? null;
      },
      get name() {
        return current?.name ?? null;
      },
      get status() {
        return current?.status ?? null;
      },
      agents: {
        create: async (options) => {
          const snapshot = current ?? (await refresh());
          if (!snapshot?.workspaceDirectory) {
            throw new Error(`Workspace ${id} has no available directory`);
          }
          return createAgent(
            { ...options, cwd: snapshot.workspaceDirectory },
            { workspaceId: id, cwd: snapshot.workspaceDirectory },
          );
        },
      },
      current: () => current,
      refresh,
      archive: async (requestId) => {
        const result = await daemonClient.archiveWorkspace(id, requestId);
        if (current) {
          current = { ...current, archivingAt: result.archivedAt };
        }
        return result;
      },
      subscribe: (handler) =>
        daemonClient.on("workspace_update", (message) => {
          const update = message.payload;
          if (update.kind === "upsert" && update.workspace.id === id) {
            current = update.workspace;
            handler(update);
          }
          if (update.kind === "remove" && update.id === id) {
            current = null;
            handler(update);
          }
        }),
    };
  };
}

function createAgentHandleFactory(daemonClient: DaemonClient): AgentHandleFactory {
  return (agent) => {
    const id = typeof agent === "string" ? agent : agent.id;
    let current = typeof agent === "string" ? null : agent;

    const handle: BySpaceAgentHandle = {
      id,
      timeline: {
        refetch: async (options) => {
          const result = await daemonClient.fetchAgentTimeline(id, options);
          if (result.agent) {
            current = result.agent;
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
      get workspaceId() {
        return current?.workspaceId ?? null;
      },
      get cwd() {
        return current?.cwd ?? null;
      },
      get status() {
        return current?.status ?? null;
      },
      current: () => current,
      refresh: async (requestId) => {
        const result = await daemonClient.fetchAgent({ agentId: id, requestId });
        current = result?.agent ?? null;
        return result;
      },
      send: async (text, options) => {
        await daemonClient.sendAgentMessage(id, text, options);
      },
      run: async (text, options) => {
        const { timeoutMs, ...sendOptions } = options ?? {};
        await daemonClient.sendAgentMessage(id, text, sendOptions);
        const result = await daemonClient.waitForFinish(
          id,
          timeoutMs ?? DEFAULT_WAIT_FOR_FINISH_MS,
        );
        if (result.final) {
          current = result.final;
        }
        return result;
      },
      waitForFinish: async (timeoutMs) => {
        const result = await daemonClient.waitForFinish(
          id,
          timeoutMs ?? DEFAULT_WAIT_FOR_FINISH_MS,
        );
        if (result.final) {
          current = result.final;
        }
        return result;
      },
      archive: async () => {
        const result = await daemonClient.archiveAgent(id);
        if (current) {
          current = { ...current, archivedAt: result.archivedAt };
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
            current = update.agent;
            handler(update);
          }
          if (update.kind === "remove" && update.agentId === id) {
            current = null;
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
): Promise<BySpaceWorkspaceHandle> {
  const options = typeof input === "string" ? { cwd: input, requestId } : input;
  const result = await daemonClient.openProject(options.cwd, options.requestId);
  if (result.error || !result.workspace) {
    throw new Error(result.error ?? `The daemon did not open a workspace for ${options.cwd}`);
  }
  return createWorkspaceHandle(result.workspace);
}

function resolveWorkspaceId(workspace: string | BySpaceWorkspaceHandle): string {
  return typeof workspace === "string" ? workspace : workspace.id;
}

function resolveAgentId(agent: string | BySpaceAgentHandle): string {
  return typeof agent === "string" ? agent : agent.id;
}

function parseProviderModel(selection: string): { provider: string; model: string } {
  const separator = selection.indexOf("/");
  if (separator <= 0 || separator === selection.length - 1) {
    throw new Error('Expected config.provider in "provider/model" format');
  }
  return {
    provider: selection.slice(0, separator),
    model: selection.slice(separator + 1),
  };
}

function waitForProvidersReady(
  daemonClient: DaemonClient,
  options: BySpaceProviderWaitOptions = {},
): Promise<BySpaceProviderSnapshotResult> {
  // COMPAT(providersSnapshotCwd): added in v0.6.0, remove gate after 2027-02-21.
  if (daemonClient.getLastServerInfoMessage()?.features?.providersSnapshotCwd !== true) {
    return Promise.reject(new Error("Update the host to wait for provider discovery."));
  }

  const { timeoutMs = 60_000, ...snapshotOptions } = options;

  return new Promise((resolve, reject) => {
    let settled = false;
    let requestId: string | null = null;
    let snapshotCwd: string | undefined;
    const pendingUpdates = new Map<string | undefined, BySpaceProviderSnapshotUpdate>();
    let latestEntries: BySpaceProviderSnapshotResult["entries"] = [];

    const cleanup = () => {
      clearTimeout(timeout);
      unsubscribe();
    };
    const finish = (snapshot: BySpaceProviderSnapshotResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(snapshot);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const updateMatches = (update: BySpaceProviderSnapshotUpdate) => update.cwd === snapshotCwd;

    const unsubscribe = daemonClient.on("providers_snapshot_update", (message) => {
      const update = message.payload;
      if (!requestId) {
        pendingUpdates.set(update.cwd, update);
        return;
      }
      if (!updateMatches(update)) return;
      latestEntries = update.entries;
      if (update.entries.some((entry) => entry.status === "loading")) return;
      finish({ ...update, requestId });
    });

    const timeout = setTimeout(() => {
      const loading = latestEntries
        .filter((entry) => entry.status === "loading")
        .map((entry) => entry.provider)
        .join(", ");
      fail(
        new Error(
          loading
            ? `Timed out waiting for providers: ${loading}`
            : "Timed out waiting for provider discovery",
        ),
      );
    }, timeoutMs);

    void daemonClient
      .getProvidersSnapshot(snapshotOptions)
      .then((snapshot) => {
        requestId = snapshot.requestId;
        snapshotCwd = snapshot.cwd;
        latestEntries = snapshot.entries;
        if (!snapshot.entries.some((entry) => entry.status === "loading")) {
          finish(snapshot);
          return;
        }
        const pendingUpdate = pendingUpdates.get(snapshotCwd);
        if (pendingUpdate && !pendingUpdate.entries.some((entry) => entry.status === "loading")) {
          finish({ ...pendingUpdate, requestId });
        }
        return undefined;
      })
      .catch(fail);
  });
}

function createGeneratedClientId(): string {
  const randomId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `byspace-sdk-${randomId}`;
}
