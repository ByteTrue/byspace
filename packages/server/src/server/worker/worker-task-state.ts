/**
 * Worker task states and the one table that governs how they change.
 *
 * Every worker task status change goes through this table. The point is that
 * legality lives in data, not in per-call-site checks: when transitions were
 * validated at each caller, guards drifted (one path allowed `planned ->
 * in_progress`, another required an acknowledgement first) and no history was
 * written. Add states and edges here, not at the call site.
 *
 * Borrowed shape from AgentTeams' TeamHarness task transition engine
 * (Apache-2.0); see byissue/epics/004-o-worker-domain/.
 */

export const WORKER_TASK_STATES = [
  "planned",
  "prepared",
  "assigned",
  "in_progress",
  "submitted",
  "completed",
  "revision",
  "blocked",
  "cancelled",
] as const;

export type WorkerTaskState = (typeof WORKER_TASK_STATES)[number];

/**
 * States a task cannot leave. `revision` and `blocked` are terminal because the
 * follow-up work is a new task; reopening them in place would make "is this task
 * done" unanswerable from the row alone.
 */
export const WORKER_TASK_TERMINAL_STATES: readonly WorkerTaskState[] = [
  "completed",
  "revision",
  "blocked",
  "cancelled",
];

const TRANSITIONS: Record<WorkerTaskState, readonly WorkerTaskState[]> = {
  planned: ["prepared", "assigned", "in_progress", "submitted", "cancelled"],
  prepared: ["assigned", "cancelled"],
  assigned: ["in_progress", "submitted", "blocked", "cancelled"],
  // `blocked` is reachable from the states a run starts in, not only from
  // `submitted`. A run that fails, or that stops for a permission decision, never
  // produced a result to submit, so requiring it to pass through `submitted`
  // would mean recording a submission that did not happen.
  in_progress: ["submitted", "blocked", "cancelled"],
  submitted: ["completed", "revision", "blocked", "cancelled"],
  completed: [],
  revision: [],
  blocked: [],
  cancelled: [],
};

/** The action that moves a task along each edge, used in history and in errors. */
export const WORKER_TASK_ACTIONS = [
  "plan_task",
  "prepare_task",
  "assign_task",
  "ack_task",
  "submit_task",
  "accept_task_result",
  "request_revision",
  "block_task",
  "cancel_task",
  "report_progress",
] as const;

export type WorkerTaskAction = (typeof WORKER_TASK_ACTIONS)[number];

export function isTerminalWorkerTaskState(state: WorkerTaskState): boolean {
  return WORKER_TASK_TERMINAL_STATES.includes(state);
}

export function allowedNextStates(from: WorkerTaskState): readonly WorkerTaskState[] {
  return TRANSITIONS[from];
}

/**
 * Whether `from -> to` is a permitted move.
 *
 * A same-state move is permitted and is a no-op: deliveries are retried, and a
 * retry that finds the task already in the target state must not fail. The table
 * deliberately omits self-edges so it stays a map of real changes; the identity
 * case is handled here and callers must not write history for it.
 */
export function canTransition(from: WorkerTaskState, to: WorkerTaskState): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

/** True when the move changes nothing and therefore must not record history. */
export function isNoOpTransition(from: WorkerTaskState, to: WorkerTaskState): boolean {
  return from === to;
}

/**
 * The action that legitimately produces `to` from `from`, if any. Used to tell
 * the caller what to do instead of only refusing them.
 */
export function suggestedAction(
  from: WorkerTaskState,
  to: WorkerTaskState,
): WorkerTaskAction | null {
  switch (`${from}->${to}`) {
    case "planned->prepared":
      return "prepare_task";
    case "planned->assigned":
    case "prepared->assigned":
      return "assign_task";
    case "planned->in_progress":
    case "assigned->in_progress":
      return "ack_task";
    case "planned->submitted":
    case "assigned->submitted":
    case "in_progress->submitted":
      return "submit_task";
    case "submitted->completed":
      return "accept_task_result";
    case "submitted->revision":
      return "request_revision";
    case "submitted->blocked":
    case "assigned->blocked":
    case "in_progress->blocked":
      return "block_task";
    default:
      return to === "cancelled" ? "cancel_task" : null;
  }
}

/** A rejected transition. Carries both the reason and the way forward. */
export class IllegalWorkerTaskTransitionError extends Error {
  readonly from: WorkerTaskState;
  readonly to: WorkerTaskState;

  constructor(from: WorkerTaskState, to: WorkerTaskState) {
    const next = allowedNextStates(from);
    const hint =
      next.length === 0
        ? `'${from}' is terminal; create a new task instead`
        : `'${from}' can only move to ${next.map((s) => `'${s}'`).join(", ")}`;
    super(`Illegal worker task transition: '${from}' -> '${to}'. ${hint}.`);
    this.name = "IllegalWorkerTaskTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function assertWorkerTaskTransition(from: WorkerTaskState, to: WorkerTaskState): void {
  if (!canTransition(from, to)) {
    throw new IllegalWorkerTaskTransitionError(from, to);
  }
}
/**
 * A rejected action/transition pairing.
 *
 * The state graph says an edge is legal; this says the recorded action is not
 * the one that produces it. Without this check the history is user-supplied
 * text that merely accompanies a state change, which is not an audit trail.
 */
export class WorkerTaskActionMismatchError extends Error {
  readonly from: WorkerTaskState;
  readonly to: WorkerTaskState;
  readonly action: string;

  constructor(from: WorkerTaskState, to: WorkerTaskState, action: string, expected: string) {
    super(
      `Action '${action}' does not move a worker task from '${from}' to '${to}'. ` +
        `Expected '${expected}'.`,
    );
    this.name = "WorkerTaskActionMismatchError";
    this.from = from;
    this.to = to;
    this.action = action;
  }
}

/**
 * Check that `action` is the action that legitimately produces a state change.
 *
 * Only state-changing moves are judged here. A same-state move is a retry or a
 * progress note, and deciding whether a given action is a legitimate retry
 * requires the task's history, so the store answers that question.
 */
export function assertActionMatchesTransition(
  from: WorkerTaskState,
  to: WorkerTaskState,
  action: WorkerTaskAction,
): void {
  if (from === to) return;
  const expected = suggestedAction(from, to);
  if (expected === null || expected !== action) {
    throw new WorkerTaskActionMismatchError(from, to, action, expected ?? "(none)");
  }
}

/**
 * Progress reports do not change state; they record that the task is still
 * moving. Modelled as a same-state entry so the history stays one shape.
 */
export const WORKER_TASK_PROGRESS_ACTION: WorkerTaskAction = "report_progress";

export const WORKER_TASK_PROGRESS_NOTE_MAX_LENGTH = 200;

export function canReportProgress(state: WorkerTaskState): boolean {
  return state === "assigned" || state === "in_progress";
}
