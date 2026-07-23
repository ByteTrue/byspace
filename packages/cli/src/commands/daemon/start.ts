import { Command, Option } from "commander";
import chalk from "chalk";
import {
  startLocalDaemonForeground,
  startLocalDaemonDetached,
  type DaemonStartOptions as StartOptions,
} from "./local-daemon.js";
import { getErrorMessage } from "../../utils/errors.js";

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
    .option("--no-relay", "Disable relay connection")
    .option("--relay-use-tls", "Use wss:// for the relay connection and pairing offers")
    .option("--no-mcp", "Disable the Agent MCP HTTP endpoint")
    .option("--no-inject-mcp", "Disable auto-injecting the BySpace MCP into created agents")
    .option("--web-ui", "Enable the bundled daemon web UI (default)")
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
      console.log(chalk.dim(`Logs: ${startup.logPath}`));
      console.log();
      if (startup.webUiUrl) {
        console.log(chalk.green("Local Web UI is running."));
        console.log("Open BySpace using either:");
        console.log(`  ${chalk.bold("Local:")}  ${chalk.cyan(startup.webUiUrl)}`);
        console.log(`  ${chalk.bold("Hosted:")} ${chalk.cyan(startup.hostedWebUrl)}`);
      } else {
        console.log(`${chalk.bold("Hosted Web:")} ${chalk.cyan(startup.hostedWebUrl)}`);
      }
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
