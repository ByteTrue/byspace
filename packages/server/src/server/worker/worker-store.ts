/**
 * SQLite-backed store for the worker domain.
 *
 * This domain keeps its own database rather than joining the main domain's
 * file-based JSON stores. The main domain has no migration framework and
 * validates each record with Zod; task state transitions need atomic
 * read-modify-write plus an append-only history, which is what a relational
 * store is for. Keeping it separate means neither side has to adopt the
 * other's persistence rules.
 *
 * Task status is written in exactly one place: `applyTaskTransition`. Nothing
 * else may UPDATE `worker_tasks.state`.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { resolveBySpaceHome } from "../byspace-home.js";
import {
  IllegalWorkerTaskTransitionError,
  WORKER_TASK_PROGRESS_ACTION,
  WORKER_TASK_PROGRESS_NOTE_MAX_LENGTH,
  WorkerTaskActionMismatchError,
  assertActionMatchesTransition,
  assertWorkerTaskTransition,
  isNoOpTransition,
  type WorkerTaskAction,
  type WorkerTaskState,
} from "./worker-task-state.js";

export const SCHEMA_VERSION = 2;

export interface WorkerRecord {
  id: string;
  name: string;
  templateId: string;
  workspacePath: string;
  status: "online" | "offline";
  createdAt: string;
  updatedAt: string;
}

export interface WorkerTaskRecord {
  taskId: string;
  workerId: string;
  title: string;
  state: WorkerTaskState;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerTaskHistoryEntry {
  taskId: string;
  seq: number;
  fromState: WorkerTaskState;
  toState: WorkerTaskState;
  action: WorkerTaskAction;
  actor: string;
  note: string;
  recordedAt: string;
}

/** Exactly one member of a group is its coordinator; the rest contribute. */
export type WorkerGroupMemberRole = "coordinator" | "member";

export interface WorkerGroupRecord {
  id: string;
  name: string;
  /** The daemon's project id, not a path: a group outlives a moved checkout. */
  projectId: string;
  /** Null until a workspace is chosen; a roster is useful before that. */
  workspaceId: string | null;
  goal: string | null;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface WorkerGroupMemberRecord {
  groupId: string;
  workerId: string;
  role: WorkerGroupMemberRole;
  joinedAt: string;
}

export interface CreateWorkerGroupInput {
  id: string;
  name: string;
  projectId: string;
  workspaceId?: string | null;
  goal?: string | null;
  createdAt?: string;
}

/**
 * A group could not get exactly one coordinator.
 *
 * The database refuses two coordinators, so this is raised for the cases the
 * schema cannot express: no coordinator at all, or a coordinator who is not on
 * the roster.
 */
export class WorkerGroupCoordinatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerGroupCoordinatorError";
  }
}

export interface ApplyTaskTransitionInput {
  taskId: string;
  toState: WorkerTaskState;
  action: WorkerTaskAction;
  actor: string;
  note?: string;
  /** Injected for deterministic tests; defaults to now. */
  recordedAt?: string;
}

export interface ApplyTaskTransitionResult {
  task: WorkerTaskRecord;
  /** Null when the transition was a same-state retry and wrote no history. */
  historyEntry: WorkerTaskHistoryEntry | null;
}

interface WorkerTaskRow {
  task_id: string;
  worker_id: string;
  title: string;
  state: string;
  created_at: string;
  updated_at: string;
}

interface WorkerTaskHistoryRow {
  task_id: string;
  seq: number;
  from_state: string;
  to_state: string;
  action: string;
  actor: string;
  note: string;
  recorded_at: string;
}

export interface CreateWorkerTaskInput {
  taskId: string;
  workerId: string;
  title: string;
  createdAt?: string;
}

export interface WorkerStoreOptions {
  /** Defaults to `$BYSPACE_HOME/worker/worker.db`. */
  databasePath?: string;
  env?: NodeJS.ProcessEnv;
}

