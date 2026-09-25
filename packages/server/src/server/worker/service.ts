/**
 * The worker domain's service surface.
 *
 * Owns the pieces the daemon needs to expose workers over RPC: the SQLite store
 * lifecycle, the role template catalog, and the tool guard. Kept free of
 * transport concerns so the same methods back RPCs, the CLI and tests.
 *
 * The store is opened lazily. A daemon that never touches workers should not
 * create a database file for them, and a daemon that cannot open one should
 * still start: existing session and terminal behaviour does not depend on this
 * domain.
 */
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type pino from "pino";

import type { WorkerTemplateSummary } from "@bytetrue/protocol/worker/rpc-schemas";

import { resolveBySpaceHome } from "../byspace-home.js";
import {
  WorkerStore,
  resolveWorkerDatabasePath,
  type MutateWorkerGoalInput,
  type WorkerGoalRecord,
  type WorkerGroupMemberRecord,
  type WorkerGroupMemberRole,
  type WorkerGroupRecord,
  type WorkerInboxEntry,
  type WorkerMessageDeliveryPolicy,
  type WorkerMessageDeliveryState,
  type WorkerMessageIntent,
  type WorkerMessageRecord,
  type WorkerRecord,
  type WorkerTaskHistoryEntry,
  type WorkerTaskRecord,
} from "./worker-store.js";
import { WORKER_TASK_ACTIONS, type WorkerTaskAction } from "./worker-task-state.js";
import type { WorkerRunner } from "./worker-runner.js";
import { buildWakePrompt } from "./worker-wake-prompt.js";
import {
  listWorkerTemplateIds,
  loadWorkerTemplate,
  resolveWorkerTemplateRoot,
  type WorkerTemplate,
} from "./worker-template.js";
import {
  DEFAULT_SHELL_TOOL_NAMES,
  evaluateToolCall,
  loadGuardRules,
  type GuardFinding,
  type GuardDecision,
  type GuardRule,
  type GuardSeverity,
} from "./tool-guard/tool-guard.js";

export interface WorkerGuardVerdict {
  decision: GuardDecision;
  maxSeverity: GuardSeverity | null;
  findings: GuardFinding[];
}

export class WorkerTemplateUnknownError extends Error {
  constructor(templateId: string, known: readonly string[]) {
    super(`Unknown worker template '${templateId}'. Available: ${known.join(", ") || "(none)"}.`);
    this.name = "WorkerTemplateUnknownError";
  }
}

export class WorkerNotFoundError extends Error {
  constructor(workerId: string) {
    super(`Unknown worker: ${workerId}`);
    this.name = "WorkerNotFoundError";
  }
}

export class WorkerTaskNotFoundError extends Error {
  constructor(taskId: string) {
    super(`Unknown worker task: ${taskId}`);
    this.name = "WorkerTaskNotFoundError";
  }
}

/**
 * A session asked to speak for a worker and no run authorises it.
 *
 * The message names what to do about it rather than only what failed, because
 * the common cause is a worker running a CLI command outside a wake.
 */
export class WorkerSenderNotResolvableError extends Error {
  constructor(sessionId: string, state?: string) {
    super(
      state === undefined
        ? `Session ${sessionId} is not a worker run, so it cannot send as a worker. Worker commands run inside a wake.`
        : `Session ${sessionId} belongs to a ${state} run, which can no longer send. Worker commands run inside a wake.`,
    );
    this.name = "WorkerSenderNotResolvableError";
  }
}

/**
 * A worker already has work in flight.
 *
 * The bound is one task per worker, because a worker has one workspace: two runs
 * would be two sessions in the same directory, and neither result could be
 * attributed cleanly. Refusing is also what makes "the same work is not handed
 * out twice" true rather than merely intended.
 */
export class WorkerBusyError extends Error {
  constructor(workerId: string) {
    super(
      `Worker ${workerId} is already working on a task. Wait for it to settle, or cancel that task first.`,
    );
    this.name = "WorkerBusyError";
  }
}

export class WorkerRunUnavailableError extends Error {
  constructor() {
    super("This daemon was started without a worker runner, so tasks cannot be run.");
    this.name = "WorkerRunUnavailableError";
  }
}

