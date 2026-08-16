import { Command } from "commander";
import type { DaemonClient } from "@bytetrue/byspace-client/internal/daemon-client";
import {
  parseConnectionOfferFromUrl,
  type ConnectionOfferV2,
} from "@bytetrue/byspace-protocol/connection-offer";
import {
  render,
  renderError,
  toCommandError,
  type CommandError,
  type CommandOptions,
  type OutputSchema,
} from "../output/index.js";
import { connectToDaemon } from "../utils/client.js";

export interface TunnelOptions extends CommandOptions {
  localPort?: string;
}

interface TunnelReadyOutput {
  forwardId: string;
  localHost: string;
  localPort: number;
  targetServerId: string;
  targetPort: number;
}

const tunnelReadyOutputSchema: OutputSchema<TunnelReadyOutput> = {
  idField: "forwardId",
  columns: [],
};

interface TunnelClient {
  getLastServerInfoMessage(): ReturnType<DaemonClient["getLastServerInfoMessage"]>;
  openRemoteTcpForward: DaemonClient["openRemoteTcpForward"];
  closeRemoteTcpForward: DaemonClient["closeRemoteTcpForward"];
  subscribeConnectionStatus: DaemonClient["subscribeConnectionStatus"];
  close(): Promise<void>;
}

interface TunnelCommandDependencies {
  connect(options: { host?: string }): Promise<TunnelClient>;
  parseOffer(input: string): ConnectionOfferV2 | null;
  waitForStop(client: TunnelClient): Promise<void>;
  writeStdout(message: string): void;
}

const defaultDependencies: TunnelCommandDependencies = {
  connect: (options) => connectToDaemon(options),
  parseOffer: parseConnectionOfferFromUrl,
  waitForStop: waitForTerminationSignal,
  writeStdout: (message) => process.stdout.write(message),
};

export function addTunnelOptions(command: Command): Command {
  return command
    .description("Forward a local TCP port to another BySpace daemon")
    .argument("<pairing-url>", "Pairing URL for the target daemon")
    .argument("<port>", "Target localhost TCP port")
    .option(
      "--local-port <port>",
      "Local listener port (default: target port, then any free port)",
    );
}

function parsePort(raw: string, option: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw {
      code: "INVALID_PORT",
      message: `${option} must be an integer from 1 to 65535`,
    } satisfies CommandError;
  }
  return value;
}

function parseTarget(
  input: string,
  parseOffer: TunnelCommandDependencies["parseOffer"],
): ConnectionOfferV2 {
  try {
    const offer = parseOffer(input);
    if (offer) {
      return offer;
    }
  } catch {
    // Report one stable CLI error below.
  }
  throw {
    code: "INVALID_PAIRING_URL",
    message: "The target must be a valid BySpace pairing URL",
  } satisfies CommandError;
}

function waitForTerminationSignal(client: TunnelClient): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const finish = (error?: CommandError) => {
      if (settled) return;
      settled = true;
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      unsubscribe();
      if (error) reject(error);
      else resolve();
    };
    const onSignal = () => finish();
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    unsubscribe = client.subscribeConnectionStatus((state) => {
      if (state.status === "disconnected" || state.status === "disposed") {
        finish({
          code: "DAEMON_DISCONNECTED",
          message: "The local BySpace daemon connection closed; the TCP forward stopped",
        });
      }
    });
    if (settled) unsubscribe();
  });
}

export async function handleTunnelCommand(
  pairingUrl: string,
  rawTargetPort: string,
  _options: TunnelOptions,
  command: Command,
): Promise<void> {
  const options = command.optsWithGlobals() as TunnelOptions;
  try {
    await runTunnelCommand(pairingUrl, rawTargetPort, options, command);
  } catch (error) {
    const format = options.json ? "json" : options.format;
    process.stderr.write(
      `${renderError(toCommandError(error), {
        ...(format === "json" || format === "yaml" ? { format } : { format: "table" }),
        noColor: options.noColor,
      })}\n`,
    );
    process.exitCode = 1;
  }
}

export async function runTunnelCommand(
  pairingUrl: string,
  rawTargetPort: string,
  options: TunnelOptions,
  _command: Command,
  dependencyOverrides: Partial<TunnelCommandDependencies> = {},
): Promise<void> {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const target = parseTarget(pairingUrl, dependencies.parseOffer);
  const targetPort = parsePort(rawTargetPort, "port");
  const localPort =
    options.localPort === undefined ? undefined : parsePort(options.localPort, "--local-port");

  const client = await dependencies.connect({ host: options.host });
  let forwardId: string | null = null;
  try {
    if (client.getLastServerInfoMessage()?.features?.remoteTcpForward !== true) {
      throw {
        code: "REMOTE_TCP_FORWARD_UNAVAILABLE",
        message: "Update the local BySpace daemon to use TCP forwarding",
      } satisfies CommandError;
    }

    const forward = await client.openRemoteTcpForward({
      target,
      targetPort,
      ...(localPort === undefined ? {} : { localPort }),
    });
    forwardId = forward.forwardId;

    const ready: TunnelReadyOutput = {
      forwardId: forward.forwardId,
      localHost: forward.localHost,
      localPort: forward.localPort,
      targetServerId: target.serverId,
      targetPort: forward.targetPort,
    };
    const structuredFormat = options.json ? "json" : options.format;
    if (structuredFormat === "json" || structuredFormat === "yaml") {
      dependencies.writeStdout(
        `${render(
          { type: "single", data: ready, schema: tunnelReadyOutputSchema },
          { format: structuredFormat },
        ).trimEnd()}\n`,
      );
    } else {
      dependencies.writeStdout(
        `${forward.localHost}:${forward.localPort} -> ${target.serverId}:127.0.0.1:${forward.targetPort}\n`,
      );
      dependencies.writeStdout("Press Ctrl-C to stop.\n");
    }

    await dependencies.waitForStop(client);
  } finally {
    if (forwardId) {
      await client.closeRemoteTcpForward(forwardId).catch(() => undefined);
    }
    await client.close().catch(() => undefined);
  }
}
