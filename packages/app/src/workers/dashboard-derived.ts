import type { AggregatedWorkerTask, WorkerTaskState } from "@/workers/aggregated-workers";

/**
 * Dashboard projections over the worker task list.
 *
 * Kept pure and separate from the screen so the counts can be tested without a
 * renderer, and so the definition of each bucket lives in one place. An operator
 * reading "Action required" and a test asserting it must mean the same thing.
 */

export interface WorkerTaskCounts {
  total: number;
  active: number;
  actionRequired: number;
  ended: number;
}

/**
 * States that mean the task is still moving. `revision` and `blocked` are
 * terminal by design (the follow-up is a new task), so they are not active.
 */
const ACTIVE_STATES: ReadonlySet<WorkerTaskState> = new Set<WorkerTaskState>([
  "planned",
  "prepared",
  "assigned",
  "in_progress",
]);

/**
 * States where a person is the one holding things up.
 *
 * `submitted` is work waiting to be accepted or sent back — the queue the
 * dashboard exists to surface. `blocked` is here too: the worker stopped and
 * said so, which needs a person to clear it. `planned` and `prepared` are not:
 * nobody has been asked to do anything yet.
 */
const ACTION_REQUIRED_STATES: ReadonlySet<WorkerTaskState> = new Set<WorkerTaskState>([
  "submitted",
  "blocked",
]);

const ENDED_STATES: ReadonlySet<WorkerTaskState> = new Set<WorkerTaskState>([
  "completed",
  "revision",
  "blocked",
  "cancelled",
]);

export function countWorkerTasks(tasks: readonly AggregatedWorkerTask[]): WorkerTaskCounts {
  let active = 0;
  let actionRequired = 0;
  let ended = 0;
  for (const task of tasks) {
    if (ACTIVE_STATES.has(task.state)) active += 1;
    if (ACTION_REQUIRED_STATES.has(task.state)) actionRequired += 1;
    if (ENDED_STATES.has(task.state)) ended += 1;
  }
  return { total: tasks.length, active, actionRequired, ended };
}

/**
 * Tasks waiting on a person, most recent first.
 *
 * `submitted` and `blocked` are split because the response differs: one is a
 * result to review, the other is a problem to unblock.
 */
export function selectAttentionTasks(tasks: readonly AggregatedWorkerTask[]): {
  review: AggregatedWorkerTask[];
  unblock: AggregatedWorkerTask[];
} {
  const review: AggregatedWorkerTask[] = [];
  const unblock: AggregatedWorkerTask[] = [];
  for (const task of tasks) {
    if (task.state === "submitted") review.push(task);
    else if (task.state === "blocked") unblock.push(task);
  }
  const byRecency = (a: AggregatedWorkerTask, b: AggregatedWorkerTask) =>
    b.updatedAt.localeCompare(a.updatedAt);
  return { review: review.sort(byRecency), unblock: unblock.sort(byRecency) };
}

/**
 * The line under the stat row.
 *
 * Says what the roster is doing rather than restating the counts, and never
 * claims work is happening when nothing is assigned.
 */
export function describeRosterActivity(counts: WorkerTaskCounts): string {
  if (counts.total === 0) return "No work has been handed out yet";
  if (counts.active === 0 && counts.actionRequired > 0) return "Waiting on you";
  if (counts.active === 0) return "The workers are idle";
  return `${counts.active} task${counts.active === 1 ? "" : "s"} in flight`;
}
