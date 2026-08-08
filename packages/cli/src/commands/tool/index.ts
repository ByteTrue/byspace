import { text } from "node:stream/consumers";
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import type { OrchestrationToolDescriptor } from "@bytetrue/byspace-protocol/messages";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { connectToDaemon } from "../../utils/client.js";
import type {
  CommandError,
  CommandOptions,
  ListResult,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";
import { withOutput } from "../../output/index.js";

interface ToolCommandOptions extends CommandOptions {
  voice?: boolean;
}

interface ToolCallOptions extends ToolCommandOptions {
  input?: string;
  inputFile?: string;
  timeout?: string;
}

interface ToolCallOutput {
  tool: string;
  result: Record<string, unknown>;
}

const toolSchema: OutputSchema<OrchestrationToolDescriptor> = {
  idField: "name",
  columns: [
    { header: "NAME", field: "name", width: 28 },
    { header: "TITLE", field: (tool) => tool.title ?? "-", width: 24 },
    { header: "DESCRIPTION", field: "description" },
  ],
  renderHuman: (result) => {
    const tool = result.data as OrchestrationToolDescriptor;
    return `${tool.name}\n\n${tool.description}\n\nInput schema:\n${JSON.stringify(tool.inputSchema, null, 2)}`;
  },
};

const toolCallSchema: OutputSchema<ToolCallOutput> = {
  idField: "tool",
  columns: [],
  renderHuman: (result) => JSON.stringify((result.data as ToolCallOutput).result, null, 2),
  serialize: (data) => data.result,
};

function callerAgentId(): string | undefined {
  return process.env.BYSPACE_AGENT_ID?.trim() || undefined;
}

async function connectToolClient(options: ToolCommandOptions) {
  const client = await connectToDaemon({ host: options.host, useAgentCliToken: true });
  // COMPAT(cliOrchestrationTools): added in v0.5.0, remove after 2027-02-07.
  if (client.getLastServerInfoMessage()?.features?.cliOrchestrationTools !== true) {
    await client.close().catch(() => {});
    throw {
      code: "DAEMON_UPDATE_REQUIRED",
      message: "Update the host to use BySpace orchestration tools from the CLI.",
    } satisfies CommandError;
  }
  return client;
}

async function readStdin(): Promise<string> {
  return text(process.stdin);
}

export async function parseToolInput(options: Pick<ToolCallOptions, "input" | "inputFile">) {
  if (options.input !== undefined && options.inputFile !== undefined) {
    throw new Error("Use either --input or --input-file, not both");
  }
  let raw = options.input;
  if (options.inputFile === "-") {
    raw = await readStdin();
  } else if (options.inputFile) {
    raw = await readFile(options.inputFile, "utf8");
  }
  if (raw === undefined || raw.trim() === "") return {};

  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool input must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

async function listTools(
  options: ToolCommandOptions,
  _command: Command,
): Promise<ListResult<OrchestrationToolDescriptor>> {
  const client = await connectToolClient(options);
  try {
    const response = await client.listOrchestrationTools({
      callerAgentId: callerAgentId(),
      includeVoice: options.voice,
    });
    if (!response.success) {
      throw { code: "TOOL_LIST_FAILED", message: response.error ?? "Failed to list tools" };
    }
    return { type: "list", data: response.tools, schema: toolSchema };
  } finally {
    await client.close().catch(() => {});
  }
}

async function describeTool(
  name: string,
  options: ToolCommandOptions,
  command: Command,
): Promise<SingleResult<OrchestrationToolDescriptor>> {
  const result = await listTools(options, command);
  const tool = result.data.find((candidate) => candidate.name === name);
  if (!tool) throw { code: "TOOL_NOT_FOUND", message: `Unknown tool: ${name}` };
  return { type: "single", data: tool, schema: toolSchema };
}

async function callTool(
  name: string,
  options: ToolCallOptions,
  _command: Command,
): Promise<SingleResult<ToolCallOutput>> {
  const input = await parseToolInput(options);
  const timeoutSeconds = options.timeout === undefined ? 86_400 : Number(options.timeout);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new Error("--timeout must be a positive number of seconds");
  }

  const client = await connectToolClient(options);
  try {
    const response = await client.callOrchestrationTool({
      toolName: name,
      input,
      callerAgentId: callerAgentId(),
      callerCwd: process.cwd(),
      callerWorkspaceId: process.env.BYSPACE_WORKSPACE_ID?.trim() || undefined,
      includeVoice: options.voice,
      timeout: timeoutSeconds * 1000,
    });
    if (!response.success || !response.result) {
      throw { code: "TOOL_CALL_FAILED", message: response.error ?? `Tool '${name}' failed` };
    }
    return {
      type: "single",
      data: { tool: name, result: response.result },
      schema: toolCallSchema,
    };
  } finally {
    await client.close().catch(() => {});
  }
}

function addToolContextOptions(command: Command): Command {
  return addJsonAndDaemonHostOptions(command).option(
    "--voice",
    "include the caller-scoped speak tool",
  );
}

export function createToolCommand(): Command {
  const command = new Command("tool").description(
    "List, inspect, and call the canonical BySpace orchestration tools",
  );

  addToolContextOptions(command.command("list").description("List orchestration tools")).action(
    withOutput(listTools),
  );
  addToolContextOptions(
    command.command("describe").description("Show a tool schema").argument("<name>"),
  ).action(withOutput(describeTool));
  addToolContextOptions(
    command
      .command("call")
      .description("Call an orchestration tool")
      .argument("<name>")
      .option("--input <json>", "tool input as a JSON object")
      .option("--input-file <path>", "read tool input from a file, or - for stdin")
      .option("--timeout <seconds>", "call timeout (default: 86400)"),
  ).action(withOutput(callTool));

  return command;
}