export class WorkerGroupNotFoundError extends Error {
  constructor(groupId: string) {
    super(`Unknown worker group: ${groupId}`);
    this.name = "WorkerGroupNotFoundError";
  }
}

export class WorkerTaskActionUnknownError extends Error {
  constructor(action: string) {
    super(`Unknown worker task action '${action}'. Known: ${WORKER_TASK_ACTIONS.join(", ")}.`);
    this.name = "WorkerTaskActionUnknownError";
  }
}

export interface WorkerServiceOptions {
  byspaceHome?: string;
  templateRoot?: string;
  databasePath?: string;
  logger: pino.Logger;
  /**
   * Runs a task's agent session. Optional so the store, catalog and guard remain
   * usable without an execution path (the CLI and tests do exactly that);
   * `runTask` reports a clear refusal when it is absent rather than pretending
   * to have run something.
   */
  runner?: WorkerRunner;
  /**
   * Called after a send that woke somebody.
   *
   * The wake loop also runs on a timer, so this is latency rather than
   * correctness: without it a message waits up to one tick before its recipient
   * is started at all.
   */
  onWakeRequested?: () => void;
}

export interface CreateWorkerInput {
  name: string;
  templateId: string;
  workspacePath?: string;
}

/**
 * Narrow a wire-supplied action string to the known set.
 *
 * The wire carries a plain string because the protocol must not reject an
 * action a newer client invents; the store still refuses anything it does not
 * recognise, and this turns that refusal into a message naming the valid set.
 */
function narrowTaskAction(action: string): WorkerTaskAction {
  if ((WORKER_TASK_ACTIONS as readonly string[]).includes(action)) {
    return action as WorkerTaskAction;
  }
  throw new WorkerTaskActionUnknownError(action);
}

export class WorkerService {
  private readonly byspaceHome: string;
  private readonly templateRoot: string;
  private readonly databasePath: string;
  private readonly logger: pino.Logger;
  private readonly runner: WorkerRunner | null;
  private readonly onWakeRequested: (() => void) | null;
  private store: WorkerStore | null = null;
  private rules: GuardRule[] | null = null;

  constructor(options: WorkerServiceOptions) {
    this.byspaceHome = options.byspaceHome ?? resolveBySpaceHome();
    this.templateRoot = options.templateRoot ?? resolveWorkerTemplateRoot();
    this.databasePath =
      options.databasePath ??
      resolveWorkerDatabasePath({
        databasePath: undefined,
        env: { BYSPACE_HOME: this.byspaceHome },
      });
    this.logger = options.logger;
    this.runner = options.runner ?? null;
    this.onWakeRequested = options.onWakeRequested ?? null;
  }

  /**
   * Tell the loop there may be work, if anything was actually woken.
   *
   * Only a send with a non-empty `woke` list asks. A store-only message wakes
   * nobody, and poking the loop for it would make every chat message cost a pass
   * over the candidate query.
   */
  private notifyWakes(woke: readonly string[]): void {
    if (woke.length === 0) return;
    this.onWakeRequested?.();
  }

  getStore(): WorkerStore {
    this.store ??= new WorkerStore({ databasePath: this.databasePath });
    return this.store;
  }

  close(): void {
    this.store?.close();
    this.store = null;
  }

  /** Guard rules, compiled once. Throws rather than running unguarded. */
  getGuardRules(): GuardRule[] {
    this.rules ??= loadGuardRules();
    return this.rules;
  }

  async listTemplates(): Promise<WorkerTemplateSummary[]> {
    const ids = await listWorkerTemplateIds(this.templateRoot);
    const templates: WorkerTemplateSummary[] = [];
    for (const id of ids) {
      const template = await loadWorkerTemplate(id, this.templateRoot);
      templates.push({
        id: template.id,
        title: template.title,
        description: template.description,
        skills: template.skills,
      });
    }
    return templates;
  }

  async loadTemplate(templateId: string): Promise<WorkerTemplate> {
    const ids = await listWorkerTemplateIds(this.templateRoot);
    if (!ids.includes(templateId)) {
      throw new WorkerTemplateUnknownError(templateId, ids);
    }
    return loadWorkerTemplate(templateId, this.templateRoot);
  }

  listWorkers(): WorkerRecord[] {
    return this.getStore().listWorkers();
  }

