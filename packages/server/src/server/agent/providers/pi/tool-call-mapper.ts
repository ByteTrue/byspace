import { z } from "zod";

import { categorizeToolCall } from "@bytetrue/protocol/tool-call-category";

import type { ToolCallDetail } from "../../agent-sdk-types.js";

interface BashToolInput {
  command: string;
  timeout?: number;
}

interface ReadToolInput {
  path: string;
  offset?: number;
  limit?: number;
}

interface EditToolInput {
  path: string;
  edits: Array<{
    oldText: string;
    newText: string;
  }>;
}

interface WriteToolInput {
  path: string;
  content: string;
}

interface FindToolInput {
  pattern: string;
  path?: string;
  limit?: number;
}

interface GrepToolInput {
  pattern: string;
  path?: string;
  glob?: string;
  ignoreCase?: boolean;
  literal?: boolean;
  context?: number;
  limit?: number;
}

interface LsToolInput {
  path?: string;
  limit?: number;
}

interface PiToolResultObject {
  output?: string;
  stdout?: string;
  text?: string;
  content?: PiToolResultContent[];
  exitCode?: number;
  code?: number;
  details?: PiToolResultDetails;
}

interface PiNestedToolCallSummary {
  editedFileCount: number;
  commandCount: number;
  readFileCount: number;
  searchCount: number;
  otherToolCount: number;
  byspaceCallCount: number;
}

interface PiToolResultDetails {
  diff?: string;
  mode?: string;
  server?: string;
  tool?: string;
  mcpResult?: unknown;
  xdev?: unknown;
}

interface PiToolResultTextContent {
  type: "text";
  text: string;
}

interface PiToolResultUnknownContent {
  type: string;
}

type PiToolResultContent = PiToolResultTextContent | PiToolResultUnknownContent;
export type PiToolResult = string | PiToolResultObject | null;

interface PiBashToolCall {
  kind: "bash";
  toolName: "bash";
  args: BashToolInput;
}

interface PiReadToolCall {
  kind: "read";
  toolName: "read";
  args: ReadToolInput;
}

interface PiEditToolCall {
  kind: "edit";
  toolName: "edit";
  args: EditToolInput;
}

interface PiWriteToolCall {
  kind: "write";
  toolName: "write";
  args: WriteToolInput;
}

interface PiFindToolCall {
  kind: "find";
  toolName: "find";
  args: FindToolInput;
}

interface PiGrepToolCall {
  kind: "grep";
  toolName: "grep";
  args: GrepToolInput;
}

interface PiLsToolCall {
  kind: "ls";
  toolName: "ls";
  args: LsToolInput;
}

interface PiUnknownToolCall {
  kind: "unknown";
  toolName: string;
  args: unknown;
}

export type PiTrackedToolCall =
  | PiBashToolCall
  | PiReadToolCall
  | PiEditToolCall
  | PiWriteToolCall
  | PiFindToolCall
  | PiGrepToolCall
  | PiLsToolCall
  | PiUnknownToolCall;

interface ToolCallOutputSummary {
  output?: string;
  exitCode?: number | null;
}

const PiToolResultTextContentSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const PiToolResultUnknownContentSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();

const PiToolResultContentSchema = z.union([
  PiToolResultTextContentSchema,
  PiToolResultUnknownContentSchema,
]);

const PiToolResultDetailsSchema = z
  .object({
    diff: z.string().optional(),
  })
  .passthrough();

const XdevExecuteDetailsSchema = z.object({
  tool: z.string().trim().min(1),
  mode: z.literal("execute"),
  args: z.unknown().optional(),
  inner: z.unknown().optional(),
});

const PiToolResultObjectSchema = z
  .object({
    output: z.string().optional(),
    stdout: z.string().optional(),
    text: z.string().optional(),
    content: z.array(PiToolResultContentSchema).optional(),
    exitCode: z.number().optional(),
    code: z.number().optional(),
    details: PiToolResultDetailsSchema.optional(),
  })
  .passthrough();

