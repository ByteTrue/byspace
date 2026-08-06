import { cancel, intro, log, note, outro, spinner } from "@clack/prompts";
import { Command, Option } from "commander";
import path from "node:path";
import {
  generateLocalPairingOffer,
  loadConfig,
  type CliConfigOverrides,
} from "@bytetrue/byspace-server";
import { resolveBySpaceHostedRelease } from "@bytetrue/byspace-protocol/release-channel";
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
import { resolveCliVersion } from "../version.js";

interface OnboardOptions extends DaemonStartOptions {
  timeout?: string;
}

type RawOnboardOptions = OnboardOptions & {
  allowedHosts?: string;
};

const DEFAULT_READY_TIMEOUT_MS = 10 * 60 * 1000;
const READY_PROBE_TIMEOUT_MS = 1200;
const CURRENT_RELEASE_APP_BASE_URL = resolveBySpaceHostedRelease(resolveCliVersion()).appBaseUrl;

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

function toCliOverrides(options: OnboardOptions): CliConfigOverrides {
  const cliOverrides: CliConfigOverrides = {};

  if (options.listen) {
    cliOverrides.listen = options.listen;
  } else if (options.port) {
    cliOverrides.listen = `127.0.0.1:${options.port}`;
  }

  if (options.relay === false) {
    cliOverrides.relayEnabled = false;
  }

  if (options.hostnames) {
    const raw = options.hostnames.trim();
    cliOverrides.hostnames =
      raw.toLowerCase() === "true"
        ? true
        : raw
            .split(",")
            .map((host) => host.trim())
            .filter(Boolean);
  }

  if (options.mcp === false) {
    cliOverrides.mcpEnabled = false;
  }

  return cliOverrides;
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

  args.onStatus?.("Waiting for daemon to become ready...");

  async function poll(): Promise<{ listen: string; host: string | null }> {
    if (Date.now() >= deadline) throw createTimeoutError();
    const probe = await probeDaemonReady(args.home, Math.max(1, deadline - Date.now()));
    if (probe.kind === "ready") return { listen: probe.listen, host: probe.host };
    await sleep(200);
    return poll();
  }

  return poll();
}

function printNextSteps(
  pairingUrl: string | null,
  byspaceHome: string,
  appBaseUrl: string,
  richUi: boolean,
): void {
  const daemonLogPath = path.join(byspaceHome, "daemon.log");
  const nextStepsLines = [
    pairingUrl
      ? "1. Open the pairing link above in BySpace."
      : "1. Open BySpace and connect to your daemon.",
    `2. Web app: ${appBaseUrl}`,
    `3. Docs: ${appBaseUrl}/docs`,
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
    .option("--no-relay", "Disable relay connection")
    .option("--no-mcp", "Disable the Agent MCP HTTP endpoint")
    .option(
      "--hostnames <hosts>",
      'Daemon hostnames (comma-separated, e.g. "myhost,.example.com" or "true" for any)',
    )
    .addOption(new Option("--allowed-hosts <hosts>").hideHelp())
    .option("--timeout <seconds>", "Max time to wait for daemon readiness (default: 600)")
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

  const config = loadConfig(byspaceHome, { cli: toCliOverrides(options) });

  await ensureDaemonStarted(options, richUi);
  await waitForDaemonReadyWithUi({
    home: options.home ?? byspaceHome,
    timeoutMs,
    richUi,
  });

  if (config.relayEnabled === false) {
    log.warn("Relay is disabled; pairing offer is unavailable for this daemon.");
    printNextSteps(null, byspaceHome, config.appBaseUrl ?? CURRENT_RELEASE_APP_BASE_URL, richUi);
    if (richUi) {
      outro("BySpace daemon is running.");
    }
    return;
  }

  const pairing = await generateLocalPairingOffer({
    byspaceHome,
    relayEnabled: config.relayEnabled,
    relayEndpoint: config.relayEndpoint,
    relayPublicEndpoint: config.relayPublicEndpoint,
    relayUseTls: config.relayUseTls,
    relayPublicUseTls: config.relayPublicUseTls,
    appBaseUrl: config.appBaseUrl,
    includeQr: true,
  });

  if (!pairing.url) {
    log.warn("Relay pairing URL is unavailable for this daemon configuration.");
    printNextSteps(null, byspaceHome, config.appBaseUrl ?? CURRENT_RELEASE_APP_BASE_URL, richUi);
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
  printNextSteps(
    pairing.url,
    byspaceHome,
    config.appBaseUrl ?? CURRENT_RELEASE_APP_BASE_URL,
    richUi,
  );
  if (richUi) {
    outro("BySpace is ready!");
  }
}
