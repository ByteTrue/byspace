import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBySpaceNodeEnv } from "./byspace-env.js";
import { expandTilde } from "../utils/path.js";

import type { BySpaceDaemonConfig } from "./bootstrap.js";
import {
  loadPersistedConfig,
  LogFormatSchema,
  LogLevelSchema,
  type PersistedConfig,
} from "./persisted-config.js";
import type {
  AgentProviderRuntimeSettingsMap,
  ProviderOverride,
} from "./agent/provider-launch-config.js";
import { ProviderOverrideSchema } from "./agent/provider-launch-config.js";
import { AgentProviderSchema } from "@bytetrue/byspace-protocol/provider-manifest";
import { hashDaemonPassword } from "./auth.js";
import { resolveSpeechConfig } from "./speech/speech-config-resolver.js";
import { mergeHostnames, parseHostnamesEnv, type HostnamesConfig } from "./hostnames.js";
import {
  isBySpaceHostedAppBaseUrl,
  isBySpaceHostedRelayEndpoint,
  resolveBySpaceHostedRelease,
  type BySpaceHostedRelease,
} from "@bytetrue/byspace-protocol/release-channel";
import { resolveDaemonVersion } from "./daemon-version.js";
import { normalizeHostPort } from "@bytetrue/byspace-protocol/daemon-endpoints";

const DEFAULT_PORT = 6777;
const DEFAULT_TRUSTED_PROXIES = ["loopback"];

interface ResolveBundledWebUiDistDirInput {
  moduleUrl?: string | URL;
  resourcesPath?: string;
}

export function resolveBundledWebUiDistDir(input: ResolveBundledWebUiDistDirInput = {}): string {
  const moduleUrl = input.moduleUrl ?? import.meta.url;
  const moduleDir = path.dirname(fileURLToPath(moduleUrl));

  if (path.basename(moduleDir) === "server" && path.basename(path.dirname(moduleDir)) === "src") {
    return path.resolve(moduleDir, "..", "..", "dist", "server", "web-ui");
  }

  if (
    path.basename(moduleDir) === "server" &&
    path.basename(path.dirname(moduleDir)) === "server" &&
    path.basename(path.dirname(path.dirname(moduleDir))) === "dist"
  ) {
    const appDistDir = input.resourcesPath ? path.join(input.resourcesPath, "app-dist") : null;

    if (appDistDir && existsSync(appDistDir)) {
      return appDistDir;
    }

    return path.resolve(moduleDir, "..", "web-ui");
  }

  return path.resolve(moduleDir, "web-ui");
}

const processResourcesPath = "resourcesPath" in process ? process.resourcesPath : undefined;
const BUNDLED_WEB_UI_DIST_DIR = resolveBundledWebUiDistDir({
  resourcesPath: typeof processResourcesPath === "string" ? processResourcesPath : undefined,
});

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
}

function normalizeLogEnv(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value.trim().toLowerCase();
}

export type CliConfigOverrides = Partial<{
  listen: string;
  relayEnabled: boolean;
  relayUseTls: boolean;
  mcpEnabled: boolean;
  webUiEnabled: boolean;
  hostnames: HostnamesConfig;
}>;

type TrustedProxiesConfig = true | string[];

function resolveLogConfigFromEnv(
  env: NodeJS.ProcessEnv,
  persisted: ReturnType<typeof loadPersistedConfig>,
): PersistedConfig["log"] {
  const envLogLevel = LogLevelSchema.safeParse(normalizeLogEnv(env.BYSPACE_LOG_LEVEL));
  const envLogFormat = LogFormatSchema.safeParse(normalizeLogEnv(env.BYSPACE_LOG_FORMAT));

  if (!envLogLevel.success && !envLogFormat.success) {
    return persisted.log;
  }

  return {
    ...persisted.log,
    ...(envLogLevel.success ? { level: envLogLevel.data } : {}),
    ...(envLogFormat.success ? { format: envLogFormat.data } : {}),
  };
}

function extractProviderOverrides(
  providers: Record<string, unknown> | undefined,
): Record<string, ProviderOverride> | undefined {
  if (!providers) {
    return undefined;
  }

  const providerOverrides = Object.entries(providers).flatMap(([providerId, provider]) => {
    const parsed = ProviderOverrideSchema.safeParse(provider);
    return parsed.success ? [[providerId, parsed.data] as const] : [];
  });

  return providerOverrides.length > 0 ? Object.fromEntries(providerOverrides) : undefined;
}

