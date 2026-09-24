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

import { resolveBySpaceHome } from "../byspace-home.js";
import {
  WorkerStore,
  resolveWorkerDatabasePath,
  type WorkerGroupMemberRecord,
  type WorkerGroupMemberRole,
  type WorkerGroupRecord,
  type WorkerRecord,
  type WorkerTaskHistoryEntry,
  type WorkerTaskRecord,
} from "./worker-store.js";
import { WORKER_TASK_ACTIONS, type WorkerTaskAction } from "./worker-task-state.js";
import type { WorkerRunner } from "./worker-runner.js";
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

export interface WorkerTemplateSummary {
  id: string;
  title: string;
  skills: string[];
}

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
      templates.push({ id: template.id, title: template.title, skills: template.skills });
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
    goal?: string | null;
    coordinatorWorkerId?: string;
    memberWorkerIds?: readonly string[];
  }): WorkerGroupRecord {
    const id = `grp_${randomBytes(6).toString("hex")}`;
    const group = this.getStore().createGroup({
      id,
      name: input.name,
      projectId: input.projectId,
      workspaceId: input.workspaceId ?? null,
      goal: input.goal ?? null,
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
