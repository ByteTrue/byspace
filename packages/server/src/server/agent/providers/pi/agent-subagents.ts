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
 * Paused maps to canceled, not running: pi-subagent pauses by killing the child process
 * (timeout / max turns), the exit message carrying "paused" is that task's last update, and
 * resuming builds a new task id with its own row — so a paused row that reads as running never
 * resolves and pins the track's "N working" pill forever.
 * Unknown statuses map to undefined: the caller's upsert then preserves the stored status.
 */
export function mapPiSubagentStatus(status: unknown): ProviderSubagentStatus | undefined {
  switch (status) {
    case "running":
    case "pending":
      return "running";
    case "paused":
    case "cancelled":
      return "canceled";
    case "succeeded":
      return "completed";
    case "failed":
      return "failed";
    default:
      return undefined;
  }
}

interface PiSubagentRecordDetails {
  id: string;
  status?: string;
  description?: string;
  agent?: string;
  /**
   * Child session pointer, written into every record by pi-subagent releases carrying
   * the transcript self-description change (pi-package-mono issue 115). Older releases
   * omit the fields; absent means "not known".
   */
  sessionId?: string;
  cwd?: string;
  sessionFile?: string;
}

/** Where the child's pi session jsonl lives — the durable timeline authority. */
export interface PiSubagentSessionPointer {
  sessionId?: string;
  cwd?: string;
  sessionFile?: string;
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
    ...(typeof record.sessionId === "string" && record.sessionId
      ? { sessionId: record.sessionId }
      : {}),
    ...(typeof record.cwd === "string" && record.cwd ? { cwd: record.cwd } : {}),
    ...(typeof record.sessionFile === "string" && record.sessionFile
      ? { sessionFile: record.sessionFile }
      : {}),
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
 *
 * A child whose last transcript record still reads running gets a closing `canceled`: replay
 * happens in a fresh pi process, process replacement killed the old tree, and the exit message
 * that would have carried the terminal state never made it to disk. Without this the replayed
 * row pins "running" forever with an empty timeline — the blank-spinner subagent tab.
 */
export interface PiSubagentReplay {
  observations: SubagentObservation[];
  /** Child session pointer per subagent id; later origins win over earlier ones. */
  sessionPointers: Map<string, PiSubagentSessionPointer>;
}

/** Record details to a cumulative pointer; records without any pointer field (pre-0.18
 * transcripts) contribute nothing. Later origins win — the exit record's sessionFile is
 * the most precise form. */
function absorbSessionPointer(
  pointers: Map<string, PiSubagentSessionPointer>,
  details: unknown,
): void {
  const record = parsePiSubagentRecordDetails(details);
  if (!record) return;
  const session: PiSubagentSessionPointer = {
    ...(record.sessionId ? { sessionId: record.sessionId } : {}),
    ...(record.cwd ? { cwd: record.cwd } : {}),
    ...(record.sessionFile ? { sessionFile: record.sessionFile } : {}),
  };
  if (Object.keys(session).length === 0) return;
  pointers.set(record.id, { ...pointers.get(record.id), ...session });
}

/**
 * Single-pass replay: the observations the descriptor store needs plus the child session
 * pointers the timeline rebuild reads. `options.closeRunningAsCanceled` closes out
 * subagents whose last transcript record still reads running — only sound when the
 * process that produced these messages is gone (see streamHistory's processReplaced).
 * See each public wrapper below for the rest of the semantics.
 */
export function replayPiSubagentSession(
  messages: readonly PiAgentMessage[],
  options?: { closeRunningAsCanceled?: boolean },
): PiSubagentReplay {
  const observations: SubagentObservation[] = [];
  const sessionPointers = new Map<string, PiSubagentSessionPointer>();
  const pendingLaunches = new Map<string, { name: string; args: unknown }>();
  // Last status observation seen per subagent id, in transcript order. Non-running statuses
  // are removed: a later record (e.g. a fresh subagent_status poll) can report running again.
  const lastStatus = new Map<string, ProviderSubagentStatus>();

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
      // Launch and record results both carry the pointer; one parse covers both.
      absorbSessionPointer(sessionPointers, message.details);
      if (launch.name === PI_SUBAGENT_LAUNCH_TOOL) {
        const observation = observePiSubagentLaunch({
          toolCallId: message.toolCallId,
          args: launch.args,
          details: message.details,
        });
        if (observation) {
          observations.push(observation);
          lastStatus.set(observation.id, "running");
        }
        continue;
      }
      const observation = observePiSubagentRecord(message.details);
      if (observation?.kind === "status") {
        observations.push(observation);
        lastStatus.set(observation.id, observation.status);
      }
      continue;
    }
    if (message.role === "custom" && message.customType === PI_SUBAGENT_EXIT_CUSTOM_TYPE) {
      for (const observation of observePiSubagentExit(message.details)) {
        if (observation.kind !== "status") continue;
        observations.push(observation);
        lastStatus.set(observation.id, observation.status);
      }
    }
  }

  // lastStatus only holds ids that produced a status-carrying observation; declared ids
  // were seeded with "running" at their launch record.
  if (options?.closeRunningAsCanceled) {
    for (const [id, status] of lastStatus) {
      if (status === "running") {
        observations.push({ kind: "status", id, status: "canceled" });
      }
    }
  }

  return { observations, sessionPointers };
}

export function replayPiSubagentObservations(
  messages: readonly PiAgentMessage[],
  options?: { closeRunningAsCanceled?: boolean },
): SubagentObservation[] {
  return replayPiSubagentSession(messages, options).observations;
}

/**
 * Child session pointers per subagent id, from the same single transcript pass as the
 * observations: launch records (pi-subagent >= 0.18) and record details (subagent_status /
 * subagent_stop results, exit messages) both carry them. Later origins win — the exit
 * record's sessionFile is the most precise form. Older transcripts have no pointer; timeline
 * rebuild then degrades to the pre-115 behavior (no timeline, descriptor closed out as
 * canceled by the replay sweep).
 */
export function replayPiSubagentSessionPointers(
  messages: readonly PiAgentMessage[],
): Map<string, PiSubagentSessionPointer> {
  return replayPiSubagentSession(messages).sessionPointers;
}