function extractAgentProviderSettings(
  providerOverrides: Record<string, ProviderOverride> | undefined,
): AgentProviderRuntimeSettingsMap | undefined {
  if (!providerOverrides) {
    return undefined;
  }

  const runtimeSettings = Object.entries(providerOverrides).flatMap(([providerId, provider]) => {
    const parsedProviderId = AgentProviderSchema.safeParse(providerId);
    if (!parsedProviderId.success || (!provider.command && !provider.env)) {
      return [];
    }

    return [
      [
        parsedProviderId.data,
        {
          command: provider.command
            ? {
                mode: "replace" as const,
                argv: provider.command,
              }
            : undefined,
          env: provider.env,
        },
      ] as const,
    ];
  });

  return runtimeSettings.length > 0
    ? (Object.fromEntries(runtimeSettings) as AgentProviderRuntimeSettingsMap)
    : undefined;
}

interface ResolveRelayInput {
  env: NodeJS.ProcessEnv;
  persisted: ReturnType<typeof loadPersistedConfig>;
  cliRelayEnabled: boolean | undefined;
  cliRelayUseTls: boolean | undefined;
  configCreated: boolean;
  hostedRelease: BySpaceHostedRelease;
}

interface ResolvedRelay {
  enabled: boolean;
  enabledMutable: boolean;
  endpoint: string;
  publicEndpoint: string;
  useTls: boolean;
  publicUseTls: boolean;
}

interface ResolvedServiceProxy {
  publicBaseUrl: string | null;
  standaloneListen: string | null;
}

function parseDataRelayEndpoint(value: string | undefined, variable: string): string | null {
  const endpoint = value?.trim();
  if (!endpoint) return null;
  try {
    return normalizeHostPort(endpoint);
  } catch {
    throw new Error(`Invalid ${variable}: ${endpoint}`);
  }
}

function resolveDataRelayConfig(env: NodeJS.ProcessEnv) {
  const endpoint = parseDataRelayEndpoint(
    env.BYSPACE_DATA_RELAY_ENDPOINT,
    "BYSPACE_DATA_RELAY_ENDPOINT",
  );
  const publicEndpoint = parseDataRelayEndpoint(
    env.BYSPACE_DATA_RELAY_PUBLIC_ENDPOINT,
    "BYSPACE_DATA_RELAY_PUBLIC_ENDPOINT",
  );
  const useTls = parseBooleanEnv(env.BYSPACE_DATA_RELAY_USE_TLS) ?? true;
  return {
    dataRelayListen: env.BYSPACE_DATA_RELAY_LISTEN?.trim() || null,
    dataRelayEndpoint: endpoint,
    dataRelayPublicEndpoint: publicEndpoint ?? endpoint,
    dataRelayUseTls: useTls,
    dataRelayPublicUseTls: parseBooleanEnv(env.BYSPACE_DATA_RELAY_PUBLIC_USE_TLS) ?? useTls,
    dataRelayAccessToken: env.BYSPACE_DATA_RELAY_ACCESS_TOKEN?.trim() || null,
  };
}

function resolveTlsFromEnv(
  envValue: string | undefined,
  persistedValue: boolean | undefined,
  fallback: boolean,
): boolean {
  if (envValue !== undefined) {
    return parseBooleanEnv(envValue) ?? false;
  }
  return persistedValue ?? fallback;
}

function mapHostedRelayEndpoint(
  value: string | undefined,
  hostedRelease: BySpaceHostedRelease,
): string | undefined {
  return isBySpaceHostedRelayEndpoint(value) ? hostedRelease.relayEndpoint : value;
}

function mapHostedAppBaseUrl(
  value: string | undefined,
  hostedRelease: BySpaceHostedRelease,
): string | undefined {
  return isBySpaceHostedAppBaseUrl(value) ? hostedRelease.appBaseUrl : value;
}

function resolveRelayTlsDefault(
  endpoint: string,
  configuredUseTls: boolean | undefined,
  inheritedUseTls = false,
): boolean {
  return configuredUseTls ?? (isBySpaceHostedRelayEndpoint(endpoint) || inheritedUseTls);
}