const PiToolResultSchema = z.union([z.string(), PiToolResultObjectSchema, z.null()]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

const BashToolInputSchema: z.ZodType<BashToolInput> = z.object({
  command: z.string(),
  timeout: z.number().optional(),
});

const ReadToolInputSchema: z.ZodType<ReadToolInput> = z.object({
  path: z.string(),
  offset: z.number().optional(),
  limit: z.number().optional(),
});

const EditToolInputSchema: z.ZodType<EditToolInput> = z.object({
  path: z.string(),
  edits: z.array(
    z.object({
      oldText: z.string(),
      newText: z.string(),
    }),
  ),
});

const LegacyEditToolInputSchema = z.object({
  path: z.string(),
  old_string: z.string().optional(),
  oldString: z.string().optional(),
  new_string: z.string().optional(),
  newString: z.string().optional(),
});

const WriteToolInputSchema: z.ZodType<WriteToolInput> = z.object({
  path: z.string(),
  content: z.string(),
});

const FindToolInputSchema: z.ZodType<FindToolInput> = z.object({
  pattern: z.string(),
  path: z.string().optional(),
  limit: z.number().optional(),
});

const GrepToolInputSchema: z.ZodType<GrepToolInput> = z.object({
  pattern: z.string(),
  path: z.string().optional(),
  glob: z.string().optional(),
  ignoreCase: z.boolean().optional(),
  literal: z.boolean().optional(),
  context: z.number().optional(),
  limit: z.number().optional(),
});

const LsToolInputSchema: z.ZodType<LsToolInput> = z.object({
  path: z.string().optional(),
  limit: z.number().optional(),
});

export function parseToolResult(rawResult: unknown): PiToolResult {
  const parsed = PiToolResultSchema.safeParse(rawResult);
  if (parsed.success) {
    return parsed.data;
  }
  return null;
}

export function extractTextFromToolResult(result: PiToolResult): string | undefined {
  if (typeof result === "string") {
    return result;
  }
  if (!result) {
    return undefined;
  }

  const directText = result.output ?? result.stdout ?? result.text;
  if (directText) {
    return directText;
  }
  if (!result.content) {
    return undefined;
  }

  const textParts: string[] = [];
  for (const block of result.content) {
    if (block.type === "text" && "text" in block) {
      textParts.push(block.text);
    }
  }

  return textParts.length > 0 ? textParts.join("\n") : undefined;
}

export function parseToolArgs(toolName: string, rawArgs: unknown): PiTrackedToolCall {
  if (toolName === "edit") {
    return parseEditToolArgs(rawArgs);
  }
  const schema = SIMPLE_TOOL_SCHEMAS[toolName as SimpleToolKind];
  if (schema) {
    const parsed = schema.safeParse(rawArgs);
    if (parsed.success) {
      return { kind: toolName as SimpleToolKind, toolName, args: parsed.data } as PiTrackedToolCall;
    }
  }
  return { kind: "unknown", toolName, args: rawArgs ?? null };
}

function stripMcpProxyPrefix(toolName: string, serverName: string): string {
  const prefix = `${serverName}_`;
  return toolName.startsWith(prefix) ? toolName.slice(prefix.length) : toolName;
}

export function resolveToolCallName(toolCall: PiTrackedToolCall, result?: PiToolResult): string {
  if (toolCall.kind === "write" && result && typeof result !== "string") {
    const xdev = XdevExecuteDetailsSchema.safeParse(result.details?.xdev);
    if (xdev.success) {
      return xdev.data.tool;
    }
  }

  if (toolCall.toolName !== "mcp") {
    return toolCall.toolName;
  }

  if (result && typeof result !== "string") {
    const serverName = readNonEmptyString(result.details?.server);
    const toolName = readNonEmptyString(result.details?.tool);
    if (serverName && toolName) {
      return `${serverName}.${toolName}`;
    }
  }

  if (isRecord(toolCall.args)) {
    const requestedTool = readNonEmptyString(toolCall.args.tool);
    const requestedServer = readNonEmptyString(toolCall.args.server);
    if (requestedTool && requestedServer) {
      return `${requestedServer}.${stripMcpProxyPrefix(requestedTool, requestedServer)}`;
    }
    if (requestedTool) {
      const [serverName, ...toolParts] = requestedTool.split("_");
      if (serverName && toolParts.length > 0) {
        return `${serverName}.${toolParts.join("_")}`;
      }
    }
  }

  return toolCall.toolName;
}

export function mapToolDetail(toolCall: PiTrackedToolCall, result?: PiToolResult): ToolCallDetail {
  const parsedResult = result ?? null;

  if (isTaskToolCall(toolCall)) {
    return mapTaskToolDetail(toolCall.args, parsedResult);
  }

  switch (toolCall.kind) {
    case "bash": {
      const summary = resolveToolCallOutput(parsedResult);
      return {
        type: "shell",
        command: toolCall.args.command,
        output: summary.output,
        exitCode: summary.exitCode,
      };
    }
    case "read":
      return {
        type: "read",
        filePath: toolCall.args.path,
        content: extractTextFromToolResult(parsedResult),
        offset: toolCall.args.offset,
        limit: toolCall.args.limit,
      };
    case "edit": {
      const firstEdit = toolCall.args.edits[0];
      const unifiedDiff =
        parsedResult && typeof parsedResult !== "string" ? parsedResult.details?.diff : undefined;

      return {
        type: "edit",
        filePath: toolCall.args.path,
        oldString: firstEdit?.oldText,
        newString: firstEdit?.newText,
        unifiedDiff,
      };
    }
    case "write":
      return mapWriteToolDetail(toolCall.args, parsedResult);
    case "find":
      return mapFindToolDetail(toolCall.args, parsedResult);
    case "grep":
      return mapGrepToolDetail(toolCall.args, parsedResult);
    case "ls":
      return mapLsToolDetail(toolCall.args, parsedResult);
    default:
      return {
        type: "unknown",
        input: toolCall.args,
        output: parsedResult,
      };
  }
}

function isTaskToolCall(toolCall: PiTrackedToolCall): boolean {
  if (toolCall.toolName === "task") {
    return true;
  }
  if (toolCall.toolName !== "subagent" || !isRecord(toolCall.args)) {
    return false;
  }
  return (
    toolCall.args.action === undefined &&
    (readNonEmptyString(toolCall.args.agent) !== undefined ||
      readNonEmptyString(toolCall.args.task) !== undefined)
  );
}

function mapTaskToolDetail(args: unknown, result: PiToolResult): ToolCallDetail {
  const argRecord = isRecord(args) ? args : {};
  return {
    type: "sub_agent",
    subAgentType: readNonEmptyString(argRecord.agent),
    description: readNonEmptyString(argRecord.task),
    log: extractTextFromToolResult(result)?.trim() ?? "",
  };
}

function mapWriteToolDetail(args: WriteToolInput, result: PiToolResult): ToolCallDetail {
  if (result && typeof result !== "string" && result.details && "xdev" in result.details) {
    const xdev = XdevExecuteDetailsSchema.safeParse(result.details.xdev);
    if (xdev.success) {
      return {
        type: "unknown",
        input: xdev.data.args ?? null,
        output: {
          ...result,
          details: xdev.data.inner ?? null,
        },
      };
    }

    return {
      type: "unknown",
      input: args,
      output: result,
    };
  }

  return {
    type: "write",
    filePath: args.path,
    content: args.content,
  };
}

function resolveToolCallOutput(result: PiToolResult): ToolCallOutputSummary {
  if (typeof result === "string") {
    return { output: result };
  }
  if (!result) {
    return {};
  }

  const summary: ToolCallOutputSummary = {
    output: extractTextFromToolResult(result),
  };
  if (typeof result.exitCode === "number") {
    summary.exitCode = result.exitCode;
    return summary;
  }
  if (typeof result.code === "number") {
    summary.exitCode = result.code;
    return summary;
  }
  summary.exitCode = null;
  return summary;
}

function normalizeLegacyEditArgs(rawArgs: unknown): EditToolInput | null {
  const parsed = LegacyEditToolInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return null;
  }

  const oldText = parsed.data.old_string ?? parsed.data.oldString;
  const newText = parsed.data.new_string ?? parsed.data.newString;
  if (!oldText || newText === undefined) {
    return null;
  }

  return {
    path: parsed.data.path,
    edits: [{ oldText, newText }],
  };
}