export function resolveWorkerDatabasePath(options: WorkerStoreOptions = {}): string {
  if (options.databasePath) return options.databasePath;
  return path.join(resolveBySpaceHome(options.env ?? process.env), "worker", "worker.db");
}

export class WorkerStore {
  private readonly db: DatabaseSync;

  constructor(options: WorkerStoreOptions = {}) {
    const databasePath = resolveWorkerDatabasePath(options);
    if (databasePath !== ":memory:") {
      mkdirSync(path.dirname(databasePath), { recursive: true });
    }
    this.db = new DatabaseSync(databasePath);
    this.migrate();
  }

  private migrate(): void {
    // WAL keeps readers from blocking the daemon's writes; foreign keys are off
    // by default in SQLite and must be enabled per connection.
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS worker_schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workers (
        id             TEXT PRIMARY KEY,
        name           TEXT NOT NULL,
        template_id    TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        status         TEXT NOT NULL,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS worker_tasks (
        task_id    TEXT PRIMARY KEY,
        worker_id  TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
        title      TEXT NOT NULL,
        state      TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_worker_tasks_worker_state
        ON worker_tasks(worker_id, state, updated_at);

      CREATE TABLE IF NOT EXISTS worker_task_history (
        task_id    TEXT NOT NULL REFERENCES worker_tasks(task_id) ON DELETE CASCADE,
        seq        INTEGER NOT NULL,
        from_state TEXT NOT NULL,
        to_state   TEXT NOT NULL,
        action     TEXT NOT NULL,
        actor      TEXT NOT NULL,
        note       TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        PRIMARY KEY (task_id, seq)
      );

      -- A project group: several workers on one project and workspace.
      --
      -- The project is identified by the daemon's own project id rather than by
      -- a path, so a group keeps pointing at the same project when a checkout
      -- moves. The workspace is the subtree work happens in; nullable because a
      -- group is useful before a workspace is chosen (its roster and channels
      -- exist first).
      CREATE TABLE IF NOT EXISTS worker_groups (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        project_id    TEXT NOT NULL,
        workspace_id  TEXT,
        goal          TEXT,
        status        TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_worker_groups_project
        ON worker_groups(project_id, status);

      CREATE TABLE IF NOT EXISTS worker_group_members (
        group_id   TEXT NOT NULL REFERENCES worker_groups(id) ON DELETE CASCADE,
        worker_id  TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
        role       TEXT NOT NULL,
        joined_at  TEXT NOT NULL,
        PRIMARY KEY (group_id, worker_id)
      );

      -- Exactly one coordinator per group, enforced by the database rather than
      -- by application code. "Who is in charge" is an invariant a reader must be
      -- able to trust; a partial unique index makes two coordinators
      -- unrepresentable instead of merely discouraged.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_group_one_coordinator
        ON worker_group_members(group_id) WHERE role = 'coordinator';
    `);

    const current = this.db
      .prepare("SELECT version FROM worker_schema_version ORDER BY version DESC LIMIT 1")
      .get() as { version: number } | undefined;
    if (!current) {
      this.db
        .prepare("INSERT INTO worker_schema_version (version, applied_at) VALUES (?, ?)")
        .run(SCHEMA_VERSION, new Date().toISOString());
      return;
    }
    // The CREATE statements above run on every open, so adding a table or index
    // upgrades an existing database by itself. That is the whole migration
    // story here: it covers additive changes and nothing else. A change to an
    // existing column (rename, retype, drop) needs a real migration step and a
    // version branch, which does not exist yet.
    //
    // Recording the bump matters because these rows are how such a step would
    // decide what it still has to do; without it, an upgraded database would
    // keep reporting the version it was created with.
    if (current.version < SCHEMA_VERSION) {
      this.db
        .prepare("INSERT INTO worker_schema_version (version, applied_at) VALUES (?, ?)")
        .run(SCHEMA_VERSION, new Date().toISOString());
    }
  }

  /** Exposed for tests that assert on the recorded schema version. */
  getSchemaVersion(): number {
    const row = this.db
      .prepare("SELECT version FROM worker_schema_version ORDER BY version DESC LIMIT 1")
      .get() as { version: number } | undefined;
    return row?.version ?? 0;
  }

  private closed = false;

  close(): void {
    // Idempotent: shutdown paths and tests can both call this.
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  // ---------------------------------------------------------------- workers

  createWorker(record: WorkerRecord): WorkerRecord {
    this.db
      .prepare(
        `INSERT INTO workers (id, name, template_id, workspace_path, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.name,
        record.templateId,
        record.workspacePath,
        record.status,
        record.createdAt,
        record.updatedAt,
      );
    return record;
  }

  getWorker(id: string): WorkerRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, name, template_id, workspace_path, status, created_at, updated_at
         FROM workers WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          name: string;
          template_id: string;
          workspace_path: string;
          status: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      templateId: row.template_id,
      workspacePath: row.workspace_path,
      status: row.status as WorkerRecord["status"],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listWorkers(): WorkerRecord[] {
    const rows = this.db
      .prepare("SELECT id FROM workers ORDER BY created_at ASC, id ASC")
      .all() as Array<{ id: string }>;
    return rows.map((row) => this.getWorker(row.id)).filter((w): w is WorkerRecord => w !== null);
  }

  // ------------------------------------------------------------------ tasks

  createTask(input: CreateWorkerTaskInput): WorkerTaskRecord {
    const at = input.createdAt ?? new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO worker_tasks (task_id, worker_id, title, state, created_at, updated_at)
         VALUES (?, ?, ?, 'planned', ?, ?)`,
      )
      .run(input.taskId, input.workerId, input.title, at, at);
    const task = this.getTask(input.taskId);
    if (!task) throw new Error(`worker task ${input.taskId} vanished immediately after insert`);
    return task;
  }

  getTask(taskId: string): WorkerTaskRecord | null {
    const row = this.db
      .prepare(
        `SELECT task_id, worker_id, title, state, created_at, updated_at
         FROM worker_tasks WHERE task_id = ?`,
      )
      .get(taskId) as WorkerTaskRow | undefined;
    return row ? toTaskRecord(row) : null;
  }

  listTasksForWorker(workerId: string): WorkerTaskRecord[] {
    const rows = this.db
      .prepare(
        `SELECT task_id, worker_id, title, state, created_at, updated_at
         FROM worker_tasks WHERE worker_id = ?
         ORDER BY created_at ASC, task_id ASC`,
      )
      .all(workerId) as WorkerTaskRow[];
    return rows.map(toTaskRecord);
  }

  /** Every task, most recently updated first. One query rather than one per worker. */
  listAllTasks(): WorkerTaskRecord[] {
    const rows = this.db
      .prepare(
        `SELECT task_id, worker_id, title, state, created_at, updated_at
         FROM worker_tasks
         ORDER BY updated_at DESC, task_id ASC`,
      )
      .all() as WorkerTaskRow[];
    return rows.map(toTaskRecord);
  }

  /**
   * The only writer of `worker_tasks.state`.
   *
   * Validates the edge, updates the task, and appends history in one
   * transaction so a crash cannot leave a state change without its history
   * entry. A same-state retry returns the task unchanged and writes nothing.
   */
  applyTaskTransition(input: ApplyTaskTransitionInput): ApplyTaskTransitionResult {
    const recordedAt = input.recordedAt ?? new Date().toISOString();
    const note = (input.note ?? "").slice(0, WORKER_TASK_PROGRESS_NOTE_MAX_LENGTH);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getTask(input.taskId);
      if (!current) {
        throw new Error(`unknown worker task: ${input.taskId}`);
      }
      assertWorkerTaskTransition(current.state, input.toState);
      // The state graph only says the edge exists. The recorded action must be
      // the one that produces it, or the history is decoration rather than an
      // account of what happened.
      assertActionMatchesTransition(current.state, input.toState, input.action);

      if (isNoOpTransition(current.state, input.toState)) {
        // A same-state arrival is a retry, and a retry is only idempotent if it
        // repeats the action that produced the current state (or is a progress
        // note). An unrelated action arriving here claims work that did not
        // happen, so it is refused rather than recorded.
        const lastAction = this.getLastHistoryAction(input.taskId);
        if (input.action !== WORKER_TASK_PROGRESS_ACTION && input.action !== lastAction) {
          throw new WorkerTaskActionMismatchError(
            current.state,
            input.toState,
            input.action,
            lastAction ?? "(no prior action)",
          );
        }
        this.db.exec("COMMIT");
        return { task: current, historyEntry: null };
      }

      const nextSeq =
        ((
          this.db
            .prepare(
              "SELECT COALESCE(MAX(seq), 0) AS max_seq FROM worker_task_history WHERE task_id = ?",
            )
            .get(input.taskId) as { max_seq: number }
        ).max_seq ?? 0) + 1;

      this.db
        .prepare("UPDATE worker_tasks SET state = ?, updated_at = ? WHERE task_id = ?")
        .run(input.toState, recordedAt, input.taskId);

      this.db
        .prepare(
          `INSERT INTO worker_task_history
             (task_id, seq, from_state, to_state, action, actor, note, recorded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.taskId,
          nextSeq,
          current.state,
          input.toState,
          input.action,
          input.actor,
          note,
          recordedAt,
        );

      this.db.exec("COMMIT");

      const updated = this.getTask(input.taskId);
      if (!updated) throw new Error(`worker task ${input.taskId} vanished during transition`);
      return {
        task: updated,
        historyEntry: {
          taskId: input.taskId,
          seq: nextSeq,
          fromState: current.state,
          toState: input.toState,
          action: input.action,
          actor: input.actor,
          note,
          recordedAt,
        },
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listTaskHistory(taskId: string): WorkerTaskHistoryEntry[] {
    const rows = this.db
      .prepare(
        `SELECT task_id, seq, from_state, to_state, action, actor, note, recorded_at
         FROM worker_task_history WHERE task_id = ? ORDER BY seq ASC`,
      )
      .all(taskId) as WorkerTaskHistoryRow[];
    return rows.map((row) => ({
      taskId: row.task_id,
      seq: row.seq,
      fromState: row.from_state as WorkerTaskState,
      toState: row.to_state as WorkerTaskState,
      action: row.action as WorkerTaskAction,
      actor: row.actor,
      note: row.note,
      recordedAt: row.recorded_at,
    }));
  }

  /**
   * The action that produced the task's current state, used to tell an
   * idempotent retry from an unrelated action arriving at the same state.
   */
  private getLastHistoryAction(taskId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT action FROM worker_task_history
         WHERE task_id = ? ORDER BY seq DESC LIMIT 1`,
      )
      .get(taskId) as { action: string } | undefined;
    return row?.action ?? null;
  }

  // ----------------------------------------------------------------- groups

  createGroup(input: CreateWorkerGroupInput): WorkerGroupRecord {
    const at = input.createdAt ?? new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO worker_groups
           (id, name, project_id, workspace_id, goal, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
      .run(
        input.id,
        input.name,
        input.projectId,
        input.workspaceId ?? null,
        input.goal ?? null,
        at,
        at,
      );
    const group = this.getGroup(input.id);
    if (!group) throw new Error(`worker group ${input.id} vanished immediately after insert`);
    return group;
  }

  getGroup(groupId: string): WorkerGroupRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, name, project_id, workspace_id, goal, status, created_at, updated_at
         FROM worker_groups WHERE id = ?`,
      )
      .get(groupId) as WorkerGroupRow | undefined;
    return row ? toGroupRecord(row) : null;
  }

  listGroups(): WorkerGroupRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, project_id, workspace_id, goal, status, created_at, updated_at
         FROM worker_groups WHERE status = 'active'
         ORDER BY created_at ASC, id ASC`,
      )
      .all() as WorkerGroupRow[];
    return rows.map(toGroupRecord);
  }

  listGroupMembers(groupId: string): WorkerGroupMemberRecord[] {
    // Coordinator first, then insertion order. Ordering by worker id would look
    // stable but is not: ids are random hex, so the roster would reshuffle
    // between reads. `rowid` is the insertion order, which is what a roster
    // means.
    const rows = this.db
      .prepare(
        `SELECT group_id, worker_id, role, joined_at
         FROM worker_group_members WHERE group_id = ?
         ORDER BY CASE role WHEN 'coordinator' THEN 0 ELSE 1 END, rowid ASC`,
      )
      .all(groupId) as WorkerGroupMemberRow[];
    return rows.map(toGroupMemberRecord);
  }

  /**
   * Put a worker on a group's roster, optionally as its coordinator.
   *
   * The database is the guarantee: a partial unique index makes two
   * coordinators unrepresentable, and the membership primary key makes a
   * duplicate roster entry unrepresentable. The explicit checks below exist to
   * produce a message that says what is wrong, because SQLite reports
   * constraint violations as "UNIQUE constraint failed: <table>.<column>" and
   * parsing that text would break the moment a column is renamed.
   *
   * The check-then-insert is safe from races here because SQLite calls in this
   * process are synchronous, so nothing can interleave between them.
   */
  addGroupMember(input: {
    groupId: string;
    workerId: string;
    role: WorkerGroupMemberRole;
    joinedAt?: string;
  }): WorkerGroupMemberRecord {
    if (!this.getGroup(input.groupId)) {
      throw new Error(`unknown worker group: ${input.groupId}`);
    }
    if (!this.getWorker(input.workerId)) {
      throw new Error(`unknown worker: ${input.workerId}`);
    }
    const existing = this.listGroupMembers(input.groupId);
    if (existing.some((member) => member.workerId === input.workerId)) {
      throw new Error(`worker ${input.workerId} is already a member of group ${input.groupId}`);
    }
    if (input.role === "coordinator" && existing.some((member) => member.role === "coordinator")) {
      throw new WorkerGroupCoordinatorError(
        `Worker group ${input.groupId} already has a coordinator. A group has exactly one.`,
      );
    }

    this.db
      .prepare(
        `INSERT INTO worker_group_members (group_id, worker_id, role, joined_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(input.groupId, input.workerId, input.role, input.joinedAt ?? new Date().toISOString());

    const added = this.listGroupMembers(input.groupId).find(
      (member) => member.workerId === input.workerId,
    );
    if (!added) throw new Error(`group member ${input.workerId} vanished after insert`);
    return added;
  }

  removeGroupMember(input: { groupId: string; workerId: string }): void {
    this.db
      .prepare("DELETE FROM worker_group_members WHERE group_id = ? AND worker_id = ?")
      .run(input.groupId, input.workerId);
  }

  /**
   * Remove a group and its roster.
   *
   * Used to undo a half-made group; group lifecycle in the product is archive,
   * not delete, and this is not exposed as one.
   */
  deleteGroup(groupId: string): void {
    this.db.prepare("DELETE FROM worker_groups WHERE id = ?").run(groupId);
  }
}

function toTaskRecord(row: WorkerTaskRow): WorkerTaskRecord {
  return {
    taskId: row.task_id,
    workerId: row.worker_id,
    title: row.title,
    state: row.state as WorkerTaskState,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface WorkerGroupRow {
  id: string;
  name: string;
  project_id: string;
  workspace_id: string | null;
  goal: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface WorkerGroupMemberRow {
  group_id: string;
  worker_id: string;
  role: string;
  joined_at: string;
}

function toGroupRecord(row: WorkerGroupRow): WorkerGroupRecord {
  return {
    id: row.id,
    name: row.name,
    projectId: row.project_id,
    workspaceId: row.workspace_id,
    goal: row.goal,
    status: row.status as WorkerGroupRecord["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toGroupMemberRecord(row: WorkerGroupMemberRow): WorkerGroupMemberRecord {
  return {
    groupId: row.group_id,
    workerId: row.worker_id,
    role: row.role as WorkerGroupMemberRole,
    joinedAt: row.joined_at,
  };
}

export { IllegalWorkerTaskTransitionError };