function isRelayEnabledMutable(input: ResolveRelayInput): boolean {
  return input.cliRelayEnabled === undefined && input.env.BYSPACE_RELAY_ENABLED === undefined;
}

function resolveRelayConfig(input: ResolveRelayInput): ResolvedRelay {
  const enabledMutable = isRelayEnabledMutable(input);
  const enabled =
    input.cliRelayEnabled ??
    parseBooleanEnv(input.env.BYSPACE_RELAY_ENABLED) ??
    input.persisted.daemon?.relay?.enabled ??
    input.configCreated;
  const endpoint =
    input.env.BYSPACE_RELAY_ENDPOINT ??
    mapHostedRelayEndpoint(input.persisted.daemon?.relay?.endpoint, input.hostedRelease) ??
    input.hostedRelease.relayEndpoint;
  const publicEndpoint =
    input.env.BYSPACE_RELAY_PUBLIC_ENDPOINT ??
    mapHostedRelayEndpoint(input.persisted.daemon?.relay?.publicEndpoint, input.hostedRelease) ??
    endpoint;
  const configuredUseTls =
    input.cliRelayUseTls ??
    parseBooleanEnv(input.env.BYSPACE_RELAY_USE_TLS) ??
    input.persisted.daemon?.relay?.useTls;
  const useTls = resolveRelayTlsDefault(endpoint, configuredUseTls);
  const publicUseTls = resolveTlsFromEnv(
    input.env.BYSPACE_RELAY_PUBLIC_USE_TLS,
    input.persisted.daemon?.relay?.publicUseTls,
    resolveRelayTlsDefault(publicEndpoint, configuredUseTls, useTls),
  );
  return { enabled, enabledMutable, endpoint, publicEndpoint, useTls, publicUseTls };
}

function resolveServiceProxyPublicBaseUrl(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`Invalid BYSPACE_SERVICE_PROXY_PUBLIC_BASE_URL: ${value}`);
  }
}

function resolveServiceProxyConfig(
  env: NodeJS.ProcessEnv,
  persisted: ReturnType<typeof loadPersistedConfig>,
): ResolvedServiceProxy {
  const enabledShim =
    parseBooleanEnv(env.BYSPACE_SERVICE_PROXY_ENABLED) ?? persisted.daemon?.serviceProxy?.enabled;
  // COMPAT(serviceProxyEnabled): added 2026-06-02, remove after 2026-12-02.
  // `enabled=false` used to disable the separate service proxy listener. Localhost
  // service proxying is now always enabled; this only suppresses optional layers.
  const optionalLayersEnabled = enabledShim !== false;
  const publicBaseUrl = optionalLayersEnabled
    ? resolveServiceProxyPublicBaseUrl(
        env.BYSPACE_SERVICE_PROXY_PUBLIC_BASE_URL ??
          persisted.daemon?.serviceProxy?.publicBaseUrl ??
          null,
      )
    : null;
  const standaloneListen = optionalLayersEnabled
    ? (env.BYSPACE_SERVICE_PROXY_LISTEN ?? persisted.daemon?.serviceProxy?.listen ?? null)
    : null;

  return { publicBaseUrl, standaloneListen };
}

interface ResolvedWebUi {
  enabled: boolean;
  distDir: string | null;
}

function resolveWebUiConfig(
  byspaceHome: string,
  env: NodeJS.ProcessEnv,
  cli: CliConfigOverrides | undefined,
  persisted: ReturnType<typeof loadPersistedConfig>,
): ResolvedWebUi {
  const enabled =
    cli?.webUiEnabled ??
    parseBooleanEnv(env.BYSPACE_WEB_UI_ENABLED) ??
    persisted.features?.webUi?.enabled ??
    true;
  const rawDistDir = env.BYSPACE_WEB_UI_DIST_DIR ?? persisted.features?.webUi?.distDir;
  const trimmedDistDir = rawDistDir?.trim();
  const distDir = trimmedDistDir
    ? path.resolve(path.isAbsolute(trimmedDistDir) ? trimmedDistDir : byspaceHome, trimmedDistDir)
    : BUNDLED_WEB_UI_DIST_DIR;
  return {
    enabled,
    distDir,
  };
}

