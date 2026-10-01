import { cancel, intro, log, note, outro, spinner } from "@clack/prompts";
import { Command, Option } from "commander";
import path from "node:path";
import type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@bytetrue/protocol/messages";
import { resolveBySpaceHostedAppBaseUrl } from "@bytetrue/protocol/release-channel";
import { getOrCreateServerId } from "@bytetrue/server";
import {
  resolveLocalBySpaceHome,
  resolveLocalDaemonState,
  resolveTcpHostFromListen,
  startLocalDaemonDetached,
  tailDaemonLog,
  type DaemonStartOptions,
} from "./daemon/local-daemon.js";
import { tryConnectToDaemon } from "../utils/client.js";
import { formatPairingInstructions } from "../output/pairing.js";
import {
  confirmRelayPairing,
  printDirectConnectionGuidance,
  resolveLocalPairingOffer,
} from "./daemon/pair.js";
import { resolveCliVersion } from "../version.js";

interface OnboardOptions extends DaemonStartOptions {
  timeout?: string;
  webOrigin?: string;
  relayEndpoint?: string;
}

type RawOnboardOptions = OnboardOptions & {
  allowedHosts?: string;
};

const DEFAULT_READY_TIMEOUT_MS = 10 * 60 * 1000;
const READY_PROBE_TIMEOUT_MS = 1200;

const plainNoteFormat = (line: string): string => line;

function renderNote(message: string, title: string): void {
  note(message, title, { format: plainNoteFormat });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseTimeoutMs(raw: string | undefined): number {
  if (!raw || raw.trim().length === 0) {
    return DEFAULT_READY_TIMEOUT_MS;
  }

  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`Invalid timeout value: ${raw}`);
  }

  return Math.ceil(seconds * 1000);
}

export interface WebOriginTarget {
  baseUrl: string;
  corsOrigin: string;
}

export function parseWebOrigin(raw: string): WebOriginTarget {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid --web-origin value: ${raw} (expected an http:// or https:// URL)`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `Invalid --web-origin value: ${raw} (only http:// and https:// URLs are supported)`,
    );
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  return {
    baseUrl: url.origin + pathname,
    corsOrigin: url.origin,
  };
}

export function buildWebOriginPatch(
  target: WebOriginTarget,
  config: Pick<MutableDaemonConfig, "app" | "cors"> | null | undefined,
): MutableDaemonConfigPatch | null {
  const baseUrlMatches = config?.app?.baseUrl === target.baseUrl;
  const originAllowed = config?.cors?.allowedOrigins?.includes(target.corsOrigin) === true;
  if (baseUrlMatches && originAllowed) {
    return null;
  }
  return {
    app: { baseUrl: target.baseUrl },
    // The daemon replaces the allowedOrigins array wholesale, so the patch
    // must carry the full merged list.
    ...(originAllowed
      ? {}
      : { cors: { allowedOrigins: [...(config?.cors?.allowedOrigins ?? []), target.corsOrigin] } }),
  };
}

export interface RelayEndpointTarget {
  endpoint: string;
  useTls: boolean;
}

/**
 * --relay-endpoint implies relay: the user is pointing the daemon at their
 * own relay, so the enable-relay prompt and the hosted default are moot.
 * Rejects the contradictory --no-relay combination.
 */
function resolveRelayEnabled(options: OnboardOptions): boolean | undefined {
  if (options.relayEndpoint === undefined) {
    return options.relay;
  }
  if (options.relay === false) {
    cancel("Cannot use --no-relay together with --relay-endpoint");
    process.exit(1);
  }
  return true;
}

function defaultRelayPort(scheme: string | null): number {
  return scheme === "ws" || scheme === "http" ? 80 : 443;
}

/**
 * Parses --relay-endpoint. Accepts host[:port] or ws(s)://host[:port];
 * the scheme implies useTls, and a missing port defaults to 443 (TLS) or 80.
 */
