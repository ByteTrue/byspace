import type { AgentStreamEvent, AgentTimelineItem, ToolCallDetail } from "../../agent-sdk-types.js";
import { limitTimelineDetails } from "../../agent-timeline-content.js";
import type { PiAgentMessage, PiImageContent, PiTextContent } from "./rpc-types.js";
import {
  buildPiNestedToolCallMetadata,
  extractTextFromToolResult,
  mapToolDetail,
  parseToolArgs,
  parseToolResult,
  resolveToolCallName,
  type PiToolResult,
  type PiTrackedToolCall,
} from "./tool-call-mapper.js";

export interface PiCapturedUserMessageEntry {
  id: string;
  text: string;
}

export interface PiHistoryMapperHooks {
  mapCustomMessage?: (
    text: string,
    provider: string,
  ) => Extract<AgentStreamEvent, { type: "timeline" }> | null;
  resolveToolCallId?: (toolCallId: string, toolCall: PiTrackedToolCall) => string;
  mapToolDetail?: (
    toolCall: PiTrackedToolCall,
    result: PiToolResult,
    context: { toolCallId: string },
  ) => ToolCallDetail | null;
}

function isTextContentBlock(block: unknown): block is PiTextContent {
  return (
    typeof block === "object" &&
    block !== null &&
    !Array.isArray(block) &&
    Reflect.get(block, "type") === "text" &&
    typeof Reflect.get(block, "text") === "string"
  );
}

export function getUserMessageText(content: string | (PiTextContent | PiImageContent)[]): string {
  if (typeof content === "string") {
    return content;
  }

  const textParts: string[] = [];
  for (const block of content) {
    if (isTextContentBlock(block)) {
      textParts.push(block.text);
    }
  }
  return textParts.join("\n\n");
}

export class PiHistoryMapper {
  private readonly pendingToolCalls = new Map<string, PiTrackedToolCall>();
  private userIndex = 0;
  private assistantIndex = 0;

  constructor(
    private readonly provider: string,
    private readonly userEntries: readonly PiCapturedUserMessageEntry[] = [],
    private readonly hooks: PiHistoryMapperHooks = {},
  ) {}

  mapMessages(messages: readonly PiAgentMessage[]): AgentStreamEvent[] {
    const events: AgentStreamEvent[] = [];

    for (const message of messages) {
      switch (message.role) {
        case "user":
          events.push(...this.mapUserMessage(message));
          break;
        case "custom":
          events.push(...this.mapCustomMessage(message));
          break;
        case "assistant":
          events.push(...this.mapAssistantMessage(message));
          break;
        case "toolResult":
          events.push(...this.mapToolResultMessage(message));
          break;
        case "bashExecution":
          events.push(this.mapBashExecutionMessage(message));
          break;
      }
    }

    return events;
  }

  private mapUserMessage(message: Extract<PiAgentMessage, { role: "user" }>): AgentStreamEvent[] {
    const text = getUserMessageText(message.content);
    this.userIndex += 1;
    if (!text) {
      return [];
    }
    const userEntry = this.userEntries[this.userIndex - 1];
    return [
      {
        type: "timeline",
        provider: this.provider,
        item: {
          type: "user_message",
          text,
          ...(userEntry ? { messageId: userEntry.id } : {}),
        },
      },
    ];
  }

  private mapCustomMessage(
    message: Extract<PiAgentMessage, { role: "custom" }>,
  ): AgentStreamEvent[] {
    // Pi extension sendMessage() payloads surface as custom messages. display=false
    // means context-only (Pi's TUI hides them too). display is optional on older
    // runtimes; treat missing as true so exit notifications still surface.
    if (message.display === false) {
      return [];
    }
    const text = getUserMessageText(message.content);
    const mappedEvent = text ? this.hooks.mapCustomMessage?.(text, this.provider) : null;
    if (mappedEvent) {
      return [mappedEvent];
    }
    const details = limitTimelineDetails(message.details);
    return text
      ? [
          {
            type: "timeline",
            provider: this.provider,
            item: {
              type: "custom_message",
              customType: message.customType || "custom",
              display: true,
              content: text,
              ...(details !== undefined ? { details } : {}),
            },
          },
        ]
      : [];
  }