function resolveCorsAllowedOrigins(
  env: NodeJS.ProcessEnv,
  persisted: ReturnType<typeof loadPersistedConfig>,
  hostedRelease: BySpaceHostedRelease,
): string[] {
  const envCorsOrigins = env.BYSPACE_CORS_ORIGINS
    ? env.BYSPACE_CORS_ORIGINS.split(",").map((origin) => origin.trim())
    : [];
  const persistedCorsOrigins = (persisted.daemon?.cors?.allowedOrigins ?? []).map((origin) =>
    isBySpaceHostedAppBaseUrl(origin) ? hostedRelease.appBaseUrl : origin,
  );
  return Array.from(
    new Set([...persistedCorsOrigins, ...envCorsOrigins].filter((origin) => origin.length > 0)),
  );
}

function parseTrustedProxiesEnv(value: string | undefined): TrustedProxiesConfig | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const normalized = trimmed.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return [];
  }

  return trimmed
    .split(",")
    .map((proxy) => proxy.trim())
    .filter((proxy) => proxy.length > 0);
}

function resolveTrustedProxiesConfig(
  env: NodeJS.ProcessEnv,
  persisted: ReturnType<typeof loadPersistedConfig>,
): TrustedProxiesConfig {
  return (
    parseTrustedProxiesEnv(env.BYSPACE_TRUSTED_PROXIES) ??
    persisted.daemon?.trustedProxies ??
    DEFAULT_TRUSTED_PROXIES
  );
}

// BYSPACE_LISTEN can be:
// - host:port (TCP)
// - /path/to/socket (Unix socket)
// - unix:///path/to/socket (Unix socket)
// Default is TCP at 127.0.0.1:6777
function resolveListenAddress(
  env: NodeJS.ProcessEnv,
  cli: CliConfigOverrides | undefined,
  persisted: ReturnType<typeof loadPersistedConfig>,
): string {
  return (
    cli?.listen ??
    env.BYSPACE_LISTEN ??
    persisted.daemon?.listen ??
    `127.0.0.1:${env.PORT ?? DEFAULT_PORT}`
  );
}

function resolveAuthConfig(
  env: NodeJS.ProcessEnv,
  persisted: ReturnType<typeof loadPersistedConfig>,
): BySpaceDaemonConfig["auth"] {
  const envPassword = env.BYSPACE_PASSWORD?.trim();
  if (envPassword) {
    return { password: hashDaemonPassword(envPassword) };
  }
  return persisted.daemon?.auth?.password
    ? { password: persisted.daemon.auth.password }
    : undefined;
}

function resolveWorktreesRoot(
  byspaceHome: string,
  persisted: ReturnType<typeof loadPersistedConfig>,
): string | undefined {
  const configuredRoot = persisted.worktrees?.root?.trim();
  if (!configuredRoot) {
    return undefined;
  }

  const expandedRoot = expandTilde(configuredRoot);
  return path.isAbsolute(expandedRoot)
    ? path.resolve(expandedRoot)
    : path.resolve(byspaceHome, expandedRoot);
}

function resolveAppendSystemPrompt(persisted: ReturnType<typeof loadPersistedConfig>): string {
  return persisted.daemon?.appendSystemPrompt ?? "";
}

function resolveProviderCatalogRefreshTimeout(
  persisted: ReturnType<typeof loadPersistedConfig>,
): number | undefined {
  return persisted.agents?.catalogRefreshTimeoutMs;
}

/** Preserve undefined so an explicit empty profile list keeps its meaning. */
function resolveProfileLists(persisted: ReturnType<typeof loadPersistedConfig>) {
  return {
    terminalProfiles: persisted.daemon?.terminalProfiles,
    agentProfiles: persisted.daemon?.agentProfiles,
  };
}

