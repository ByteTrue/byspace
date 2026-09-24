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
  WORKER_TASK_PROGRESS_NOTE_MAX_LENGTH,
  assertWorkerTaskTransition,
  isNoOpTransition,
  type WorkerTaskAction,
  type WorkerTaskState,
} from "./worker-task-state.js";

const SCHEMA_VERSION = 1;

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
    `);

    const current = this.db
      .prepare("SELECT version FROM worker_schema_version ORDER BY version DESC LIMIT 1")
      .get() as { version: number } | undefined;
    if (!current) {
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

      if (isNoOpTransition(current.state, input.toState)) {
        // Retries and progress reports must not fabricate a state change.
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

export { IllegalWorkerTaskTransitionError };