  private mapAssistantMessage(
    message: Extract<PiAgentMessage, { role: "assistant" }>,
  ): AgentStreamEvent[] {
    const events: AgentStreamEvent[] = [];
    this.assistantIndex += 1;
    const messageId =
      message.responseId || `${this.provider}-history-assistant-${this.assistantIndex}`;
    for (const content of message.content) {
      if (content.type === "text" && content.text) {
        events.push({
          type: "timeline",
          provider: this.provider,
          item: { type: "assistant_message", text: content.text, messageId },
        });
        continue;
      }
      if (content.type === "thinking" && content.thinking) {
        events.push({
          type: "timeline",
          provider: this.provider,
          item: { type: "reasoning", text: content.thinking },
        });
        continue;
      }
      if (content.type === "toolCall") {
        const tracked = parseToolArgs(content.name, content.arguments);
        this.pendingToolCalls.set(content.id, tracked);
        const detail = this.mapToolDetail(content.id, tracked, null);
        if (!detail) {
          continue;
        }
        events.push({
          type: "timeline",
          provider: this.provider,
          item: {
            type: "tool_call",
            callId: this.resolveToolCallId(content.id, tracked),
            name: tracked.toolName,
            status: "running",
            detail,
            error: null,
          },
        });
      }
    }
    return events;
  }

  private mapToolResultMessage(
    message: Extract<PiAgentMessage, { role: "toolResult" }>,
  ): AgentStreamEvent[] {
    const tracked =
      this.pendingToolCalls.get(message.toolCallId) ?? parseToolArgs(message.toolName, null);
    this.pendingToolCalls.delete(message.toolCallId);
    const result = parseToolResult({ content: message.content, details: message.details });
    const detail = this.mapToolDetail(message.toolCallId, tracked, result);
    if (!detail) {
      return [];
    }
    const callId = this.resolveToolCallId(message.toolCallId, tracked);
    // Nested rows go before the parent result row: live, they streamed while the parent was
    // still running, so this keeps the replayed sequence identical to the recorded one.
    const events = this.replayedNestedCallEvents(message.nestedCalls);
    events.push({
      type: "timeline",
      provider: this.provider,
      item: toToolResultTimelineItem({
        callId,
        name: resolveToolCallName(tracked, result),
        isError: Boolean(message.isError),
        detail,
        errorText: extractTextFromToolResult(result) ?? "Tool call failed",
        metadata: buildPiNestedToolCallMetadata({
          toolCallId: callId,
          nestedCalls: message.nestedCalls,
        }),
      }),
    });
    return events;
  }

  // pi persists the tool calls a tool made through ctx.executeTool() (codemode scripts and
  // alike) only as a nestedCalls snapshot on the parent's result message — the tool_execution_*
  // rows they streamed live are not in the transcript. Rebuilds those rows so a reload groups
  // them under the parent exactly like the live stream did. Records keep pi's hierarchical ids
  // ("<callerId>/<n>"), so the direct caller for the metadata is the id up to the last separator,
  // and codemode-in-codemode intermediates resolve to the top ancestor in the app's projection
  // like live rows do. The ids are transcript-original: this assumes the pi replay path never
  // enables the resolveToolCallId hook (it does not today), otherwise rewritten parent callIds
  // would orphan these rows into the nestedSummary fallback.
  private replayedNestedCallEvents(nestedCalls: unknown): AgentStreamEvent[] {
    if (!isRecord(nestedCalls) || !Array.isArray(nestedCalls.calls)) {
      return [];
    }
    const events: AgentStreamEvent[] = [];
    for (const record of nestedCalls.calls) {
      if (!isRecord(record)) {
        continue;
      }
      const name = typeof record.name === "string" ? record.name.trim() : "";
      const id = typeof record.id === "string" ? record.id : "";
      const parentToolCallId = directCallerFromNestedId(id);
      if (!name || !parentToolCallId) {
        continue;
      }
      const toolCall = parseToolArgs(name, record.arguments ?? null);
      const detail = this.mapToolDetail(id, toolCall, null);
      if (!detail) {
        continue;
      }
      events.push({
        type: "timeline",
        provider: this.provider,
        item: {
          type: "tool_call",
          callId: id,
          // Live names also rename through result details (xdev write); nested results are not
          // persisted, so only args-driven renames (mcp server.tool) apply here.
          name: resolveToolCallName(toolCall, null),
          ...replayedNestedCallStatus(record),
          detail,
          metadata: { parentToolCallId },
        },
      });
    }
    return events;
  }