export function parseRelayEndpoint(raw: string): RelayEndpointTarget {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Invalid --relay-endpoint value: endpoint is required");
  }
  let scheme: string | null = null;
  let hostPort = trimmed;
  const schemeMatch = trimmed.match(/^(wss|ws|https|http):\/\/(.+)$/);
  if (schemeMatch) {
    scheme = schemeMatch[1];
    hostPort = schemeMatch[2].replace(/\/+$/, "");
  }
  let host: string;
  let port: number;
  if (/^\[[^\]]+\]/.test(hostPort)) {
    // IPv6 literal: brackets required when a port is present.
    const match = hostPort.match(/^\[([^\]]+)\](?::(\d{1,5}))?$/);
    if (!match) {
      throw new Error(`Invalid --relay-endpoint value: ${raw} (expected [host]:port)`);
    }
    host = `[${match[1]}]`;
    port = match[2] ? Number(match[2]) : defaultRelayPort(scheme);
  } else {
    const colonIndex = hostPort.lastIndexOf(":");
    if (colonIndex === -1) {
      host = hostPort;
      port = defaultRelayPort(scheme);
    } else {
      host = hostPort.slice(0, colonIndex);
      port = Number(hostPort.slice(colonIndex + 1));
    }
  }
  if (host.includes(":") && !host.startsWith("[")) {
    throw new Error(
      `Invalid --relay-endpoint value: ${raw} (wrap IPv6 hosts in brackets, e.g. [::1]:8081)`,
    );
  }
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid --relay-endpoint value: ${raw} (expected host[:port] or ws(s)://host[:port])`,
    );
  }
  const useTls = scheme ? scheme === "wss" || scheme === "https" : port === 443;
  return {
    endpoint: host.includes(":") && !host.startsWith("[") ? `[${host}]:${port}` : `${host}:${port}`,
    useTls,
  };
}

export function buildRelayEndpointPatch(
  target: RelayEndpointTarget,
  config: Pick<MutableDaemonConfig, "relay"> | null | undefined,
): MutableDaemonConfigPatch | null {
  const endpointMatches = config?.relay?.endpoint === target.endpoint;
  const useTlsMatches = config?.relay?.useTls === target.useTls;
  if (endpointMatches && useTlsMatches) {
    return null;
  }
  return {
    relay: {
      ...(endpointMatches ? {} : { endpoint: target.endpoint }),
      ...(useTlsMatches ? {} : { useTls: target.useTls }),
    },
  };
}

const WEB_ORIGIN_RPC_TIMEOUT_MS = 1500;

/**
 * Parses --web-origin and applies it to the daemon. Exits the process on
 * invalid input or daemon errors, mirroring the other onboard failure paths.
 * Returns null when --web-origin was not provided.
 */
async function configureWebOrigin(args: {
  rawWebOrigin: string | undefined;
  listen: string;
  byspaceHome: string;
}): Promise<WebOriginTarget | null> {
  if (!args.rawWebOrigin) {
    return null;
  }
  let target: WebOriginTarget;
  try {
    target = parseWebOrigin(args.rawWebOrigin);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    cancel(message);
    process.exit(1);
  }
  try {
    await applyWebOrigin({ listen: args.listen, byspaceHome: args.byspaceHome, target });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(message);
    process.exit(1);
  }
  return target;
}

async function applyWebOrigin(args: {
  listen: string;
  byspaceHome: string;
  target: WebOriginTarget;
}): Promise<void> {
  const expectedServerId = getOrCreateServerId(args.byspaceHome);
  const client = await tryConnectToDaemon({
    host: args.listen,
    timeout: WEB_ORIGIN_RPC_TIMEOUT_MS,
  });
  if (!client) {
    throw new Error("Could not connect to the daemon to apply --web-origin.");
  }
  try {
    const serverInfo = client.getLastServerInfoMessage();
    if (serverInfo?.serverId.trim() !== expectedServerId) {
      throw new Error(
        "The reachable daemon belongs to a different BySpace home. Check --home or the daemon listen configuration.",
      );
    }
    const { config } = await client.getDaemonConfig();
    const patch = buildWebOriginPatch(args.target, config);
    if (!patch) {
      log.message(`Web app already configured: ${args.target.baseUrl}`);
      return;
    }
    const result = await client.patchDaemonConfig(patch);
    if (
      result.config.app?.baseUrl !== args.target.baseUrl ||
      result.config.cors?.allowedOrigins?.includes(args.target.corsOrigin) !== true
    ) {
      log.warn(
        "The daemon did not apply the web origin config. Update the daemon and re-run onboard.",
      );
      return;
    }
    log.success(`Web app configured: ${args.target.baseUrl}`);
  } finally {
    await client.close().catch(() => undefined);
  }
}

