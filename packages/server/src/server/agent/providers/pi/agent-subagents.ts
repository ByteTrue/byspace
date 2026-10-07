import type { SubagentObservation } from "../../provider-subagents/observation.js";
import type { ProviderSubagentStatus } from "../../provider-subagents/store.js";
import type { PiAgentMessage } from "./rpc-types.js";

/**
 * Pi announces background subagents through the @bytetrue/pi-subagent extension. Three wire
 * origins carry the facts, and all three reduce to the shared observation vocabulary:
 *
 * - the `subagent` tool result (launch): details `{ id, status: "running" }`, the task
 *   description lives on the tool call arguments;
 * - `subagent_status` / `subagent_stop` tool results and `subagent-exit` custom
 *   messages: details are the extension's full task record (`toMessageDetails`).
 *
 * The extension strips live objects before details cross the wire, so every field here is
 * clone-safe JSON. Both the live event stream and the persisted session replay read through
 * these functions, so a fact is derived once for both paths.
 */

/** Tool the extension registers to launch a background child. */
const PI_SUBAGENT_LAUNCH_TOOL = "subagent";
/** Tools whose results carry the full task record. */
const PI_SUBAGENT_RECORD_TOOLS = new Set(["subagent_status", "subagent_stop"]);
/** Custom message type the extension sends when a child finishes. */
const PI_SUBAGENT_EXIT_CUSTOM_TYPE = "subagent-exit";

export function isPiSubagentToolName(toolName: string): boolean {
  return toolName === PI_SUBAGENT_LAUNCH_TOOL || PI_SUBAGENT_RECORD_TOOLS.has(toolName);
}

/**
 * The descriptor has no paused state and paused is not terminal, so it reads as running.
 * Unknown statuses map to undefined: the caller's upsert then preserves the stored status.
 */
export function mapPiSubagentStatus(status: unknown): ProviderSubagentStatus | undefined {
  switch (status) {
    case "running":
    case "pending":
    case "paused":
      return "running";
    case "succeeded":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "canceled";
    default:
      return undefined;
  }
}

interface PiSubagentRecordDetails {
  id: string;
  status?: string;
  description?: string;
  agent?: string;
}

/**
 * The subset of `toMessageDetails` this source reads. Every field is optional except the
 * id: the extension adds fields across releases and older runtimes omit newer ones, so a
 * wrong-typed field reads as absent rather than failing the record.
 */
export function parsePiSubagentRecordDetails(details: unknown): PiSubagentRecordDetails | null {
  if (typeof details !== "object" || details === null || Array.isArray(details)) {
    return null;
  }
  const record = details as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0) {
    return null;
  }
  return {
    id: record.id,
    ...(typeof record.status === "string" ? { status: record.status } : {}),
    ...(typeof record.description === "string" ? { description: record.description } : {}),
    ...(typeof record.agent === "string" && record.agent.length > 0 ? { agent: record.agent } : {}),
  };
}

function readStringArg(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** Launch observation from the `subagent` tool result plus its call arguments. */
export function observePiSubagentLaunch(input: {
  toolCallId: string;
  args: unknown;
  details: unknown;
}): SubagentObservation | null {
  const record = parsePiSubagentRecordDetails(input.details);
  if (!record) {
    return null;
  }
  const args =
    typeof input.args === "object" && input.args !== null
      ? (input.args as Record<string, unknown>)
      : {};
  const agent = readStringArg(args.agent);
  const task = readStringArg(args.task) ?? record.description;
  return {
    kind: "declared",
    id: record.id,
    toolCallId: input.toolCallId,
    ...(agent ? { title: agent } : {}),
    ...(task ? { description: task } : {}),
  };
}

/** Status observation from a full task record (status/stop tool result or exit message). */
export function observePiSubagentRecord(details: unknown): SubagentObservation | null {
  const record = parsePiSubagentRecordDetails(details);
  if (!record) {
    return null;
  }
  const status = mapPiSubagentStatus(record.status);
  if (!status) {
    return null;
  }
  return { kind: "status", id: record.id, status };
}

/**
 * Exit custom messages carry one record, or an array when several children finished before
 * the extension could deliver the notification (its exit-batch path).
 */
export function observePiSubagentExit(details: unknown): SubagentObservation[] {
  if (Array.isArray(details)) {
    return details
      .map((entry) => observePiSubagentRecord(entry))
      .filter((observation): observation is SubagentObservation => observation !== null);
  }
  const observation = observePiSubagentRecord(details);
  return observation ? [observation] : [];
}

/**
 * Rebuilds subagent observations from a persisted session, producing the same vocabulary the
 * live source produces. Identical observations in means identical descriptor state out.
 *
 * The transcript carries all three origins: assistant toolCall blocks with their toolResult
 * messages (launch and record results), and `subagent-exit` custom messages. Tool calls
 * precede their results in an assistant turn, so a single pass with a pending map pairs them.
 */
export function replayPiSubagentObservations(
  messages: readonly PiAgentMessage[],
): SubagentObservation[] {
  const observations: SubagentObservation[] = [];
  const pendingLaunches = new Map<string, { name: string; args: unknown }>();

  for (const message of messages) {
    if (message.role === "assistant") {
      for (const content of message.content) {
        if (content.type === "toolCall" && isPiSubagentToolName(content.name)) {
          pendingLaunches.set(content.id, { name: content.name, args: content.arguments });
        }
      }
      continue;
    }
    if (message.role === "toolResult") {
      const launch = pendingLaunches.get(message.toolCallId);
      pendingLaunches.delete(message.toolCallId);
      if (!launch) {
        continue;
      }
      if (launch.name === PI_SUBAGENT_LAUNCH_TOOL) {
        const observation = observePiSubagentLaunch({
          toolCallId: message.toolCallId,
          args: launch.args,
          details: message.details,
        });
        if (observation) {
          observations.push(observation);
        }
        continue;
      }
      const observation = observePiSubagentRecord(message.details);
      if (observation) {
        observations.push(observation);
      }
      continue;
    }
    if (message.role === "custom" && message.customType === PI_SUBAGENT_EXIT_CUSTOM_TYPE) {
      observations.push(...observePiSubagentExit(message.details));
    }
  }

  return observations;
}