  getWorker(workerId: string): WorkerRecord {
    const worker = this.getStore().getWorker(workerId);
    if (!worker) throw new WorkerNotFoundError(workerId);
    return worker;
  }

  async createWorker(input: CreateWorkerInput): Promise<WorkerRecord> {
    // Validate the template first: a worker pointing at a role that does not
    // exist would assemble an empty prompt and run as a generic agent.
    await this.loadTemplate(input.templateId);

    const id = `wkr_${randomBytes(6).toString("hex")}`;
    const workspacePath =
      input.workspacePath ?? path.join(this.byspaceHome, "worker", "workers", id);
    await mkdir(workspacePath, { recursive: true });

    const now = new Date().toISOString();
    const worker: WorkerRecord = {
      id,
      name: input.name,
      templateId: input.templateId,
      workspacePath,
      status: "online",
      createdAt: now,
      updatedAt: now,
    };
    this.logger.info({ workerId: id, templateId: input.templateId }, "Created worker");
    return this.getStore().createWorker(worker);
  }

  /** A worker's daily activity, for the detail view's heatmap. */
  listTaskActivity(workerId: string): Array<{ day: string; count: number }> {
    this.getWorker(workerId);
    return this.getStore().listTaskActivityByDay(workerId);
  }

  listTasks(workerId: string): WorkerTaskRecord[] {
    this.getWorker(workerId);
    return this.getStore().listTasksForWorker(workerId);
  }

  /**
   * Every task, newest first, optionally narrowed to one worker.
   *
   * Sorted here rather than in the screen because the ordering is part of what
   * the list means ("most recent activity first"), and every consumer should
   * agree on it.
   */
  listAllTasks(workerId?: string): WorkerTaskRecord[] {
    if (workerId) return this.listTasks(workerId);
    return this.getStore().listAllTasks();
  }

  // ----------------------------------------------------------------- groups

  listGroups(): WorkerGroupRecord[] {
    return this.getStore().listGroups();
  }

  getGroup(groupId: string): WorkerGroupRecord {
    const group = this.getStore().getGroup(groupId);
    if (!group) throw new WorkerGroupNotFoundError(groupId);
    return group;
  }

  /**
   * Create a group on a project, optionally with its first members.
   *
   * Members are added after the group exists so a bad roster cannot leave a
   * half-made group behind: the caller either gets a group with the roster it
   * asked for, or nothing.
   */
  createGroup(input: {
    name: string;
    projectId: string;
    workspaceId?: string | null;
    coordinatorWorkerId?: string;
    memberWorkerIds?: readonly string[];
  }): WorkerGroupRecord {
    const id = `grp_${randomBytes(6).toString("hex")}`;
    const group = this.getStore().createGroup({
      id,
      name: input.name,
      projectId: input.projectId,
      workspaceId: input.workspaceId ?? null,
    });

    try {
      if (input.coordinatorWorkerId) {
        this.getStore().addGroupMember({
          groupId: id,
          workerId: input.coordinatorWorkerId,
          role: "coordinator",
        });
      }
      for (const workerId of input.memberWorkerIds ?? []) {
        if (workerId === input.coordinatorWorkerId) continue;
        this.getStore().addGroupMember({ groupId: id, workerId, role: "member" });
      }
    } catch (error) {
      // The group is not worth keeping if its roster was rejected.
      this.getStore().deleteGroup(id);
      throw error;
    }

    this.logger.info({ groupId: id, projectId: input.projectId }, "Created worker group");
    return group;
  }

  listGroupMembers(groupId: string): WorkerGroupMemberRecord[] {
    this.getGroup(groupId);
    return this.getStore().listGroupMembers(groupId);
  }

  addGroupMember(input: {
    groupId: string;
    workerId: string;
    role: WorkerGroupMemberRole;
  }): WorkerGroupMemberRecord {
    this.getGroup(input.groupId);
    return this.getStore().addGroupMember(input);
  }

  removeGroupMember(input: { groupId: string; workerId: string }): void {
    this.getGroup(input.groupId);
    this.getStore().removeGroupMember(input);
  }

  // --------------------------------------------------------------- messages