function resolveStaticLoadConfigSettings(
  env: NodeJS.ProcessEnv,
  cli: CliConfigOverrides | undefined,
  persisted: ReturnType<typeof loadPersistedConfig>,
  hostedRelease: BySpaceHostedRelease,
) {
  return {
    mcpEnabled: cli?.mcpEnabled ?? persisted.daemon?.mcp?.enabled ?? true,
    autoArchiveAfterMerge: persisted.daemon?.autoArchiveAfterMerge ?? false,
    appendSystemPrompt: resolveAppendSystemPrompt(persisted),
    ...resolveProfileLists(persisted),
    hostnames: mergeHostnames([
      persisted.daemon?.hostnames,
      parseHostnamesEnv(env.BYSPACE_HOSTNAMES ?? env.BYSPACE_ALLOWED_HOSTS),
      cli?.hostnames,
    ]),
    trustedProxies: resolveTrustedProxiesConfig(env, persisted),
    appBaseUrl:
      env.BYSPACE_APP_BASE_URL ??
      mapHostedAppBaseUrl(persisted.app?.baseUrl, hostedRelease) ??
      hostedRelease.appBaseUrl,
  };
}

export function loadConfig(
  byspaceHome: string,
  options?: {
    env?: NodeJS.ProcessEnv;
    cli?: CliConfigOverrides;
    releaseVersion?: string;
  },
): BySpaceDaemonConfig {
  const env = options?.env ?? process.env;
  const daemonVersion = options?.releaseVersion ?? resolveDaemonVersion();
  const hostedRelease = resolveBySpaceHostedRelease(daemonVersion);
  const configCreated = existsSync(path.join(byspaceHome, "config.json"));
  const persisted = loadPersistedConfig(byspaceHome);
  const listen = resolveListenAddress(env, options?.cli, persisted);
  const {
    mcpEnabled,
    autoArchiveAfterMerge,
    appendSystemPrompt,
    terminalProfiles,
    agentProfiles,
    hostnames,
    trustedProxies,
    appBaseUrl,
  } = resolveStaticLoadConfigSettings(env, options?.cli, persisted, hostedRelease);

  const relay = resolveRelayConfig({
    env,
    persisted,
    cliRelayEnabled: options?.cli?.relayEnabled,
    cliRelayUseTls: options?.cli?.relayUseTls,
    configCreated,
    hostedRelease,
  });
  const serviceProxy = resolveServiceProxyConfig(env, persisted);
  const dataRelay = resolveDataRelayConfig(env);
  const webUi = resolveWebUiConfig(byspaceHome, env, options?.cli, persisted);

  const speech = resolveSpeechConfig({
    byspaceHome,
    env,
    persisted,
  });

  const providerOverrides = extractProviderOverrides(
    persisted.agents?.providers as Record<string, unknown> | undefined,
  );

  return {
    listen,
    byspaceHome,
    daemonVersion,
    worktreesRoot: resolveWorktreesRoot(byspaceHome, persisted),
    workspaceServicePorts: persisted.worktrees?.servicePorts,
    corsAllowedOrigins: resolveCorsAllowedOrigins(env, persisted, hostedRelease),
    hostnames,
    trustedProxies,
    mcpEnabled,
    autoArchiveAfterMerge,
    enableTerminalAgentHooks: persisted.daemon?.enableTerminalAgentHooks ?? false,
    terminalAgentHooks: persisted.daemon?.terminalAgentHooks,
    appendSystemPrompt,
    terminalProfiles,
    agentProfiles,
    mcpDebug: env.MCP_DEBUG === "1",
    isDev: resolveBySpaceNodeEnv(env) === "development",
    agentStoragePath: path.join(byspaceHome, "agents"),
    staticDir: "public",
    agentClients: {},
    relayEnabled: relay.enabled,
    relayEnabledMutable: relay.enabledMutable,
    relayEndpoint: relay.endpoint,
    relayPublicEndpoint: relay.publicEndpoint,
    relayUseTls: relay.useTls,
    relayPublicUseTls: relay.publicUseTls,
    ...dataRelay,
    serviceProxy,
    webUi,
    appBaseUrl,
    auth: resolveAuthConfig(env, persisted),
    speech,
    dictationRefineWithAgent: Boolean(persisted.features?.dictation?.refineWithAgent),
    agentProviderSettings: extractAgentProviderSettings(providerOverrides),
    providerCatalogRefreshTimeoutMs: resolveProviderCatalogRefreshTimeout(persisted),
    metadataGeneration: persisted.agents?.metadataGeneration,
    providerOverrides,
    log: resolveLogConfigFromEnv(env, persisted),
  };
}
