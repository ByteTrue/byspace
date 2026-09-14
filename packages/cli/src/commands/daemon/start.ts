import { setTimeout as sleep } from "node:timers/promises";
import { Command, Option } from "commander";
import chalk from "chalk";
import {
  startLocalDaemonForeground,
  startLocalDaemonDetached,
  resolveLocalDaemonState,
  type DaemonStartOptions as StartOptions,
} from "./local-daemon.js";
import { getErrorMessage } from "../../utils/errors.js";

const PID_FILE_POLL_ATTEMPTS = 50;
const PID_FILE_POLL_INTERVAL_MS = 100;

interface ResolvedDaemonEndpoints {
  webUiUrl: string | null;
  relayEnabled: boolean;
}

/** Web UI is enabled by default since 0.14.0; the pid file's listen target is authoritative. */
async function resolveDaemonEndpoints(options: StartOptions): Promise<ResolvedDaemonEndpoints> {
  const webUiEnabled = options.webUi !== false;
  for (let attempt = 0; attempt < PID_FILE_POLL_ATTEMPTS; attempt++) {
    try {
      const state = resolveLocalDaemonState({ home: options.home });
      const listen = state.listen;
      // The start command passes relay as an env override to the daemon, while
      // resolveLocalDaemonState reports only persisted config; merge the two.
      const relayEnabled = options.relay ?? state.relayEnabled;
      let webUiUrl: string | null = null;
      if (webUiEnabled) {
        const match = /^\[?([^:]+)]?:(\d+)$/.exec(listen);
        if (match) {
          const host = match[1] === "0.0.0.0" ? "127.0.0.1" : match[1];
          webUiUrl = `http://${host}:${match[2]}`;
        } else if (/^\d+$/.test(listen)) {
          webUiUrl = `http://127.0.0.1:${listen}`;
        }
      }
      return { webUiUrl, relayEnabled };
    } catch {
      // daemon still writing the pid file
    }
    await sleep(PID_FILE_POLL_INTERVAL_MS);
  }
  return { webUiUrl: null, relayEnabled: false };
}

export type { DaemonStartOptions as StartOptions } from "./local-daemon.js";

type RawStartCommandOptions = StartOptions & {
  allowedHosts?: string;
};

export function startCommand(): Command {
  return new Command("start")
    .description("Start the local BySpace daemon")
    .option("--listen <listen>", "Listen target (host:port, port, or unix socket path)")
    .option("--port <port>", "Port to listen on (default: 6777)")
    .option("--home <path>", "BySpace home directory (default: ~/.byspace)")
    .option("--foreground", "Run in foreground (don't daemonize)")
    .option("--relay", "Enable relay connection")
    .option("--no-relay", "Disable relay connection")
    .option("--relay-use-tls", "Use wss:// for the relay connection and pairing offers")
    .option("--no-mcp", "Disable the Agent MCP HTTP endpoint")
    .option("--no-inject-mcp", "Disable auto-injecting the BySpace MCP into created agents")
    .option("--web-ui", "Enable the bundled daemon web UI")
    .option("--no-web-ui", "Disable the bundled daemon web UI")
    .option(
      "--hostnames <hosts>",
      'Daemon hostnames (comma-separated, e.g. "myhost,.example.com" or "true" for any)',
    )
    .addOption(new Option("--allowed-hosts <hosts>").hideHelp())
    .action(async (options: RawStartCommandOptions) => {
      await runStart({
        ...options,
        hostnames: options.hostnames ?? options.allowedHosts,
      });
    });
}

export async function runStart(options: StartOptions): Promise<void> {
  if (options.listen && options.port) {
    console.error(chalk.red("Cannot use --listen and --port together"));
    process.exit(1);
  }

  if (!options.foreground) {
    try {
      const startup = await startLocalDaemonDetached(options);
      console.log(chalk.green(`Daemon starting in background (PID ${startup.pid ?? "unknown"}).`));
      const { webUiUrl, relayEnabled } = await resolveDaemonEndpoints(options);
      if (webUiUrl) {
        console.log(chalk.cyan(`Web UI: ${webUiUrl}`));
      }
      if (relayEnabled) {
        console.log(chalk.cyan("Online web: https://app.byspace.cc.cd (pair a device to connect)"));
      }
      console.log(chalk.dim(`Logs: ${startup.logPath}`));
    } catch (err) {
      exitWithError(getErrorMessage(err));
    }
    return;
  }
  try {
    const status = startLocalDaemonForeground(options);
    process.exit(status);
  } catch (err) {
    const message = getErrorMessage(err);
    exitWithError(`Failed to start daemon: ${message}`);
  }
}

function exitWithError(message: string): never {
  console.error(chalk.red(message));
  process.exit(1);
}