  /**
   * Record a message in a group's stream.
   *
   * Returns the message and, for a waking message, the workers it woke. The two
   * are returned together because a caller that sent a waking message needs to
   * know whether anyone was actually addressed: an audience of zero wakes
   * nobody, which looks identical to a successful send from the message alone.
   */
  /**
   * Resolve the worker speaking, from the session it is running in.
   *
   * The CLI knows its agent session id (injected at launch) and cannot know
   * which `wkr_` it is, so a message that carried a self-reported sender was
   * trusting a string the sender chose. This turns that string into a fact the
   * daemon checked.
   *
   * Two things authorise a session. A run is the daemon waking a worker to
   * handle messages. An in-progress task is the worker doing the work it was
   * assigned, which can include reporting into a group. Either way the authority
   * is *current*: a finished task or a settled run no longer speaks, so a reused
   * session id cannot keep sending after its turn ended.
   */
  resolveSenderFromSession(sessionId: string): { workerId: string; runId: string | null } {
    const store = this.getStore();
    const run = store.getRunBySession(sessionId);
    if (run) {
      if (run.state !== "running") {
        throw new WorkerSenderNotResolvableError(sessionId, run.state);
      }
      return { workerId: run.workerId, runId: run.runId };
    }

    const task = store.getRunningTaskByAgent(sessionId);
    if (task) {
      return { workerId: task.workerId, runId: null };
    }

    throw new WorkerSenderNotResolvableError(sessionId);
  }

  /**
   * Carry out one wake: hand a woken worker its messages and report how it ended.
   *
   * The caller has already created and claimed the run, because claiming has to
   * be atomic with the decision to wake. This does the execution and reports the
   * outcome; settling the run is the caller's, so a wake that never produced a
   * session still releases what it claimed.
   *
   * `onSession` exists for the same reason the ordering matters: the session is
   * attached before the worker gets its turn, because the worker's own first
   * action can be sending a reply, and that resolves its identity from the
   * attachment.
   */
  async executeWake(input: {
    runId: string;
    groupId: string;
    workerId: string;
    messageIds: readonly string[];
    onSession: (sessionId: string) => void;
  }): Promise<{ state: "completed" | "failed"; reason?: string }> {
    if (!this.runner) {
      throw new WorkerRunUnavailableError();
    }

    const worker = this.getWorker(input.workerId);
    const store = this.getStore();
    const messages = input.messageIds
      .map((messageId) => store.getMessage(messageId))
      .filter((message): message is NonNullable<typeof message> => message !== null);

    const nameById = new Map(
      this.listGroupMembers(input.groupId).map((member) => [
        member.workerId,
        this.getWorker(member.workerId).name,
      ]),
    );

    const members = this.listGroupMembers(input.groupId);
    const wakePrompt = buildWakePrompt({
      workerName: worker.name,
      workerId: worker.id,
      groupId: input.groupId,
      messages,
      members,
      nameById,
      hasGoal: store.getGoal(input.groupId) !== null,
      isCoordinator: members.some(
        (member) => member.workerId === worker.id && member.role === "coordinator",
      ),
      // An explicit request is what makes a group "working on something". A bare
      // question or a status note does not open a task to plan for.
      hasRequestedWork: messages.some((message) => message.intent === "request_action"),
    });

    const template = await this.loadTemplate(worker.templateId);

    const outcome = await this.runner.wake({
      workerId: worker.id,
      workerName: worker.name,
      workspacePath: worker.workspacePath,
      template,
      groupId: input.groupId,
      runId: input.runId,
      wakePrompt,
      onSessionCreated: input.onSession,
    });

    this.logger.info(
      { runId: input.runId, workerId: input.workerId, kind: outcome.kind },
      "Worker wake settled",
    );

    switch (outcome.kind) {
      case "succeeded":
        return { state: "completed" };
      case "failed":
        return { state: "failed", reason: outcome.reason };
      // A wake that stopped short of finishing did not consume its messages.
      // Reported as failed so the caller releases them; the loop's own record of
      // what it has tried keeps that from becoming a retry storm.
      case "blocked":
        return { state: "failed", reason: outcome.reason };
      case "cancelled":
        return { state: "failed", reason: "the wake was cancelled" };
    }
  }

