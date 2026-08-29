import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
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
import { resolveGitProcessPolicy } from "../utils/git-process-scheduler.js";

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
  mcpInjectIntoAgents: boolean;
  webUiEnabled: boolean;
  hostnames: HostnamesConfig;
}>;

type TrustedProxiesConfig = true | string[];

function resolveLogConfigFromEnv(
  env: NodeJS.ProcessEnv,
  persisted: PersistedConfig,
): PersistedConfig["log"] {
  const level = parseLogLevelEnv(env.BYSPACE_LOG_LEVEL ?? env.BYSPACE_LOG);
  const format = parseLogFormatEnv(env.BYSPACE_LOG_FORMAT);
  const console = resolveConsoleLogConfigFromEnv(env, persisted.log?.console);
  const file = resolveFileLogConfigFromEnv(env, persisted.log?.file);

  if (level === undefined && format === undefined && !console && !file) {
    return persisted.log;
  }

  return {
    ...persisted.log,
    ...(level !== undefined ? { level } : {}),
    ...(format !== undefined ? { format } : {}),
    ...(console ? { console } : {}),
    ...(file ? { file } : {}),
  };
}

function resolveConsoleLogConfigFromEnv(
  env: NodeJS.ProcessEnv,
  persisted: NonNullable<PersistedConfig["log"]>["console"],
): NonNullable<PersistedConfig["log"]>["console"] {
  const level = parseLogLevelEnv(env.BYSPACE_LOG_CONSOLE_LEVEL);
  const format = parseLogFormatEnv(env.BYSPACE_LOG_CONSOLE_FORMAT);
  if (level === undefined && format === undefined) return undefined;
  return {
    ...persisted,
    ...(level !== undefined ? { level } : {}),
    ...(format !== undefined ? { format } : {}),
  };
}

function resolveFileLogConfigFromEnv(
  env: NodeJS.ProcessEnv,
  persisted: NonNullable<PersistedConfig["log"]>["file"],
): NonNullable<PersistedConfig["log"]>["file"] {
  const level = parseLogLevelEnv(env.BYSPACE_LOG_FILE_LEVEL);
  const filePath = nonEmptyEnv(env.BYSPACE_LOG_FILE_PATH);
  const maxSize = nonEmptyEnv(env.BYSPACE_LOG_FILE_ROTATE_SIZE);
  const maxFiles = parsePositiveIntegerEnv(env.BYSPACE_LOG_FILE_ROTATE_COUNT);
  const hasRotateOverride = maxSize !== undefined || maxFiles !== undefined;
  if (level === undefined && filePath === undefined && !hasRotateOverride) return undefined;
  return {
    ...persisted,
    ...(level !== undefined ? { level } : {}),
    ...(filePath !== undefined ? { path: filePath } : {}),
    ...(hasRotateOverride
      ? {
          rotate: {
            ...persisted?.rotate,
            ...(maxSize !== undefined ? { maxSize } : {}),
            ...(maxFiles !== undefined ? { maxFiles } : {}),
          },
        }
      : {}),
  };
}

function parseLogLevelEnv(value: string | undefined): z.infer<typeof LogLevelSchema> | undefined {
  const parsed = LogLevelSchema.safeParse(normalizeLogEnv(value));
  return parsed.success ? parsed.data : undefined;
}

function parseLogFormatEnv(value: string | undefined): z.infer<typeof LogFormatSchema> | undefined {
  const parsed = LogFormatSchema.safeParse(normalizeLogEnv(value));
  return parsed.success ? parsed.data : undefined;
}

function nonEmptyEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parsePositiveIntegerEnv(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
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
  persisted: PersistedConfig;
  cliRelayEnabled: boolean | undefined;
  cliRelayUseTls: boolean | undefined;
  enabledFallback: boolean;
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

function resolveDataRelayTls(
  env: NodeJS.ProcessEnv,
  persistedDataRelay: { useTls?: boolean; publicUseTls?: boolean } | undefined,
) {
  const useTls =
    parseBooleanEnv(env.BYSPACE_DATA_RELAY_USE_TLS) ?? persistedDataRelay?.useTls ?? true;
  const publicUseTls =
    parseBooleanEnv(env.BYSPACE_DATA_RELAY_PUBLIC_USE_TLS) ??
    persistedDataRelay?.publicUseTls ??
    useTls;
  return { useTls, publicUseTls };
}

function resolveDataRelayConfig(env: NodeJS.ProcessEnv, persisted: PersistedConfig) {
  const persistedDataRelay = persisted.daemon?.dataRelay;
  const endpoint = parseDataRelayEndpoint(
    env.BYSPACE_DATA_RELAY_ENDPOINT ?? persistedDataRelay?.endpoint ?? undefined,
    "BYSPACE_DATA_RELAY_ENDPOINT",
  );
  const publicEndpoint = parseDataRelayEndpoint(
    env.BYSPACE_DATA_RELAY_PUBLIC_ENDPOINT ?? persistedDataRelay?.publicEndpoint ?? undefined,
    "BYSPACE_DATA_RELAY_PUBLIC_ENDPOINT",
  );
  const { useTls, publicUseTls } = resolveDataRelayTls(env, persistedDataRelay);
  const listen =
    env.BYSPACE_DATA_RELAY_LISTEN?.trim() || persistedDataRelay?.listen?.trim() || null;
  const accessToken =
    env.BYSPACE_DATA_RELAY_ACCESS_TOKEN?.trim() || persistedDataRelay?.accessToken?.trim() || null;

  return {
    dataRelayListen: listen,
    dataRelayEndpoint: endpoint,
    dataRelayPublicEndpoint: publicEndpoint ?? endpoint,
    dataRelayUseTls: useTls,
    dataRelayPublicUseTls: publicUseTls,
    dataRelayAccessToken: accessToken,
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
    input.enabledFallback;
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
  persisted: PersistedConfig,
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
  persisted: PersistedConfig,
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
  persisted: PersistedConfig,
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
  persisted: PersistedConfig,
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
  persisted: PersistedConfig,
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
  persisted: PersistedConfig,
): BySpaceDaemonConfig["auth"] {
  const envPassword = env.BYSPACE_PASSWORD?.trim();
  if (envPassword) {
    return { password: hashDaemonPassword(envPassword) };
  }
  return persisted.daemon?.auth?.password
    ? { password: persisted.daemon.auth.password }
    : undefined;
}

function resolveWorktreesRoot(byspaceHome: string, persisted: PersistedConfig): string | undefined {
  const configuredRoot = persisted.worktrees?.root?.trim();
  if (!configuredRoot) {
    return undefined;
  }

  const expandedRoot = expandTilde(configuredRoot);
  return path.isAbsolute(expandedRoot)
    ? path.resolve(expandedRoot)
    : path.resolve(byspaceHome, expandedRoot);
}

function resolveAppendSystemPrompt(persisted: PersistedConfig): string {
  return persisted.daemon?.appendSystemPrompt ?? "";
}

function resolveProviderCatalogRefreshTimeout(persisted: PersistedConfig): number | undefined {
  return persisted.agents?.catalogRefreshTimeoutMs;
}

/** Preserve undefined so an explicit empty profile list keeps its meaning. */
function resolveProfileLists(persisted: PersistedConfig) {
  return {
    terminalProfiles: persisted.daemon?.terminalProfiles,
    agentProfiles: persisted.daemon?.agentProfiles,
  };
}

function resolveStaticLoadConfigSettings(
  env: NodeJS.ProcessEnv,
  cli: CliConfigOverrides | undefined,
  persisted: PersistedConfig,
  hostedRelease: BySpaceHostedRelease,
) {
  return {
    mcpEnabled: cli?.mcpEnabled ?? persisted.daemon?.mcp?.enabled ?? true,
    mcpInjectIntoAgents:
      cli?.mcpInjectIntoAgents ?? persisted.daemon?.mcp?.injectIntoAgents ?? false,
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

export interface ResolveConfigFromPersistedOptions {
  env?: NodeJS.ProcessEnv;
  cli?: CliConfigOverrides;
  releaseVersion?: string;
  relayEnabledFallback?: boolean;
}

function resolveStaticDaemonSettings(persisted: PersistedConfig, env: NodeJS.ProcessEnv) {
  return {
    browserToolsEnabled: persisted.daemon?.browserTools?.enabled ?? false,
    git: resolveGitProcessPolicy({ env, persisted: persisted.daemon?.git }),
    autoArchiveAfterMerge: persisted.daemon?.autoArchiveAfterMerge ?? false,
    enableTerminalAgentHooks: persisted.daemon?.enableTerminalAgentHooks ?? false,
    terminalAgentHooks: persisted.daemon?.terminalAgentHooks,
    appendSystemPrompt: resolveAppendSystemPrompt(persisted),
    pluginsEnabled: Boolean(persisted.pluginsEnabled),
    plugins: persisted.plugins,
    mcpDebug: env.MCP_DEBUG === "1",
    isDev: resolveBySpaceNodeEnv(env) === "development",
  };
}

export function resolveConfigFromPersisted(
  byspaceHome: string,
  persisted: PersistedConfig,
  options?: ResolveConfigFromPersistedOptions,
): BySpaceDaemonConfig {
  const resolvedOptions = options ?? {};
  const env = resolvedOptions.env ?? process.env;
  const cli = resolvedOptions.cli;
  const daemonVersion = resolvedOptions.releaseVersion ?? resolveDaemonVersion();
  const hostedRelease = resolveBySpaceHostedRelease(daemonVersion);
  const relayEnabledFallback =
    resolvedOptions.relayEnabledFallback ?? persisted.daemon?.relay?.enabled === undefined;

  const listen = resolveListenAddress(env, cli, persisted);
  const {
    mcpEnabled,
    mcpInjectIntoAgents,
    terminalProfiles,
    agentProfiles,
    hostnames,
    trustedProxies,
    appBaseUrl,
  } = resolveStaticLoadConfigSettings(env, cli, persisted, hostedRelease);
  const staticSettings = resolveStaticDaemonSettings(persisted, env);

  const relay = resolveRelayConfig({
    env,
    persisted,
    cliRelayEnabled: cli?.relayEnabled,
    cliRelayUseTls: cli?.relayUseTls,
    enabledFallback: relayEnabledFallback,
    hostedRelease,
  });
  const serviceProxy = resolveServiceProxyConfig(env, persisted);
  const dataRelay = resolveDataRelayConfig(env, persisted);
  const webUi = resolveWebUiConfig(byspaceHome, env, cli, persisted);

  const speech = resolveSpeechConfig({
    byspaceHome,
    env,
    persisted,
  });

  const providerOverrides = extractProviderOverrides(
    persisted.agents?.providers as Record<string, unknown> | undefined,
  );

  const overrideControlledPaths = resolveOverrideControlledPaths(env, cli);

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
    mcpInjectIntoAgents,
    ...staticSettings,
    terminalProfiles,
    agentProfiles,
    skillSelection: persisted.agents?.skills?.selection,
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
    configReload: {
      env: { ...env },
      cli: cli ? { ...cli } : undefined,
      overrideControlledPaths,
      relayEnabledFallback,
      startupPersisted: persisted,
    },
  };
}

export function loadConfig(
  byspaceHome: string,
  options?: Omit<ResolveConfigFromPersistedOptions, "relayEnabledFallback">,
): BySpaceDaemonConfig {
  const persisted = loadPersistedConfig(byspaceHome);
  return resolveConfigFromPersisted(byspaceHome, persisted, options);
}

export function resolveOverrideControlledPaths(
  env: NodeJS.ProcessEnv,
  cli: CliConfigOverrides | undefined,
): string[] {
  return Array.from(
    new Set([
      ...resolveDaemonOverrideControlledPaths(env, cli),
      ...resolveLogOverrideControlledPaths(env),
      ...resolveSpeechOverrideControlledPaths(env),
    ]),
  ).sort();
}

function resolveDaemonOverrideControlledPaths(
  env: NodeJS.ProcessEnv,
  cli: CliConfigOverrides | undefined,
): string[] {
  return [
    ...resolveCoreDaemonOverridePaths(env, cli),
    ...resolveRelayOverridePaths(env, cli),
    ...resolveDataRelayOverridePaths(env),
    ...resolveServiceAndWebUiOverridePaths(env, cli),
    ...resolveAgentOverridePaths(env),
  ];
}

function resolveCoreDaemonOverridePaths(
  env: NodeJS.ProcessEnv,
  cli: CliConfigOverrides | undefined,
): string[] {
  const paths: string[] = [];
  if (cli?.listen !== undefined || env.BYSPACE_LISTEN !== undefined) {
    paths.push("daemon.listen");
  }
  if (cli?.mcpEnabled !== undefined) paths.push("daemon.mcp.enabled");
  if (cli?.mcpInjectIntoAgents !== undefined) paths.push("daemon.mcp.injectIntoAgents");
  // Hostname sources append instead of replacing one another, so a launch value
  // does not prevent a persisted hostname edit from taking effect.
  if (parseTrustedProxiesEnv(env.BYSPACE_TRUSTED_PROXIES) !== undefined) {
    paths.push("daemon.trustedProxies");
  }
  if (parsePositiveIntegerEnv(env.BYSPACE_GIT_MAX_PROCESSES_PER_SECOND)) {
    paths.push("daemon.git.maxProcessesPerSecond");
  }
  if (
    parsePositiveIntegerEnv(env.BYSPACE_GIT_MAX_PROCESS_CONCURRENCY ?? env.BYSPACE_GIT_CONCURRENCY)
  ) {
    paths.push("daemon.git.maxProcessConcurrency");
  }
  if (env.BYSPACE_APP_BASE_URL !== undefined) paths.push("app.baseUrl");
  if (env.BYSPACE_PASSWORD?.trim()) paths.push("daemon.auth.password");
  return paths;
}

function resolveRelayOverridePaths(
  env: NodeJS.ProcessEnv,
  cli: CliConfigOverrides | undefined,
): string[] {
  const paths: string[] = [];
  if (cli?.relayEnabled !== undefined || parseBooleanEnv(env.BYSPACE_RELAY_ENABLED) !== undefined) {
    paths.push("daemon.relay.enabled");
  }
  if (env.BYSPACE_RELAY_ENDPOINT !== undefined) paths.push("daemon.relay.endpoint");
  if (env.BYSPACE_RELAY_PUBLIC_ENDPOINT !== undefined) {
    paths.push("daemon.relay.publicEndpoint");
  }
  if (cli?.relayUseTls !== undefined || env.BYSPACE_RELAY_USE_TLS !== undefined) {
    paths.push("daemon.relay.useTls");
  }
  if (env.BYSPACE_RELAY_PUBLIC_USE_TLS !== undefined) {
    paths.push("daemon.relay.publicUseTls");
  }
  return paths;
}

function resolveDataRelayOverridePaths(env: NodeJS.ProcessEnv): string[] {
  const paths: string[] = [];
  if (env.BYSPACE_DATA_RELAY_LISTEN !== undefined) paths.push("daemon.dataRelay.listen");
  if (env.BYSPACE_DATA_RELAY_ENDPOINT !== undefined) paths.push("daemon.dataRelay.endpoint");
  if (env.BYSPACE_DATA_RELAY_PUBLIC_ENDPOINT !== undefined) {
    paths.push("daemon.dataRelay.publicEndpoint");
  }
  if (env.BYSPACE_DATA_RELAY_USE_TLS !== undefined) paths.push("daemon.dataRelay.useTls");
  if (env.BYSPACE_DATA_RELAY_PUBLIC_USE_TLS !== undefined) {
    paths.push("daemon.dataRelay.publicUseTls");
  }
  if (env.BYSPACE_DATA_RELAY_ACCESS_TOKEN !== undefined) {
    paths.push("daemon.dataRelay.accessToken");
  }
  return paths;
}

function resolveServiceAndWebUiOverridePaths(
  env: NodeJS.ProcessEnv,
  cli: CliConfigOverrides | undefined,
): string[] {
  const paths: string[] = [];
  const serviceProxyEnabled = parseBooleanEnv(env.BYSPACE_SERVICE_PROXY_ENABLED);
  if (serviceProxyEnabled !== undefined) paths.push("daemon.serviceProxy.enabled");
  if (env.BYSPACE_SERVICE_PROXY_LISTEN !== undefined || serviceProxyEnabled === false) {
    paths.push("daemon.serviceProxy.listen");
  }
  if (env.BYSPACE_SERVICE_PROXY_PUBLIC_BASE_URL !== undefined || serviceProxyEnabled === false) {
    paths.push("daemon.serviceProxy.publicBaseUrl");
  }

  if (
    cli?.webUiEnabled !== undefined ||
    parseBooleanEnv(env.BYSPACE_WEB_UI_ENABLED) !== undefined
  ) {
    paths.push("features.webUi.enabled");
  }
  if (env.BYSPACE_WEB_UI_DIST_DIR !== undefined) paths.push("features.webUi.distDir");
  return paths;
}

function resolveAgentOverridePaths(env: NodeJS.ProcessEnv): string[] {
  const paths: string[] = [];
  if (env.BYSPACE_PROVIDER_REFRESH_TIMEOUT_MS !== undefined) {
    paths.push("agents.catalogRefreshTimeoutMs");
  }
  return paths;
}

function resolveLogOverrideControlledPaths(env: NodeJS.ProcessEnv): string[] {
  const paths: string[] = [];
  if (parseLogLevelEnv(env.BYSPACE_LOG_LEVEL ?? env.BYSPACE_LOG) !== undefined) {
    paths.push("log.level");
  }
  if (parseLogFormatEnv(env.BYSPACE_LOG_FORMAT) !== undefined) paths.push("log.format");
  if (parseLogLevelEnv(env.BYSPACE_LOG_CONSOLE_LEVEL) !== undefined) {
    paths.push("log.console.level");
  }
  if (parseLogFormatEnv(env.BYSPACE_LOG_CONSOLE_FORMAT) !== undefined) {
    paths.push("log.console.format");
  }
  if (parseLogLevelEnv(env.BYSPACE_LOG_FILE_LEVEL) !== undefined) paths.push("log.file.level");
  if (nonEmptyEnv(env.BYSPACE_LOG_FILE_PATH) !== undefined) paths.push("log.file.path");
  if (nonEmptyEnv(env.BYSPACE_LOG_FILE_ROTATE_SIZE) !== undefined) {
    paths.push("log.file.rotate.maxSize");
  }
  if (parsePositiveIntegerEnv(env.BYSPACE_LOG_FILE_ROTATE_COUNT) !== undefined) {
    paths.push("log.file.rotate.maxFiles");
  }
  return paths;
}

function resolveSpeechOverrideControlledPaths(env: NodeJS.ProcessEnv): string[] {
  const paths: string[] = [];
  if (env.BYSPACE_DICTATION_ENABLED !== undefined) paths.push("features.dictation.enabled");
  if (env.BYSPACE_DICTATION_LOCAL_STT_MODEL !== undefined)
    paths.push("features.dictation.stt.model");
  if (env.BYSPACE_LOCAL_MODELS_DIR !== undefined) paths.push("providers.local.modelsDir");
  return paths;
}
