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
 *
 * A child launched from inside a codemode script (`tools.subagent(...)`) has no launch record
 * in the transcript at all — pi persists a nested call only as arguments on the parent's result
 * — so `replayPiSubagentSession` names it from its task records (see `declarationFromRecord`).
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

/** Exit custom messages carry one record, or an array when several children finished before
 * the extension could deliver the notification (its exit-batch path). */
function recordList(details: unknown): unknown[] {
  return Array.isArray(details) ? details : [details];
}

export function observePiSubagentExit(details: unknown): SubagentObservation[] {
  return recordList(details)
    .map((entry) => observePiSubagentRecord(entry))
    .filter((observation): observation is SubagentObservation => observation !== null);
}

/**
 * The declaration a task record states about its own child: the subagent type and the
 * extension's one-line task summary, for a child the transcript never declared through a launch
 * record. That is the norm for a subagent pi launched from inside a codemode script, where the
 * nested call survives only as arguments on the parent's result. The live stream reads those
 * children off the `tool_execution_*` events a codemode run emits, which the transcript drops;
 * the replay has nothing but the records.
 *
 * The summary is the extension's own wording (60 characters, prefixed with the agent), not the
 * full task text a launch record carries — a row named this way still beats the nameless row the
 * replay would otherwise leave behind.
 */
function declarationFromRecord(details: unknown): SubagentObservation | null {
  const record = parsePiSubagentRecordDetails(details);
  if (!record) {
    return null;
  }
  const title = readStringArg(record.agent);
  const description = readStringArg(record.description);
  if (!title && !description) {
    return null;
  }
  return {
    kind: "declared",
    id: record.id,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
  };
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

/** Accumulator of the single transcript pass, one field per derived fact. */
interface MutableReplay {
  observations: SubagentObservation[];
  sessionPointers: Map<string, PiSubagentSessionPointer>;
  pendingLaunches: Map<string, { name: string; args: unknown }>;
  /**
   * Last status observation seen per subagent id, in transcript order — the sweep's input. Keyed
   * by id, so a later record overwrites an earlier one and only the final word counts.
   */
  lastStatus: Map<string, ProviderSubagentStatus>;
  /**
   * Ids that already carry a name. A launch stating neither `agent` nor `task` — the legacy
   * `{ tasks: [...] }` argument shape, or details without a description — does not join this
   * set, so a later record can still name the child.
   */
  declared: Set<string>;
}

/**
 * Name an id from its own record, once, and only where nothing named it yet. A record's one-liner
 * is shorter than a launch's task text, so a named launch wins when both exist.
 */
function declareFromRecord(replay: MutableReplay, details: unknown): void {
  const declaration = declarationFromRecord(details);
  if (!declaration || replay.declared.has(declaration.id)) {
    return;
  }
  replay.declared.add(declaration.id);
  replay.observations.push(declaration);
}

/** Launch and record tool results: both absorb the pointer, and each names its child the way
 * its own payload knows how — the launch from the call arguments, a record from its fields. */
function applyToolResultMessage(
  replay: MutableReplay,
  message: Extract<PiAgentMessage, { role: "toolResult" }>,
): void {
  const launch = replay.pendingLaunches.get(message.toolCallId);
  replay.pendingLaunches.delete(message.toolCallId);
  if (!launch) {
    return;
  }
  // Launch and record results both carry the pointer; one parse covers both.
  absorbSessionPointer(replay.sessionPointers, message.details);
  if (launch.name === PI_SUBAGENT_LAUNCH_TOOL) {
    const observation = observePiSubagentLaunch({
      toolCallId: message.toolCallId,
      args: launch.args,
      details: message.details,
    });
    if (observation) {
      // Only a launch that actually states a name blocks the record fallback. An anonymous one
      // (legacy `tasks[]` arguments, or details without a description) must not, or the child
      // stays nameless for good — the very bug this replay path exists to fix.
      if (observation.kind === "declared" && (observation.title || observation.description)) {
        replay.declared.add(observation.id);
      }
      replay.observations.push(observation);
      replay.lastStatus.set(observation.id, "running");
    }
    return;
  }
  applyRecord(replay, message.details);
}

/**
 * One full task record: name the child if nothing has yet, then report its status.
 *
 * A record with a name but a status this provider does not map (a future pi-subagent state)
 * declares nothing, on purpose. A `declared` folds to `status: "running"`, so declaring a
 * child the record itself says has finished would drag it back to running and pin the track's
 * "N working" pill — the failure issue 071 fixed. Losing the name is the smaller harm.
 */
function applyRecord(replay: MutableReplay, details: unknown): void {
  const observation = observePiSubagentRecord(details);
  if (observation?.kind !== "status") {
    return;
  }
  declareFromRecord(replay, details);
  replay.observations.push(observation);
  replay.lastStatus.set(observation.id, observation.status);
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
  const replay: MutableReplay = {
    observations: [],
    sessionPointers: new Map(),
    pendingLaunches: new Map(),
    lastStatus: new Map(),
    declared: new Set(),
  };

  for (const message of messages) {
    if (message.role === "assistant") {
      for (const content of message.content) {
        if (content.type === "toolCall" && isPiSubagentToolName(content.name)) {
          replay.pendingLaunches.set(content.id, {
            name: content.name,
            args: content.arguments,
          });
        }
      }
      continue;
    }
    if (message.role === "toolResult") {
      applyToolResultMessage(replay, message);
      continue;
    }
    if (message.role === "custom" && message.customType === PI_SUBAGENT_EXIT_CUSTOM_TYPE) {
      for (const record of recordList(message.details)) {
        // The exit record is also where a child's session pointer lives, and for a
        // codemode-nested launch it is the only origin that carries one.
        absorbSessionPointer(replay.sessionPointers, record);
        applyRecord(replay, record);
      }
    }
  }

  // lastStatus only holds ids that produced a status-carrying observation; declared ids
  // were seeded with "running" at their launch record.
  if (options?.closeRunningAsCanceled) {
    for (const [id, status] of replay.lastStatus) {
      if (status === "running") {
        replay.observations.push({ kind: "status", id, status: "canceled" });
      }
    }
  }

  return { observations: replay.observations, sessionPointers: replay.sessionPointers };
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