  private mapBashExecutionMessage(
    message: Extract<PiAgentMessage, { role: "bashExecution" }>,
  ): AgentStreamEvent {
    const detail: ToolCallDetail = {
      type: "shell",
      command: message.command,
      output: message.output,
      exitCode: message.exitCode ?? null,
    };
    return {
      type: "timeline",
      provider: this.provider,
      item: {
        type: "tool_call",
        callId: `pi-bash-${message.timestamp}`,
        name: "bash",
        status: message.cancelled ? "canceled" : "completed",
        detail,
        error: null,
      },
    };
  }

  private resolveToolCallId(toolCallId: string, toolCall: PiTrackedToolCall): string {
    return this.hooks.resolveToolCallId?.(toolCallId, toolCall) ?? toolCallId;
  }

  private mapToolDetail(
    toolCallId: string,
    toolCall: PiTrackedToolCall,
    result: PiToolResult,
  ): ToolCallDetail | null {
    const hook = this.hooks.mapToolDetail;
    return hook ? hook(toolCall, result, { toolCallId }) : mapToolDetail(toolCall, result);
  }
}

export async function* streamPiHistory(
  provider: string,
  messages: PiAgentMessage[],
  userEntries: readonly PiCapturedUserMessageEntry[] = [],
  hooks: PiHistoryMapperHooks = {},
): AsyncGenerator<AgentStreamEvent> {
  const mapper = new PiHistoryMapper(provider, userEntries, hooks);
  for (const event of mapper.mapMessages(messages)) {
    if (event) {
      yield event;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// "unfinished" means pi recorded the start but the call never finished — an interrupted script.
function replayedNestedCallStatus(
  record: Record<string, unknown>,
):
  | { status: "completed"; error: null }
  | { status: "failed"; error: string }
  | { status: "canceled"; error: null } {
  if (record.status === "error") {
    return {
      status: "failed",
      error:
        typeof record.error === "string" && record.error.trim().length > 0
          ? record.error
          : "Tool call failed",
    };
  }
  if (record.status === "ok") {
    return { status: "completed", error: null };
  }
  return { status: "canceled", error: null };
}

// The nested call id is "<callerId>/<n>" and the caller may itself be nested, so the direct
// caller is everything before the last separator.
function directCallerFromNestedId(id: string): string | null {
  const separatorIndex = id.lastIndexOf("/");
  return separatorIndex > 0 ? id.slice(0, separatorIndex) : null;
}

function toToolResultTimelineItem(input: {
  callId: string;
  name: string;
  isError: boolean;
  detail: ToolCallDetail;
  errorText: string;
  metadata?: Record<string, unknown> | null;
}): AgentTimelineItem {
  if (input.isError) {
    return {
      type: "tool_call",
      callId: input.callId,
      name: input.name,
      status: "failed",
      detail: input.detail,
      error: input.errorText,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
  }
  return {
    type: "tool_call",
    callId: input.callId,
    name: input.name,
    status: "completed",
    detail: input.detail,
    error: null,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}
