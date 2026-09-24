import type {
  AggregatedWorker,
  AggregatedWorkerGroup,
  AggregatedWorkerTask,
  WorkerTaskState,
} from "@/workers/aggregated-workers";

/**
 * Turning a group's raw state into the report a person reads.
 *
 * The reference product's delivery contract puts several obligations on the
 * coordinator: say what work was divided up before handing it out, report
 * material progress without being asked, and on completion report the result,
 * the evidence, the unresolved issues and the next step. Those are all readable
 * from state the group already has, so this module derives them rather than
 * asking a coordinator to write a summary a person would have to trust.
 *
 * Everything here is pure, so what "done" and "waiting on you" mean is defined
 * once and tested without a renderer.
 */

/** How far along a group's actual work is. */
export type GroupProgress =
  | { kind: "no-goal"; headline: string; detail: string }
  | { kind: "not-started"; headline: string; detail: string }
  | { kind: "working"; headline: string; detail: string }
  | { kind: "waiting-on-you"; headline: string; detail: string }
  | { kind: "delivered"; headline: string; detail: string }
  | { kind: "delivered-with-issues"; headline: string; detail: string }
  | { kind: "stopped"; headline: string; detail: string };

/** One line of the group's work, for the report's task list. */
export interface GroupWorkItem {
  taskId: string;
  workerId: string;
  workerName: string | null;
  title: string;
  state: WorkerTaskState;
  /** The session this task ran in, so the report can open its conversation. */
  agentId: string | null;
}

export interface GroupReport {
  groupId: string;
  serverId: string;
  name: string;
  projectId: string;
  objective: string | null;
  progress: GroupProgress;
  /** Public messages spent against the current attempt's budget. */
  budgetUsed: number;
  budgetLimit: number | null;
  /** Null when the group has no goal, so an unset budget is not shown as zero. */
  budgetLine: string | null;
  coordinatorName: string | null;
  members: { workerId: string; name: string | null; role: string; isCoordinator: boolean }[];
  work: GroupWorkItem[];
}

/** States that mean the work is still moving. */
const ACTIVE_STATES: ReadonlySet<WorkerTaskState> = new Set<WorkerTaskState>([
  "planned",
  "prepared",
  "assigned",
  "in_progress",
]);

/**
 * States a person has to move.
 *
 * `submitted` is a result to review; `blocked` is a problem to clear. Both are
 * the group telling the human it needs them, which is why they outrank
 * "working" in the headline: silence about a block is the failure this view
 * exists to prevent.
 */
const NEEDS_PERSON_STATES: ReadonlySet<WorkerTaskState> = new Set<WorkerTaskState>([
  "submitted",
  "blocked",
  "revision",
]);

const UNRESOLVED_STATES: ReadonlySet<WorkerTaskState> = new Set<WorkerTaskState>([
  "blocked",
  "revision",
]);

/**
 * A counted noun with its verb agreeing.
 *
 * Returns the whole phrase because English ties the verb to the count: "1 task
 * needs" versus "2 tasks need". Leaving the caller to add the verb produced
 * "1 task need".
 */
function countWithVerb(
  count: number,
  noun: string,
  singularVerb: string,
  pluralVerb: string,
): string {
  const label = `${count} ${noun}${count === 1 ? "" : "s"}`;
  return `${label} ${count === 1 ? singularVerb : pluralVerb}`;
}

/**
 * What the group's work amounts to, in one line.
 *
 * The order of the checks is the order of what a person should do about it:
 * a goal that does not exist is the most fundamental problem, then work
 * waiting on a person, then work in flight, then the outcome.
 */
