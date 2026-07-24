import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Command } from "commander";
import {
  buildAgentDeepLinkRoute,
  type AgentDeepLinkTarget,
} from "@bytetrue/byspace-protocol/agent-deep-link";
import { resolveBySpaceHostedRelease } from "@bytetrue/byspace-protocol/release-channel";
import { buildDaemonConnectionCommandError, connectToDaemon } from "../../utils/client.js";
import type {
  CommandError,
  CommandOptions,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";
import { resolveCliVersion } from "../../version.js";

interface OpenAgentResult {
  agentId: string;
  serverId: string;
  url: string;
  status: "opened";
}

const openAgentSchema: OutputSchema<OpenAgentResult> = {
  idField: "agentId",
  columns: [
    { header: "AGENT ID", field: "agentId" },
    { header: "SERVER ID", field: "serverId" },
    { header: "URL", field: "url" },
    { header: "STATUS", field: "status" },
  ],
};

export function buildHostedAgentUrl(version: string, target: AgentDeepLinkTarget): string {
  const { appBaseUrl } = resolveBySpaceHostedRelease(version);
  return new URL(buildAgentDeepLinkRoute(target), `${appBaseUrl}/`).toString();
}

type ExecFile = (file: string, args: readonly string[]) => Promise<unknown>;

export async function openWebUrl(
  url: string,
  platform: NodeJS.Platform = process.platform,
  run: ExecFile = promisify(execFile),
): Promise<void> {
  if (platform === "darwin") {
    await run("open", [url]);
    return;
  }
  if (platform === "win32") {
    await run("explorer.exe", [url]);
    return;
  }
  if (platform === "linux") {
    await run("xdg-open", [url]);
    return;
  }
  throw new Error(`Opening a browser is not supported on ${platform}.`);
}

export function addOpenOptions(command: Command): Command {
  return command
    .description("Open an existing agent in the BySpace Web app")
    .argument("<agent-id>", "Existing agent ID")
    .option("--server <server-id>", "Server ID (defaults to the local daemon)");
}

async function resolveServerId(options: CommandOptions): Promise<string> {
  const explicitServerId = typeof options.server === "string" ? options.server.trim() : "";
  if (explicitServerId) return explicitServerId;

  let client;
  try {
    client = await connectToDaemon({ host: options.host });
  } catch (error) {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  }
  try {
    const serverId = client.getLastServerInfoMessage()?.serverId.trim();
    if (!serverId) {
      const error: CommandError = {
        code: "SERVER_ID_UNAVAILABLE",
        message: "The daemon did not report a server ID.",
      };
      throw error;
    }
    return serverId;
  } finally {
    await client.close().catch(() => {});
  }
}

export async function runOpenCommand(
  agentIdArg: string,
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<OpenAgentResult>> {
  const agentId = agentIdArg.trim();
  if (!agentId) {
    const error: CommandError = { code: "MISSING_AGENT_ID", message: "Agent ID is required." };
    throw error;
  }

  const serverId = await resolveServerId(options);
  const url = buildHostedAgentUrl(resolveCliVersion(), { serverId, agentId });
  try {
    await openWebUrl(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const commandError: CommandError = {
      code: "OPEN_BROWSER_FAILED",
      message: `Failed to open the BySpace Web app: ${message} Copy this URL: ${url}`,
    };
    throw commandError;
  }

  return {
    type: "single",
    data: { agentId, serverId, url, status: "opened" },
    schema: openAgentSchema,
  };
}
