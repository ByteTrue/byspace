import type { Command } from "commander";
import type {
  CommandError,
  CommandOptions,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";
import { buildDaemonConnectionCommandError, connectToDaemon } from "../../utils/client.js";

export interface WorkerGoalRow {
  goalId: string;
  status: string;
  /** `generation.revision`, both of which a mutation must echo back. */
  generation: string;
  budget: string;
  content: string;
}

export const workerGoalSchema: OutputSchema<WorkerGoalRow> = {
  idField: "goalId",
  columns: [
    { header: "GOAL ID", field: "goalId", width: 20 },
    { header: "STATUS", field: "status", width: 10 },
    { header: "VERSION", field: "generation", width: 10 },
    { header: "BUDGET", field: "budget", width: 10 },
    { header: "OBJECTIVE", field: "content", width: 44 },
  ],
};

interface GoalLike {
  goalId: string;
  content: string;
  turnLimit: number;
  turnUsed: number;
  status: string;
  generation: number;
  revision: number;
}

/**
 * Version reads as `generation.revision` because both are needed to write:
 * generation says which attempt, revision says which change to it.
 */
function toGoalRow(goal: GoalLike): WorkerGoalRow {
  return {
    goalId: goal.goalId,
    status: goal.status,
    generation: `${goal.generation}.${goal.revision}`,
    budget: `${goal.turnUsed}/${goal.turnLimit}`,
    content: goal.content,
  };
}

const PAUSE_REASONS = [
  "user_stop",
  "awaiting_user",
  "turn_limit",
  "no_progress",
  "execution_error",
  "leader_unavailable",
] as const;

export interface GoalGetOptions extends CommandOptions {
  groupId?: string;
}

export async function runGoalGetCommand(
  options: GoalGetOptions,
  _command: Command,
): Promise<SingleResult<WorkerGoalRow>> {
  const groupId = options.groupId?.trim();
  if (!groupId) {
    throw { code: "MISSING_GROUP_ID", message: "--group-id is required" } satisfies CommandError;
  }

  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });

  try {
    const payload = await client.getWorkerGoal(groupId);
    if (!payload.goal) {
      throw {
        code: "WORKER_GOAL_NOT_SET",
        message: `Group ${groupId} has no goal yet`,
        details: "Set one with: byspace worker goal create",
      } satisfies CommandError;
    }
    return { type: "single", data: toGoalRow(payload.goal), schema: workerGoalSchema };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export interface GoalCreateOptions extends CommandOptions {
  groupId?: string;
  content?: string;
  turnLimit?: string;
}

export async function runGoalCreateCommand(
  options: GoalCreateOptions,
  _command: Command,
): Promise<SingleResult<WorkerGoalRow>> {
  const groupId = options.groupId?.trim();
  if (!groupId) {
    throw { code: "MISSING_GROUP_ID", message: "--group-id is required" } satisfies CommandError;
  }
  const content = options.content?.trim();
  if (!content) {
    throw { code: "MISSING_CONTENT", message: "--content is required" } satisfies CommandError;
  }
  const turnLimit = parseTurnLimit(options.turnLimit);

  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });

  try {
    const payload = await client.createWorkerGoal({ groupId, content, turnLimit });
    return { type: "single", data: toGoalRow(payload.goal), schema: workerGoalSchema };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw { code: "WORKER_GOAL_CREATE_FAILED", message } satisfies CommandError;
  } finally {
    await client.close().catch(() => undefined);
  }
}

function parseTurnLimit(raw: string | undefined): number {
  if (raw === undefined) {
    throw {
      code: "MISSING_TURN_LIMIT",
      message: "--turn-limit is required",
      details: "The budget bounds how many public messages the group may spend.",
    } satisfies CommandError;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value)) {
    throw {
      code: "INVALID_TURN_LIMIT",
      message: "--turn-limit must be an integer",
    } satisfies CommandError;
  }
  return value;
}

export interface GoalMutateOptions extends CommandOptions {
  groupId?: string;
  action?: string;
  goalId?: string;
  generation?: string;
  revision?: string;
  content?: string;
  turnLimit?: string;
  reason?: string;
  resultMessage?: string;
}

/**
 * Change a goal.
 *
 * `--generation` and `--revision` are required and must be what `goal get`
 * returned: a mutation written against a state that has since changed is
 * refused, so the caller reads again instead of overwriting someone else's
 * decision. Pause reasons come from a fixed set upstream; an unknown one is
 * rejected here rather than silently stored.
 */
export async function runGoalMutateCommand(
  options: GoalMutateOptions,
  _command: Command,
): Promise<SingleResult<WorkerGoalRow>> {
  const groupId = options.groupId?.trim();
  if (!groupId) {
    throw { code: "MISSING_GROUP_ID", message: "--group-id is required" } satisfies CommandError;
  }
  const action = options.action?.trim();
  if (!action) {
    throw { code: "MISSING_ACTION", message: "--action is required" } satisfies CommandError;
  }
  if (action === "create") {
    throw {
      code: "USE_GOAL_CREATE",
      message: "Creating a goal is its own command",
      details: "Use: byspace worker goal create --group-id <id> --content <text> --turn-limit <n>",
    } satisfies CommandError;
  }
  if (!["update", "complete", "pause", "reopen"].includes(action)) {
    throw {
      code: "UNKNOWN_GOAL_ACTION",
      message: `Unknown action: ${action}`,
      details: "Supported actions: update, complete, pause, reopen",
    } satisfies CommandError;
  }

  const generation = requireInteger(options.generation, "--generation");
  const revision = requireInteger(options.revision, "--revision");

  if (
    options.reason !== undefined &&
    !(PAUSE_REASONS as readonly string[]).includes(options.reason)
  ) {
    throw {
      code: "UNKNOWN_PAUSE_REASON",
      message: `Unknown pause reason: ${options.reason}`,
      details: `Supported reasons: ${PAUSE_REASONS.join(", ")}`,
    } satisfies CommandError;
  }

  const turnLimit = options.turnLimit === undefined ? undefined : parseTurnLimit(options.turnLimit);

  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });

  try {
    const payload = await client.mutateWorkerGoal({
      groupId,
      action: action as "update" | "complete" | "pause" | "reopen",
      expectedGeneration: generation,
      expectedRevision: revision,
      ...(options.content !== undefined ? { content: options.content } : {}),
      ...(turnLimit !== undefined ? { turnLimit } : {}),
      ...(options.reason !== undefined ? { pauseReason: options.reason as never } : {}),
      ...(options.resultMessage !== undefined ? { resultMessageId: options.resultMessage } : {}),
    });
    return { type: "single", data: toGoalRow(payload.goal), schema: workerGoalSchema };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw { code: "WORKER_GOAL_MUTATE_FAILED", message } satisfies CommandError;
  } finally {
    await client.close().catch(() => undefined);
  }
}

function requireInteger(raw: string | undefined, flag: string): number {
  if (raw === undefined) {
    throw {
      code: "MISSING_VERSION",
      message: `${flag} is required`,
      details: "Read the goal first and pass the version it returned.",
    } satisfies CommandError;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value)) {
    throw { code: "INVALID_VERSION", message: `${flag} must be an integer` } satisfies CommandError;
  }
  return value;
}