function parseEditToolArgs(rawArgs: unknown): PiTrackedToolCall {
  const parsed = EditToolInputSchema.safeParse(rawArgs);
  if (parsed.success) {
    return { kind: "edit", toolName: "edit", args: parsed.data };
  }
  const legacyArgs = normalizeLegacyEditArgs(rawArgs);
  if (legacyArgs) {
    return { kind: "edit", toolName: "edit", args: legacyArgs };
  }
  return { kind: "unknown", toolName: "edit", args: rawArgs ?? null };
}

type SimpleToolKind = "bash" | "read" | "write" | "find" | "grep" | "ls";
const SIMPLE_TOOL_SCHEMAS: {
  [K in SimpleToolKind]: { safeParse: (data: unknown) => { success: boolean; data?: unknown } };
} = {
  bash: BashToolInputSchema,
  read: ReadToolInputSchema,
  write: WriteToolInputSchema,
  find: FindToolInputSchema,
  grep: GrepToolInputSchema,
  ls: LsToolInputSchema,
};

function mapFindToolDetail(args: FindToolInput, result: PiToolResult): ToolCallDetail {
  return {
    type: "search",
    query: args.pattern,
    toolName: "search",
    content: typeof result === "string" ? result : undefined,
  };
}

function mapGrepToolDetail(args: GrepToolInput, result: PiToolResult): ToolCallDetail {
  return {
    type: "search",
    query: args.pattern,
    toolName: "grep",
    content: typeof result === "string" ? result : undefined,
  };
}