/**
 * Parses --relay-endpoint and applies it to the daemon. Exits the process on
 * invalid input or daemon errors, mirroring the other onboard failure paths.
 * Returns null when --relay-endpoint was not provided.
 */
async function configureRelayEndpoint(args: {
  rawRelayEndpoint: string | undefined;
  listen: string;
  byspaceHome: string;
}): Promise<RelayEndpointTarget | null> {
  if (!args.rawRelayEndpoint) {
    return null;
  }
  let target: RelayEndpointTarget;
  try {
    target = parseRelayEndpoint(args.rawRelayEndpoint);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    cancel(message);
    process.exit(1);
  }
  try {
    await applyRelayEndpoint({ listen: args.listen, byspaceHome: args.byspaceHome, target });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(message);
    process.exit(1);
  }
  return target;
}

async function applyRelayEndpoint(args: {
  listen: string;
  byspaceHome: string;
  target: RelayEndpointTarget;
}): Promise<void> {
  const expectedServerId = getOrCreateServerId(args.byspaceHome);
  const client = await tryConnectToDaemon({
    host: args.listen,
    timeout: WEB_ORIGIN_RPC_TIMEOUT_MS,
  });
  if (!client) {
    throw new Error("Could not connect to the daemon to apply --relay-endpoint.");
  }
  try {
    const serverInfo = client.getLastServerInfoMessage();
    if (serverInfo?.serverId.trim() !== expectedServerId) {
      throw new Error(
        "The reachable daemon belongs to a different BySpace home. Check --home or the daemon listen configuration.",
      );
    }
    const { config } = await client.getDaemonConfig();
    const patch = buildRelayEndpointPatch(args.target, config);
    if (!patch) {
      log.message(`Relay endpoint already configured: ${args.target.endpoint}`);
      return;
    }
    const result = await client.patchDaemonConfig(patch);
    if (result.config.relay?.endpoint !== args.target.endpoint) {
      log.warn(
        "The daemon did not apply the relay endpoint config. Update the daemon and re-run onboard.",
      );
      return;
    }
    log.success(`Relay endpoint configured: ${args.target.endpoint}`);
  } finally {
    await client.close().catch(() => undefined);
  }
}

type ProbeResult = { kind: "ready"; listen: string; host: string | null } | { kind: "pending" };

async function probeDaemonReady(home: string, timeoutMs: number): Promise<ProbeResult> {
  const state = resolveLocalDaemonState({ home });
  const host = resolveTcpHostFromListen(state.listen);
  const deadline = Date.now() + timeoutMs;
  const remainingTimeoutMs = () => Math.max(1, deadline - Date.now());

  if (state.running && host) {
    const client = await tryConnectToDaemon({
      host,
      timeout: Math.min(remainingTimeoutMs(), READY_PROBE_TIMEOUT_MS),
    });
    if (client) {
      try {
        await client.fetchAgents({
          timeout: Math.min(remainingTimeoutMs(), READY_PROBE_TIMEOUT_MS),
        });
        return { kind: "ready", listen: state.listen, host };
      } catch {
        // Daemon process is alive but not API-ready yet.
      } finally {
        await client.close().catch(() => {});
      }
    }
  } else if (state.running && !host) {
    return { kind: "ready", listen: state.listen, host: null };
  }

  return { kind: "pending" };
}

interface ProgressState {
  lastStatus: string;
  lastPrintedAt: number;
}

function announceProgress(
  state: ProgressState,
  onStatus: ((message: string) => void) | undefined,
): ProgressState {
  const statusMessage = "Waiting for daemon to become ready...";

  if (statusMessage !== state.lastStatus) {
    onStatus?.(statusMessage);
    return { lastStatus: statusMessage, lastPrintedAt: Date.now() };
  }
  if (!onStatus && Date.now() - state.lastPrintedAt >= 3000) {
    console.log(statusMessage);
    return { lastStatus: state.lastStatus, lastPrintedAt: Date.now() };
  }
  return state;
}