export function deriveGroupProgress(input: {
  hasGoal: boolean;
  goalStatus: "active" | "completed" | "paused" | null;
  pauseReason: string | null;
  tasks: readonly GroupWorkItem[];
}): GroupProgress {
  const tasks = input.tasks;
  const active = tasks.filter((task) => ACTIVE_STATES.has(task.state)).length;
  const needsPerson = tasks.filter((task) => NEEDS_PERSON_STATES.has(task.state)).length;
  const unresolved = tasks.filter((task) => UNRESOLVED_STATES.has(task.state)).length;

  if (!input.hasGoal) {
    return {
      kind: "no-goal",
      headline: "No objective set",
      // The roster can exist before the objective; saying so beats an empty
      // report that looks like nothing is happening.
      detail:
        tasks.length === 0
          ? "This group has no goal yet, so there is nothing to report."
          : `${countWithVerb(tasks.length, "task", "is", "are")} assigned with no goal to judge ${tasks.length === 1 ? "it" : "them"} against.`,
    };
  }

  if (input.goalStatus === "completed") {
    if (unresolved > 0) {
      return {
        kind: "delivered-with-issues",
        headline: "Delivered, with open issues",
        detail: `${countWithVerb(unresolved, "task", "ended", "ended")} blocked or sent back. The result is in, but ${unresolved === 1 ? "it was" : "these were"} not resolved.`,
      };
    }
    return {
      kind: "delivered",
      headline: "Delivered",
      detail: "The objective is complete and nothing is left unresolved.",
    };
  }

  if (input.goalStatus === "paused") {
    return {
      kind: "stopped",
      headline: "Stopped",
      detail: `Automatic work is paused (${input.pauseReason ?? "no reason given"}).`,
    };
  }

  if (needsPerson > 0) {
    return {
      kind: "waiting-on-you",
      headline: "Waiting on you",
      detail: `${countWithVerb(needsPerson, "task", "needs", "need")} a decision before the group can continue.`,
    };
  }

  if (tasks.length === 0) {
    return {
      kind: "not-started",
      headline: "Nothing handed out yet",
      detail: "The goal is set, but no work has been assigned.",
    };
  }

  return {
    kind: "working",
    headline: "In progress",
    detail:
      active > 0
        ? `${countWithVerb(active, "task", "is", "are")} in flight.`
        : "No task is in flight; the group may be between steps.",
  };
}

/**
 * The group's budget line.
 *
 * Deliberately silent when the group has no goal: a group without an objective
 * has no budget, and "0 of 0" would read as an exhausted one rather than an
 * absent one.
 */
export function describeGroupBudget(input: {
  hasGoal: boolean;
  turnUsed: number;
  turnLimit: number | null;
}): string | null {
  if (!input.hasGoal || input.turnLimit === null) return null;
  const remaining = input.turnLimit - input.turnUsed;
  if (remaining <= 0) {
    return `Budget spent: ${input.turnUsed} of ${input.turnLimit} public messages`;
  }
  return `${input.turnUsed} of ${input.turnLimit} public messages used, ${remaining} left`;
}

/**
 * A group's tasks, in the order a person reads them: things needing them first,
 * then work in flight, then what has ended.
 *
 * Sorting by state rank rather than by time means the report's top line is
 * always the thing most worth acting on, however recently the other tasks moved.
 */
export function orderGroupWork(tasks: readonly GroupWorkItem[]): GroupWorkItem[] {
  const rank = (state: WorkerTaskState): number => {
    if (NEEDS_PERSON_STATES.has(state)) return 0;
    if (ACTIVE_STATES.has(state)) return 1;
    if (state === "completed") return 2;
    return 3;
  };
  return [...tasks].sort((a, b) => rank(a.state) - rank(b.state));
}

/** Everything the report screen needs for one group, from data already loaded. */
export function buildGroupReport(input: {
  group: AggregatedWorkerGroup;
  workers: readonly AggregatedWorker[];
  tasks: readonly AggregatedWorkerTask[];
}): GroupReport {
  const { group } = input;
  const nameById = new Map<string, string>();
  for (const worker of input.workers) {
    if (worker.serverId === group.serverId) nameById.set(worker.id, worker.name);
  }

  // Tasks carry their host, so the group's slice is its own host's tasks for its
  // own members. Filtering by member rather than by project avoids attributing
  // unrelated work on the same project to this group.
  const memberIds = new Set(group.members.map((member) => member.workerId));
  const work: GroupWorkItem[] = orderGroupWork(
    input.tasks
      .filter((task) => task.serverId === group.serverId && memberIds.has(task.workerId))
      .map((task) => ({
        taskId: task.taskId,
        workerId: task.workerId,
        workerName: nameById.get(task.workerId) ?? null,
        title: task.title,
        state: task.state,
        agentId: task.agentId,
      })),
  );

  const coordinator = group.members.find((member) => member.role === "coordinator") ?? null;
  const hasGoal = group.goal !== null;

  return {
    groupId: group.id,
    serverId: group.serverId,
    name: group.name,
    projectId: group.projectId,
    objective: group.goal?.content ?? null,
    progress: deriveGroupProgress({
      hasGoal,
      goalStatus: group.goal?.status ?? null,
      pauseReason: group.goal?.pauseReason ?? null,
      tasks: work,
    }),
    budgetUsed: group.goal?.turnUsed ?? 0,
    budgetLimit: group.goal?.turnLimit ?? null,
    budgetLine: describeGroupBudget({
      hasGoal,
      turnUsed: group.goal?.turnUsed ?? 0,
      turnLimit: group.goal?.turnLimit ?? null,
    }),
    coordinatorName: coordinator ? (nameById.get(coordinator.workerId) ?? null) : null,
    members: group.members.map((member) => ({
      workerId: member.workerId,
      name: nameById.get(member.workerId) ?? null,
      role: member.role,
      isCoordinator: member.role === "coordinator",
    })),
    work,
  };
}