  /**
   * Work out who is sending a message.
   *
   * A session id is checked by the daemon; a worker id is not, so the session
   * wins whenever it is supplied. Two ids that disagree are refused rather than
   * resolved in favour of either: a caller naming one worker while speaking from
   * another worker's session has a bug, and silently picking a winner would hide
   * it.
   *
   * Lives here rather than in the RPC layer because it is a decision about who is
   * allowed to speak, which is a domain rule.
   */
  resolveMessageSender(input: { senderSessionId?: string; senderWorkerId?: string }): string {
    if (input.senderSessionId) {
      const resolved = this.resolveSenderFromSession(input.senderSessionId);
      if (input.senderWorkerId && input.senderWorkerId !== resolved.workerId) {
        throw new Error(
          `senderWorkerId ${input.senderWorkerId} does not match the session's worker ${resolved.workerId}`,
        );
      }
      return resolved.workerId;
    }
    if (input.senderWorkerId) {
      return input.senderWorkerId;
    }
    throw new Error(
      "A message needs a sender: pass a session id from inside a worker run, or a worker id",
    );
  }

  sendMessage(input: {
    groupId: string;
    senderWorkerId: string;
    body: string;
    intent?: WorkerMessageIntent;
    deliveryPolicy?: WorkerMessageDeliveryPolicy;
    replyToMessageId?: string | null;
    audience?: readonly string[];
    privateTo?: readonly string[];
  }): { message: WorkerMessageRecord; woke: string[] } {
    this.getGroup(input.groupId);
    this.getWorker(input.senderWorkerId);

    const messageId = `msg_${randomBytes(6).toString("hex")}`;
    const message = this.getStore().createMessage({
      messageId,
      groupId: input.groupId,
      senderWorkerId: input.senderWorkerId,
      body: input.body,
      ...(input.intent !== undefined ? { intent: input.intent } : {}),
      ...(input.deliveryPolicy !== undefined ? { deliveryPolicy: input.deliveryPolicy } : {}),
      ...(input.replyToMessageId !== undefined ? { replyToMessageId: input.replyToMessageId } : {}),
      ...(input.audience !== undefined ? { audience: [...input.audience] } : {}),
      ...(input.privateTo !== undefined ? { privateTo: [...input.privateTo] } : {}),
    });

    const woke = message.deliveryPolicy === "wake" ? message.audience : [];
    this.logger.info(
      { messageId, groupId: input.groupId, woke: woke.length },
      "Recorded worker message",
    );
    this.notifyWakes(woke);
    return { message, woke };
  }

  listMessages(input: { groupId: string; viewerWorkerId?: string; limit?: number }) {
    this.getGroup(input.groupId);
    return this.getStore().listMessages(input);
  }

  /** A worker's open inbox: messages that woke it and are not finished. */
  listInbox(workerId: string): WorkerInboxEntry[] {
    this.getWorker(workerId);
    return this.getStore().listInbox(workerId);
  }

  /**
   * Mark a message picked up or finished for one worker.
   *
   * Reports `false` rather than throwing when the worker has no delivery, so a
   * caller can tell "this was not addressed to you" from a real failure.
   */
  markMessageDelivery(input: {
    messageId: string;
    workerId: string;
    state: WorkerMessageDeliveryState;
  }): boolean {
    this.getWorker(input.workerId);
    return this.getStore().markDelivery(input);
  }

  // ------------------------------------------------------------------ goals

  /** A group's goal, or null when it has none yet. */
  getGoal(groupId: string): WorkerGoalRecord | null {
    this.getGroup(groupId);
    return this.getStore().getGoal(groupId);
  }

  /**
   * Set the group's objective and its budget.
   *
   * One goal per group: the stream has a single objective, and reopening
   * carries it forward rather than starting a second one.
   */
  createGoal(input: { groupId: string; content: string; turnLimit: number }): WorkerGoalRecord {
    this.getGroup(input.groupId);
    const goalId = `goal_${randomBytes(6).toString("hex")}`;
    const goal = this.getStore().createGoal({
      goalId,
      groupId: input.groupId,
      content: input.content,
      turnLimit: input.turnLimit,
    });
    this.logger.info(
      { goalId, groupId: input.groupId, turnLimit: input.turnLimit },
      "Created worker goal",
    );
    return goal;
  }