function mapLsToolDetail(args: LsToolInput, result: PiToolResult): ToolCallDetail {
  return {
    type: "search",
    query: args.path ?? "ls",
    content: typeof result === "string" ? result : undefined,
  };
}

// Summarizes the raw nested calls pi records alongside the parent result. Each call goes through
// the same detail mapper the live rows use, so the replayed badge counts what the live badge counts
// — a nested `ls` is a search either way.
function summarizeNestedToolCalls(calls: readonly unknown[]): PiNestedToolCallSummary | null {
  const editedFiles = new Set<string>();
  const readFiles = new Set<string>();
  let commandCount = 0;
  let searchCount = 0;
  let otherToolCount = 0;
  let byspaceCallCount = 0;
  let counted = 0;
  for (const rawCall of calls) {
    if (!isRecord(rawCall)) {
      continue;
    }
    const rawName = rawCall.name;
    if (typeof rawName !== "string" || rawName.trim().length === 0) {
      continue;
    }
    counted += 1;
    const detail = mapToolDetail(parseToolArgs(rawName, rawCall.arguments));
    const match = categorizeToolCall({ name: rawName, detail });
    if (match.category === "edited") {
      editedFiles.add(match.filePath);
    } else if (match.category === "read") {
      readFiles.add(match.filePath);
    } else if (match.category === "command") {
      commandCount += 1;
    } else if (match.category === "search") {
      searchCount += 1;
    } else if (match.category === "byspace") {
      byspaceCallCount += 1;
    } else {
      otherToolCount += 1;
    }
  }
  if (counted === 0) {
    return null;
  }
  return {
    editedFileCount: editedFiles.size,
    commandCount,
    readFileCount: readFiles.size,
    searchCount,
    otherToolCount,
    byspaceCallCount,
  };
}

// Builds the metadata that folds pi codemode nested calls into the parent row:
// - a nested call carries the parentToolCallId pi put on its own tool_execution_* event, which is
//   the caller one level up; the app walks up to the ancestor that stays in the stream;
// - nestedCalls is the { calls, complete } snapshot pi attaches to the persisted tool result
//   message (never to the live tool_execution_end result), summarized so a replay can show a badge
//   built from the same rules as the live rows.
export function buildPiNestedToolCallMetadata(input: {
  toolCallId: string;
  parentToolCallId?: string;
  nestedCalls?: unknown;
}): Record<string, unknown> | null {
  const metadata: Record<string, unknown> = {};
  const parentToolCallId = input.parentToolCallId ?? parentToolCallIdFromId(input.toolCallId);
  if (parentToolCallId) {
    metadata.parentToolCallId = parentToolCallId;
  }
  if (isRecord(input.nestedCalls)) {
    const calls = input.nestedCalls.calls;
    if (Array.isArray(calls) && calls.length > 0) {
      const summary = summarizeNestedToolCalls(calls);
      if (summary) {
        metadata.nestedSummary = summary;
      }
    }
  }
  return Object.keys(metadata).length > 0 ? metadata : null;
}

// Older pi builds only encode the parent in the id. The id of a nested call is "<caller>/<n>", so
// the caller is everything before the first separator.
function parentToolCallIdFromId(toolCallId: string): string | null {
  const separatorIndex = toolCallId.indexOf("/");
  return separatorIndex > 0 ? toolCallId.slice(0, separatorIndex) : null;
}