async function waitForDaemonReady(args: {
  home: string;
  timeoutMs: number;
  onStatus?: (message: string) => void;
}): Promise<{ listen: string; host: string | null }> {
  const deadline = Date.now() + args.timeoutMs;
  const createTimeoutError = () => {
    const recentLogs = tailDaemonLog(args.home, 60);
    return new Error(
      [
        `Timed out after ${Math.ceil(args.timeoutMs / 1000)}s waiting for daemon readiness.`,
        recentLogs ? `Recent daemon logs:\n${recentLogs}` : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  };

  async function poll(state: ProgressState): Promise<{ listen: string; host: string | null }> {
    if (Date.now() >= deadline) {
      throw createTimeoutError();
    }
    const probe = await probeDaemonReady(args.home, Math.max(1, deadline - Date.now()));
    if (probe.kind === "ready") {
      return { listen: probe.listen, host: probe.host };
    }
    const nextState = announceProgress(state, args.onStatus);
    if (Date.now() >= deadline) {
      throw createTimeoutError();
    }
    await sleep(200);
    return poll(nextState);
  }

  return poll({ lastStatus: "", lastPrintedAt: 0 });
}

function printNextSteps(
  pairingUrl: string | null,
  byspaceHome: string,
  richUi: boolean,
  webBaseUrl: string | null = null,
): void {
  const daemonLogPath = path.join(byspaceHome, "daemon.log");
  const appBaseUrl = webBaseUrl ?? resolveBySpaceHostedAppBaseUrl(resolveCliVersion());
  const nextStepsLines = [
    pairingUrl
      ? "1. Open BySpace and scan the QR code above, or paste the pairing link."
      : "1. Open BySpace and connect to your daemon.",
    `2. Web app: ${appBaseUrl}`,
    "3. Docs: https://github.com/ByteTrue/byspace",
    '4. Example: byspace run --output-schema schema.json "extract fields"',
  ];
  const quickReferenceLines = [
    "1. byspace --help",
    "2. byspace ls",
    '3. byspace run "your prompt"',
    "4. byspace status",
    `5. Daemon logs: ${daemonLogPath}`,
  ];

  if (!richUi) {
    console.log("");
    console.log("Next steps:");
    for (const line of nextStepsLines) {
      console.log(line);
    }
    console.log("");
    console.log("CLI quick reference:");
    for (const line of quickReferenceLines) {
      console.log(line);
    }
    return;
  }

  renderNote(nextStepsLines.join("\n"), "Next steps");
  renderNote(quickReferenceLines.join("\n"), "CLI quick reference");
}

export function onboardCommand(): Command {
  return new Command("onboard")
    .description("Run first-time setup, start daemon, and print pairing instructions")
    .option("--listen <listen>", "Listen target (host:port, port, or unix socket path)")
    .option("--port <port>", "Port to listen on (default: 6777)")
    .option("--home <path>", "BySpace home directory (default: ~/.byspace)")
    .option("--relay", "Enable relay connection without prompting")
    .option("--no-relay", "Disable relay connection")
    .option("--no-mcp", "Disable the Agent MCP HTTP endpoint")
    .option(
      "--hostnames <hosts>",
      'Daemon hostnames (comma-separated, e.g. "myhost,.example.com" or "true" for any)',
    )
    .addOption(new Option("--allowed-hosts <hosts>").hideHelp())
    .option("--timeout <seconds>", "Max time to wait for daemon readiness (default: 600)")
    .option(
      "--web-origin <url>",
      "Self-hosted web app URL (e.g. http://192.168.1.10:8080): allowlists its origin and points pairing links at it",
    )
    .option(
      "--relay-endpoint <endpoint>",
      "Self-hosted relay endpoint (host[:port] or ws(s)://host[:port]): persists it and points pairing links at it",
    )
    .action(async (options: RawOnboardOptions) => {
      await runOnboard({
        ...options,
        hostnames: options.hostnames ?? options.allowedHosts,
      });
    });
}

async function ensureDaemonStarted(options: OnboardOptions, richUi: boolean): Promise<void> {
  const stateBeforeStart = resolveLocalDaemonState({ home: options.home });
  if (stateBeforeStart.running) {
    log.message(`Daemon already running (PID ${stateBeforeStart.pidInfo?.pid ?? "unknown"}).`);
    return;
  }

  const startSpinner = richUi ? spinner() : null;
  try {
    if (startSpinner) {
      startSpinner.start("Starting daemon...");
    } else {
      log.message("Starting daemon...");
    }
    const startup = await startLocalDaemonDetached(options);
    if (startSpinner) {
      startSpinner.stop(`Daemon started (PID ${startup.pid ?? "unknown"})`);
    } else {
      log.message(`Daemon started (PID ${startup.pid ?? "unknown"})`);
    }
    log.message(`Logs: ${startup.logPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (startSpinner) {
      startSpinner.error(message);
    } else {
      log.error(message);
    }
    process.exit(1);
  }
}

async function waitForDaemonReadyWithUi(args: {
  home: string;
  timeoutMs: number;
  richUi: boolean;
}): Promise<{ listen: string; host: string | null }> {
  const readySpinner = args.richUi ? spinner() : null;
  try {
    if (readySpinner) {
      readySpinner.start("Waiting for daemon to become ready...");
    } else {
      log.message("Waiting for daemon to become ready...");
    }
    const readyState = await waitForDaemonReady({
      home: args.home,
      timeoutMs: args.timeoutMs,
      onStatus: readySpinner ? (message) => readySpinner.message(message) : undefined,
    });
    if (readySpinner) {
      readySpinner.stop(`Daemon ready on ${readyState.listen}`);
    } else {
      log.message(`Daemon ready on ${readyState.listen}`);
    }
    return readyState;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (readySpinner) {
      readySpinner.error(message);
    } else {
      log.error(message);
    }
    return process.exit(1);
  }
}

export async function runOnboard(options: OnboardOptions): Promise<void> {
  const richUi = process.stdin.isTTY && process.stdout.isTTY;
  if (richUi) {
    intro("Welcome to BySpace");
  }

  if (options.listen && options.port) {
    cancel("Cannot use --listen and --port together");
    process.exit(1);
  }

  let timeoutMs = DEFAULT_READY_TIMEOUT_MS;
  try {
    timeoutMs = parseTimeoutMs(options.timeout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    cancel(message);
    process.exit(1);
  }

  const byspaceHome = resolveLocalBySpaceHome(options.home);
  if (richUi) {
    renderNote(byspaceHome, "BySpace home");
  }

  await ensureDaemonStarted(options, richUi);
  const readyState = await waitForDaemonReadyWithUi({
    home: options.home ?? byspaceHome,
    timeoutMs,
    richUi,
  });

  const webOriginTarget = await configureWebOrigin({
    rawWebOrigin: options.webOrigin,
    listen: readyState.listen,
    byspaceHome,
  });
  const webBaseUrl = webOriginTarget?.baseUrl ?? null;
  await configureRelayEndpoint({
    rawRelayEndpoint: options.relayEndpoint,
    listen: readyState.listen,
    byspaceHome,
  });

  const relayEnabled = resolveRelayEnabled(options);

  if (relayEnabled === false) {
    log.message("Relay pairing skipped because --no-relay was provided.");
    printNextSteps(null, byspaceHome, richUi, webBaseUrl);
    if (richUi) outro("BySpace daemon is running.");
    return;
  }

  let pairing = await resolveLocalPairingOffer({
    byspaceHome,
    enableRelay: relayEnabled === true,
  });

  if (!pairing.relayEnabled) {
    const shouldEnable = richUi ? await confirmRelayPairing() : false;
    if (!shouldEnable) {
      printDirectConnectionGuidance();
      printNextSteps(null, byspaceHome, richUi, webBaseUrl);
      if (richUi) outro("BySpace daemon is running.");
      return;
    }
    pairing = await resolveLocalPairingOffer({ byspaceHome, enableRelay: true });
    log.success("Relay enabled");
  }

  if (!pairing.url) {
    log.warn("Relay pairing URL is unavailable for this daemon configuration.");
    printNextSteps(null, byspaceHome, richUi, webBaseUrl);
    if (richUi) {
      outro("BySpace daemon is running.");
    }
    return;
  }

  process.stdout.write(
    formatPairingInstructions({
      url: pairing.url,
      qr: pairing.qr,
      columns: process.stdout.columns,
    }),
  );
  printNextSteps(pairing.url, byspaceHome, richUi, webBaseUrl);
  if (richUi) {
    outro("BySpace is ready!");
  }
}