  /**
   * Change a goal, refusing a write based on a stale read.
   *
   * The caller must pass the generation and revision it read. A mismatch means
   * another run changed the goal first, and the reference product's rule is to
   * read again and reconsider rather than overwrite.
   */
  mutateGoal(input: MutateWorkerGoalInput): WorkerGoalRecord {
    this.getGroup(input.groupId);
    return this.getStore().mutateGoal(input);
  }

  // ------------------------------------------------------------------- runs

  /**
   * Run a task and leave it in the state its outcome implies.
   *
   * The three state changes are recorded through the same single transition
   * writer every other status change uses, so a run cannot bypass the history.
   * An outcome that is not terminal (the worker is waiting on a permission
   * decision) is recorded as `blocked` rather than `submitted`: a person has to
   * act, and filing it as a finished result would put unfinished work in the
   * review queue.
   */
  async runTask(taskId: string): Promise<WorkerTaskRecord> {
    if (!this.runner) {
      throw new WorkerRunUnavailableError();
    }

    const task = this.getTask(taskId);
    const worker = this.getWorker(task.workerId);

    // Checked before the transition, so a refused run leaves the task untouched
    // rather than acknowledged-then-abandoned.
    if (this.getStore().countInProgressTasks(worker.id) > 0) {
      throw new WorkerBusyError(worker.id);
    }

    const template = await this.loadTemplate(worker.templateId);

    this.transitionTask({
      taskId,
      toState: "in_progress",
      action: "ack_task",
      actor: `worker:${worker.id}`,
    });

    const outcome = await this.runner.run({
      workerId: worker.id,
      workerName: worker.name,
      workspacePath: worker.workspacePath,
      template,
      task,
    });

    // Bind the session to the task before recording the outcome, so a task that
    // reached a state always knows which session got it there. The note is kept
    // as well: the history is what a reader follows to see what happened, and
    // it should not require a join.
    if (outcome.agentId) {
      this.getStore().setTaskAgent({ taskId, agentId: outcome.agentId });
    }

    if (outcome.kind === "submitted") {
      return this.transitionTask({
        taskId,
        toState: "submitted",
        action: "submit_task",
        actor: `worker:${worker.id}`,
        note: outcome.agentId,
      });
    }

    return this.transitionTask({
      taskId,
      toState: "blocked",
      action: "block_task",
      actor: `worker:${worker.id}`,
      note: outcome.reason,
    });
  }

  getTask(taskId: string): WorkerTaskRecord {
    const task = this.getStore().getTask(taskId);
    if (!task) throw new WorkerTaskNotFoundError(taskId);
    return task;
  }

  createTask(input: { workerId: string; title: string }): WorkerTaskRecord {
    this.getWorker(input.workerId);
    return this.getStore().createTask({
      taskId: `wtk_${randomBytes(6).toString("hex")}`,
      workerId: input.workerId,
      title: input.title,
    });
  }

  transitionTask(input: {
    taskId: string;
    toState: WorkerTaskRecord["state"];
    action: string;
    actor: string;
    note?: string;
  }): WorkerTaskRecord {
    // Illegal transitions surface as thrown errors from the single store entry
    // point; the transport maps them to a user-visible refusal. The action
    // arrives as a plain string over the wire, so it is narrowed here rather
    // than widening the store's own type.
    // Legal transitions are validated by the store's single entry point; this
    // only resolves existence first so a missing task reports the same typed
    // error as every other worker lookup instead of the store's own wording.
    this.getTask(input.taskId);
    const action = narrowTaskAction(input.action);
    return this.getStore().applyTaskTransition({
      taskId: input.taskId,
      toState: input.toState,
      action,
      actor: input.actor,
      ...(input.note !== undefined ? { note: input.note } : {}),
    }).task;
  }

  taskHistory(taskId: string): WorkerTaskHistoryEntry[] {
    this.getTask(taskId);
    return this.getStore().listTaskHistory(taskId);
  }

  evaluateGuard(input: { command: string; toolName?: string }): WorkerGuardVerdict {
    const result = evaluateToolCall({
      toolName: input.toolName ?? DEFAULT_SHELL_TOOL_NAMES[0]!,
      input: { command: input.command },
      rules: this.getGuardRules(),
    });
    return {
      decision: result.decision,
      maxSeverity: result.maxSeverity,
      findings: result.findings,
    };
  }
}
