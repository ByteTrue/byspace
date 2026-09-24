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

export const SCHEMA_VERSION = 5;

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
  createdAt?: string;
}

// ---------------------------------------------------------------- messages

/**
 * Whether sending a message wakes its audience.
 *
 * `wake` and reading are separate questions: a message can be visible to a
 * worker without starting a run for it, and the reference product models that
 * as this policy rather than as visibility.
 */
export type WorkerMessageDeliveryPolicy = "wake" | "store_only";

/** What the message is for. Presentation only; it does not change routing. */
export type WorkerMessageIntent = "chat" | "ask" | "notify" | "request_action";

/** Per-recipient pickup state, so two recipients of one message are independent. */
export type WorkerMessageDeliveryState = "unread" | "claimed" | "read";

export interface WorkerMessageRecord {
  messageId: string;
  groupId: string;
  /** Visible ordering within the group, allocated on insert. */
  seq: number;
  senderWorkerId: string;
  body: string;
  intent: WorkerMessageIntent;
  deliveryPolicy: WorkerMessageDeliveryPolicy;
  replyToMessageId: string | null;
  /** Workers the message is addressed to. Empty when nobody is addressed. */
  audience: string[];
  /**
   * Workers allowed to read it, when narrower than the group. Empty means
   * public to the group, which is the common case.
   */
  privateTo: string[];
  createdAt: string;
}

export interface WorkerMessageDeliveryRecord {
  messageId: string;
  workerId: string;
  state: WorkerMessageDeliveryState;
  claimedAt: string | null;
  readAt: string | null;
}

/**
 * A stored message together with its delivery state for one reader.
 *
 * Delivery state belongs to the pair, so the same message appears in two
 * workers' inboxes with different states. Returning it alongside the message
 * keeps that difference visible to the caller.
 */
export interface WorkerInboxEntry {
  message: WorkerMessageRecord;
  state: WorkerMessageDeliveryState;
}

export interface CreateWorkerMessageInput {
  messageId: string;
  groupId: string;
  senderWorkerId: string;
  body: string;
  intent?: WorkerMessageIntent;
  deliveryPolicy?: WorkerMessageDeliveryPolicy;
  replyToMessageId?: string | null;
  audience?: string[];
  privateTo?: string[];
  createdAt?: string;
}

// -------------------------------------------------------------------- goals

export type WorkerGoalStatus = "active" | "completed" | "paused";

/**
 * Why automatic work stopped.
 *
 * `turn_limit` is distinct from `no_progress` on purpose: one is a budget being
 * spent, the other is work that is not converging, and they call for different
 * responses.
 */
export type WorkerGoalPauseReason =
  | "user_stop"
  | "awaiting_user"
  | "turn_limit"
  | "no_progress"
  | "execution_error"
  | "leader_unavailable";

/**
 * The budget counts public messages. The reference product fixes the range, so
 * the bounds are policy and live here rather than at each call site.
 */
export const WORKER_GOAL_TURN_LIMIT_MIN = 1;
export const WORKER_GOAL_TURN_LIMIT_MAX = 96;
/** The reference product's default for a single-member job. */
export const WORKER_GOAL_TURN_LIMIT_DEFAULT = 20;

export interface WorkerGoalRecord {
  goalId: string;
  groupId: string;
  /** The user-facing delivery objective. */
  content: string;
  turnLimit: number;
  status: WorkerGoalStatus;
  /** Advances on reopen: a new attempt at the objective. */
  generation: number;
  /** Advances on every other change. */
  revision: number;
  pauseReason: WorkerGoalPauseReason | null;
  resultMessageId: string | null;
  /** Public messages must exceed this sequence to count against the budget. */
  generationStartSeq: number;
  createdAt: string;
  updatedAt: string;
  /** Public messages spent against the current generation. */
  turnUsed: number;
}

/** The mutations a goal accepts. `create` is separate: it has nothing to compare against. */
export type WorkerGoalAction = "update" | "complete" | "pause" | "reopen";

export interface MutateWorkerGoalInput {
  groupId: string;
  action: WorkerGoalAction;
  /**
   * The generation and revision the caller read. A mismatch means someone else
   * changed the goal first, and the mutation is refused rather than applied.
   */
  expectedGeneration: number;
  expectedRevision: number;
  content?: string;
  turnLimit?: number;
  pauseReason?: WorkerGoalPauseReason;
  resultMessageId?: string;
  now?: string;
}

/** A goal mutation was written against a state that is no longer current. */
export class WorkerGoalConflictError extends Error {
  constructor(groupId: string) {
    super(
      `Goal for group ${groupId} changed since it was read. Read it again rather than overwriting.`,
    );
    this.name = "WorkerGoalConflictError";
  }
}

/**
 * The group has spent the messages its goal allowed.
 *
 * Distinct from a plain validation failure because the way forward is a
 * decision, not a correction: the budget is exhausted, so someone has to reopen
 * the goal with a new one or accept that the work has stopped. Raising the limit
 * purely to get around this is exactly what the limit exists to prevent.
 */
export class WorkerGoalBudgetExhaustedError extends Error {
  constructor(groupId: string, turnLimit: number) {
    super(
      `Group ${groupId} has spent its budget of ${turnLimit} public messages, so it cannot wake anyone. Reopen the goal with a new budget, or leave the work stopped.`,
    );
    this.name = "WorkerGoalBudgetExhaustedError";
  }
}

/** A goal mutation is not valid for the goal's current state. */
export class WorkerGoalActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerGoalActionError";
  }
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

      -- A group's message stream. The seq column is the visible ordering and
      -- is allocated inside the same statement that inserts the row, so two
      -- concurrent sends cannot claim the same position.
      CREATE TABLE IF NOT EXISTS worker_messages (
        message_id        TEXT PRIMARY KEY,
        group_id          TEXT NOT NULL REFERENCES worker_groups(id) ON DELETE CASCADE,
        seq               INTEGER NOT NULL,
        sender_worker_id  TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
        body              TEXT NOT NULL,
        intent            TEXT NOT NULL,
        delivery_policy   TEXT NOT NULL,
        reply_to_message_id TEXT,
        created_at        TEXT NOT NULL,
        UNIQUE (group_id, seq)
      );

      CREATE INDEX IF NOT EXISTS idx_worker_messages_group_seq
        ON worker_messages(group_id, seq);

      -- Who a message is addressed to. Routing reads this, never the text: an
      -- @name in the body is presentation, and parsing it would make routing
      -- depend on prose.
      CREATE TABLE IF NOT EXISTS worker_message_audience (
        message_id TEXT NOT NULL REFERENCES worker_messages(message_id) ON DELETE CASCADE,
        worker_id  TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
        PRIMARY KEY (message_id, worker_id)
      );

      -- Who may read a message, when that is narrower than the whole group.
      -- Absence of rows means public. This is deliberately independent of
      -- the audience table: waking someone and letting them read are different
      -- questions, and a store-only message is visible without waking anyone.
      CREATE TABLE IF NOT EXISTS worker_message_private_to (
        message_id TEXT NOT NULL REFERENCES worker_messages(message_id) ON DELETE CASCADE,
        worker_id  TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
        PRIMARY KEY (message_id, worker_id)
      );

      -- One row per recipient of a waking message, so "has this been picked up"
      -- is a fact about a pair rather than a flag on the message. Two workers
      -- addressed by the same message have independent delivery state.
      CREATE TABLE IF NOT EXISTS worker_message_deliveries (
        message_id TEXT NOT NULL REFERENCES worker_messages(message_id) ON DELETE CASCADE,
        worker_id  TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
        state      TEXT NOT NULL,
        claimed_at TEXT,
        read_at    TEXT,
        PRIMARY KEY (message_id, worker_id)
      );

      CREATE INDEX IF NOT EXISTS idx_worker_message_deliveries_inbox
        ON worker_message_deliveries(worker_id, state, message_id);

      -- What the group is trying to deliver, and how much it may spend doing it.
      --
      -- One goal per group: the stream has a single objective, and reopen
      -- carries it forward rather than starting a second one. A unique index
      -- says so, because "the goal" is singular in every read and a second row
      -- would make that ambiguous.
      --
      -- Generation and revision together identify an exact state, so a
      -- mutation written against a stale read is refused instead of silently
      -- winning. Generation advances on reopen (a new attempt at the
      -- objective); revision advances on every other change.
      CREATE TABLE IF NOT EXISTS worker_goals (
        goal_id           TEXT PRIMARY KEY,
        group_id          TEXT NOT NULL REFERENCES worker_groups(id) ON DELETE CASCADE,
        content           TEXT NOT NULL,
        turn_limit        INTEGER NOT NULL,
        status            TEXT NOT NULL,
        generation        INTEGER NOT NULL,
        revision          INTEGER NOT NULL,
        pause_reason      TEXT,
        result_message_id TEXT REFERENCES worker_messages(message_id) ON DELETE SET NULL,
        -- The budget counts public messages with a sequence above this, so
        -- reopening starts a new count rather than inheriting the previous
        -- attempt's spend. A sequence boundary rather than a timestamp: message
        -- sequence is allocated monotonically per group, so it cannot misjudge
        -- a message that happens to share a millisecond with the reopen.
        generation_start_seq INTEGER NOT NULL,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_goals_one_per_group
        ON worker_goals(group_id);
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
    // Additive changes need no step here: the CREATE statements above run on
    // every open, so a new table or index appears by itself. Only a change to an
    // existing column needs one, which is what the steps below are.
    if (current.version < 5) {
      this.migrateGroupGoalToGoalEntity();
    }

    // Recording the bump matters because these rows are how a step decides what
    // it still has to do; without it, an upgraded database would keep reporting
    // the version it was created with.
    if (current.version < SCHEMA_VERSION) {
      this.db
        .prepare("INSERT INTO worker_schema_version (version, applied_at) VALUES (?, ?)")
        .run(SCHEMA_VERSION, new Date().toISOString());
    }
  }

  /**
   * v5: move a group's objective out of the group and onto the goal.
   *
   * `worker_groups.goal` was a second place the objective could live, alongside
   * the goal entity that also carries its budget, status and version. Two homes
   * for one fact drift, so the column goes and the goal owns it.
   *
   * Existing text is carried over rather than dropped, and the budget it needs
   * is estimated from the roster size.
   */
  private migrateGroupGoalToGoalEntity(): void {
    const hasColumn = (
      this.db.prepare("PRAGMA table_info(worker_groups)").all() as Array<{ name: string }>
    ).some((column) => column.name === "goal");
    if (!hasColumn) return;

    this.db.exec(`
      INSERT INTO worker_goals
        (goal_id, group_id, content, turn_limit, status, generation, revision,
         pause_reason, result_message_id, generation_start_seq, created_at, updated_at)
      SELECT 'goal_' || g.id, g.id, g.goal, ${suggestTurnLimitSql("(SELECT COUNT(*) FROM worker_group_members m WHERE m.group_id = g.id)")},
             'active', 1, 1, NULL, NULL, 0, g.created_at, g.updated_at
      FROM worker_groups g
      WHERE g.goal IS NOT NULL AND TRIM(g.goal) <> ''
        AND NOT EXISTS (SELECT 1 FROM worker_goals w WHERE w.group_id = g.id);

      ALTER TABLE worker_groups DROP COLUMN goal;
    `);
  }

  /**
   * The turn budget to suggest for a roster of this size.
   *
   * The reference product's estimate: at least two public messages per
   * independently assigned member (a receipt and a completion), plus headroom for
   * handoffs, progress, coordination and the final delivery, with roughly 35%
   * slack. It also says multi-member work must not reuse the default of 20,
   * which is why the floor only applies to small rosters.
   */
  static suggestTurnLimit(memberCount: number): number {
    const estimate = Math.ceil(2 * Math.max(memberCount, 1) * 1.35);
    // The default applies to a single-member job only. Upstream is explicit that
    // multi-member work must not reuse it, so applying it as a floor would make
    // the estimate a constant for every roster small enough to matter.
    const floor = memberCount <= 1 ? WORKER_GOAL_TURN_LIMIT_DEFAULT : WORKER_GOAL_TURN_LIMIT_MIN;
    return Math.min(Math.max(estimate, floor), WORKER_GOAL_TURN_LIMIT_MAX);
  }

  /** Exposed for tests: the columns of a table, to assert a migration landed. */
  rawTableInfo(table: string): unknown[] {
    return this.db.prepare(`PRAGMA table_info(${table})`).all();
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

  /**
   * How many of a worker's tasks are currently being worked on.
   *
   * Used to bound concurrency: a worker has one workspace and one session at a
   * time, so two tasks in flight for it would be two sessions competing for the
   * same directory, and neither could be attributed cleanly.
   */
  countInProgressTasks(workerId: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS in_progress FROM worker_tasks WHERE worker_id = ? AND state = 'in_progress'",
      )
      .get(workerId) as { in_progress: number };
    return row.in_progress;
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
           (id, name, project_id, workspace_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?)`,
      )
      .run(input.id, input.name, input.projectId, input.workspaceId ?? null, at, at);
    const group = this.getGroup(input.id);
    if (!group) throw new Error(`worker group ${input.id} vanished immediately after insert`);
    return group;
  }

  getGroup(groupId: string): WorkerGroupRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, name, project_id, workspace_id, status, created_at, updated_at
         FROM worker_groups WHERE id = ?`,
      )
      .get(groupId) as WorkerGroupRow | undefined;
    return row ? toGroupRecord(row) : null;
  }

  listGroups(): WorkerGroupRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, project_id, workspace_id, status, created_at, updated_at
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

  // --------------------------------------------------------------- messages

  /**
   * Check a message's participants and return its deduplicated recipients.
   *
   * Errors rather than repairing: an unknown worker, or an addressee who cannot
   * read the message, is a caller mistake, and silently dropping either half
   * would hide it.
   */
  private validateMessageRecipients(input: CreateWorkerMessageInput): {
    audience: string[];
    privateTo: string[];
  } {
    if (!this.getGroup(input.groupId)) {
      throw new Error(`unknown worker group: ${input.groupId}`);
    }
    if (!this.getWorker(input.senderWorkerId)) {
      throw new Error(`unknown worker: ${input.senderWorkerId}`);
    }

    const audience = [...new Set(input.audience ?? [])];
    const privateTo = [...new Set(input.privateTo ?? [])];

    for (const workerId of [...audience, ...privateTo]) {
      if (!this.getWorker(workerId)) {
        throw new Error(`unknown worker: ${workerId}`);
      }
    }

    // Addressing someone who cannot read the message is contradictory.
    if (privateTo.length > 0) {
      const readers = new Set([...privateTo, input.senderWorkerId]);
      const unreachable = audience.filter((workerId) => !readers.has(workerId));
      if (unreachable.length > 0) {
        throw new Error(
          `message addresses ${unreachable.join(", ")} who are not among its readers`,
        );
      }
    }

    return { audience, privateTo };
  }

  /**
   * Append a message to a group's stream.
   *
   * The visible `seq` is allocated here rather than passed in, inside the same
   * transaction as the insert: a caller that supplied its own sequence could
   * not know what is free, and reading the maximum first would let two
   * concurrent sends claim the same position.
   *
   * A waking message gets one delivery row per addressed worker. A store-only
   * message gets none, which is what makes "visible but not waking" a fact
   * rather than a convention: there is nothing for an inbox to pick up.
   */
  createMessage(input: CreateWorkerMessageInput): WorkerMessageRecord {
    const { audience, privateTo } = this.validateMessageRecipients(input);
    const intent = input.intent ?? (audience.length > 0 ? "request_action" : "chat");
    const deliveryPolicy = input.deliveryPolicy ?? (audience.length > 0 ? "wake" : "store_only");

    // The budget stops wakes, not communication. A spent group can still be
    // told something: the reference product is explicit that required lifecycle
    // updates must not be dropped to save budget, and that no *wake* may be
    // created past the limit. So this refuses only waking sends, and only when
    // the budget is actually gone.
    if (deliveryPolicy === "wake") {
      const goal = this.getGoal(input.groupId);
      if (goal && goal.turnUsed >= goal.turnLimit) {
        throw new WorkerGoalBudgetExhaustedError(input.groupId, goal.turnLimit);
      }
    }
    const createdAt = input.createdAt ?? new Date().toISOString();

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const next = this.db
        .prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM worker_messages WHERE group_id = ?")
        .get(input.groupId) as { seq: number };

      this.db
        .prepare(
          `INSERT INTO worker_messages
             (message_id, group_id, seq, sender_worker_id, body, intent, delivery_policy,
              reply_to_message_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.messageId,
          input.groupId,
          next.seq,
          input.senderWorkerId,
          input.body,
          intent,
          deliveryPolicy,
          input.replyToMessageId ?? null,
          createdAt,
        );

      const insertAudience = this.db.prepare(
        "INSERT INTO worker_message_audience (message_id, worker_id) VALUES (?, ?)",
      );
      for (const workerId of audience) insertAudience.run(input.messageId, workerId);

      const insertPrivate = this.db.prepare(
        "INSERT INTO worker_message_private_to (message_id, worker_id) VALUES (?, ?)",
      );
      for (const workerId of privateTo) insertPrivate.run(input.messageId, workerId);

      if (deliveryPolicy === "wake") {
        const insertDelivery = this.db.prepare(
          `INSERT INTO worker_message_deliveries (message_id, worker_id, state, claimed_at, read_at)
           VALUES (?, ?, 'unread', NULL, NULL)`,
        );
        for (const workerId of audience) insertDelivery.run(input.messageId, workerId);
      }

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    const created = this.getMessage(input.messageId);
    if (!created) throw new Error(`message ${input.messageId} vanished immediately after insert`);
    return created;
  }

  getMessage(messageId: string): WorkerMessageRecord | null {
    const row = this.db
      .prepare(
        `SELECT message_id, group_id, seq, sender_worker_id, body, intent, delivery_policy,
                reply_to_message_id, created_at
         FROM worker_messages WHERE message_id = ?`,
      )
      .get(messageId) as WorkerMessageRow | undefined;
    if (!row) return null;

    const audience = this.db
      .prepare(
        `SELECT worker_id FROM worker_message_audience
         WHERE message_id = ? ORDER BY rowid ASC`,
      )
      .all(messageId) as Array<{ worker_id: string }>;
    const privateTo = this.db
      .prepare(
        `SELECT worker_id FROM worker_message_private_to
         WHERE message_id = ? ORDER BY rowid ASC`,
      )
      .all(messageId) as Array<{ worker_id: string }>;

    return toMessageRecord(
      row,
      audience.map((entry) => entry.worker_id),
      privateTo.map((entry) => entry.worker_id),
    );
  }

  /**
   * A group's stream in visible order.
   *
   * `viewerWorkerId` filters to what that worker may read; omitting it returns
   * everything, which is what an operator view wants and a worker must not get.
   */
  listMessages(input: {
    groupId: string;
    viewerWorkerId?: string;
    limit?: number;
  }): WorkerMessageRecord[] {
    const rows = this.db
      .prepare(
        `SELECT message_id, group_id, seq, sender_worker_id, body, intent, delivery_policy,
                reply_to_message_id, created_at
         FROM worker_messages WHERE group_id = ? ORDER BY seq ASC`,
      )
      .all(input.groupId) as WorkerMessageRow[];

    const messages = rows.map((row) => {
      const record = this.getMessage(row.message_id);
      if (!record) throw new Error(`message ${row.message_id} vanished between reads`);
      return record;
    });

    const visible =
      input.viewerWorkerId === undefined
        ? messages
        : messages.filter(
            (message) =>
              message.privateTo.length === 0 ||
              message.privateTo.includes(input.viewerWorkerId as string) ||
              message.senderWorkerId === input.viewerWorkerId,
          );

    if (input.limit === undefined || visible.length <= input.limit) return visible;
    // The most recent `limit` messages, still in ascending order: a truncated
    // stream should end at the newest message, not the oldest.
    return visible.slice(visible.length - input.limit);
  }

  /**
   * A worker's inbox: the messages addressed to it that it has not finished.
   *
   * Only waking messages appear, because a delivery row is only written for
   * those. Read messages are excluded; claimed ones are included so a worker
   * that stopped mid-way can pick its work back up.
   */
  listInbox(workerId: string): WorkerInboxEntry[] {
    const rows = this.db
      .prepare(
        `SELECT message_id, state FROM worker_message_deliveries
         WHERE worker_id = ? AND state IN ('unread', 'claimed')
         ORDER BY message_id ASC`,
      )
      .all(workerId) as Array<{ message_id: string; state: string }>;

    return rows.flatMap((row) => {
      const message = this.getMessage(row.message_id);
      if (!message) return [];
      return [{ message, state: row.state as WorkerMessageDeliveryState }];
    });
  }

  // ------------------------------------------------------------------ goals

  /**
   * Create a group's goal.
   *
   * One per group: the stream has a single objective, and `reopen` carries it
   * forward rather than starting a second one. The unique index makes a second
   * row unrepresentable; this check exists only to say so readably.
   */
  createGoal(input: {
    goalId: string;
    groupId: string;
    content: string;
    turnLimit: number;
    now?: string;
  }): WorkerGoalRecord {
    if (!this.getGroup(input.groupId)) {
      throw new Error(`unknown worker group: ${input.groupId}`);
    }
    if (this.getGoal(input.groupId)) {
      throw new WorkerGoalActionError(
        `Group ${input.groupId} already has a goal. Reopen it instead of creating another.`,
      );
    }
    assertTurnLimit(input.turnLimit);

    const startSeq = this.maxMessageSeq(input.groupId);
    const at = input.now ?? new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO worker_goals
           (goal_id, group_id, content, turn_limit, status, generation, revision,
            pause_reason, result_message_id, generation_start_seq, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', 1, 1, NULL, NULL, ?, ?, ?)`,
      )
      .run(input.goalId, input.groupId, input.content, input.turnLimit, startSeq, at, at);

    const created = this.getGoal(input.groupId);
    if (!created) throw new Error(`goal ${input.goalId} vanished immediately after insert`);
    return created;
  }

  getGoal(groupId: string): WorkerGoalRecord | null {
    const row = this.db
      .prepare(
        `SELECT goal_id, group_id, content, turn_limit, status, generation, revision,
                pause_reason, result_message_id, generation_start_seq, created_at, updated_at
         FROM worker_goals WHERE group_id = ?`,
      )
      .get(groupId) as WorkerGoalRow | undefined;
    return row ? this.toGoalRecord(row) : null;
  }

  /**
   * Apply one goal mutation, refusing a stale one.
   *
   * The comparison and the write are the same statement, so a mutation written
   * against a state that has since changed updates nothing and is reported as a
   * conflict. Reading first and then writing would leave a window in which two
   * runs both believe they won.
   */
  mutateGoal(input: MutateWorkerGoalInput): WorkerGoalRecord {
    const current = this.getGoal(input.groupId);
    if (!current) {
      throw new Error(`unknown worker goal for group: ${input.groupId}`);
    }
    const next = planGoalMutation(current, input, this.maxMessageSeq(input.groupId));
    const at = input.now ?? new Date().toISOString();

    const result = this.db
      .prepare(
        `UPDATE worker_goals
         SET content = ?, turn_limit = ?, status = ?, generation = ?, revision = ?,
             pause_reason = ?, result_message_id = ?, generation_start_seq = ?, updated_at = ?
         WHERE goal_id = ? AND generation = ? AND revision = ?`,
      )
      .run(
        next.content,
        next.turnLimit,
        next.status,
        next.generation,
        next.revision,
        next.pauseReason,
        next.resultMessageId,
        next.generationStartSeq,
        at,
        current.goalId,
        input.expectedGeneration,
        input.expectedRevision,
      );

    if (result.changes === 0) {
      throw new WorkerGoalConflictError(input.groupId);
    }

    const updated = this.getGoal(input.groupId);
    if (!updated) throw new Error(`goal ${current.goalId} vanished after update`);
    return updated;
  }

  /**
   * Public messages counted against the current generation.
   *
   * Private messages are excluded because the budget is a bound on what the
   * group says in public, not on what it takes to get there. The window starts
   * at the generation, so reopening starts a fresh count.
   */
  private countGoalTurns(row: WorkerGoalRow): number {
    const counted = this.db
      .prepare(
        `SELECT COUNT(*) AS turns FROM worker_messages m
         WHERE m.group_id = ? AND m.seq > ?
           AND NOT EXISTS (
             SELECT 1 FROM worker_message_private_to p WHERE p.message_id = m.message_id
           )`,
      )
      .get(row.group_id, row.generation_start_seq) as { turns: number };
    return counted.turns;
  }

  /** The group's newest sequence, or 0 when nothing has been said yet. */
  private maxMessageSeq(groupId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM worker_messages WHERE group_id = ?")
      .get(groupId) as { seq: number };
    return row.seq;
  }

  private toGoalRecord(row: WorkerGoalRow): WorkerGoalRecord {
    return {
      goalId: row.goal_id,
      groupId: row.group_id,
      content: row.content,
      turnLimit: row.turn_limit,
      status: row.status as WorkerGoalStatus,
      generation: row.generation,
      revision: row.revision,
      pauseReason: row.pause_reason as WorkerGoalPauseReason | null,
      resultMessageId: row.result_message_id,
      generationStartSeq: row.generation_start_seq,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      turnUsed: this.countGoalTurns(row),
    };
  }

  /**
   * Mark a delivery picked up, or finished.
   *
   * Returns false when the worker has no delivery for the message, which means
   * it was not addressed by it. That is a normal answer rather than an error:
   * a worker reading history should not be able to claim work addressed to
   * someone else.
   */
  markDelivery(input: {
    messageId: string;
    workerId: string;
    state: WorkerMessageDeliveryState;
    at?: string;
  }): boolean {
    const at = input.at ?? new Date().toISOString();
    const result =
      input.state === "claimed"
        ? this.db
            .prepare(
              `UPDATE worker_message_deliveries SET state = 'claimed', claimed_at = ?
               WHERE message_id = ? AND worker_id = ? AND state = 'unread'`,
            )
            .run(at, input.messageId, input.workerId)
        : this.db
            .prepare(
              `UPDATE worker_message_deliveries SET state = 'read', read_at = ?, claimed_at = COALESCE(claimed_at, ?)
               WHERE message_id = ? AND worker_id = ? AND state IN ('unread', 'claimed')`,
            )
            .run(at, at, input.messageId, input.workerId);
    return result.changes > 0;
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
  status: string;
  created_at: string;
  updated_at: string;
}

interface WorkerGoalRow {
  goal_id: string;
  group_id: string;
  content: string;
  turn_limit: number;
  status: string;
  generation: number;
  revision: number;
  pause_reason: string | null;
  result_message_id: string | null;
  generation_start_seq: number;
  created_at: string;
  updated_at: string;
}

interface WorkerMessageRow {
  message_id: string;
  group_id: string;
  seq: number;
  sender_worker_id: string;
  body: string;
  intent: string;
  delivery_policy: string;
  reply_to_message_id: string | null;
  created_at: string;
}

/** The same estimate as `WorkerStore.suggestTurnLimit`, as a SQL expression. */
function suggestTurnLimitSql(memberCountExpr: string): string {
  return `MIN(${WORKER_GOAL_TURN_LIMIT_MAX}, MAX(
    CASE WHEN ${memberCountExpr} <= 1 THEN ${WORKER_GOAL_TURN_LIMIT_DEFAULT} ELSE ${WORKER_GOAL_TURN_LIMIT_MIN} END,
    CAST(2 * ${memberCountExpr} * 1.35 + 0.999 AS INTEGER)
  ))`;
}

function assertTurnLimit(turnLimit: number): void {
  if (
    !Number.isSafeInteger(turnLimit) ||
    turnLimit < WORKER_GOAL_TURN_LIMIT_MIN ||
    turnLimit > WORKER_GOAL_TURN_LIMIT_MAX
  ) {
    throw new WorkerGoalActionError(
      `A goal's turn limit must be an integer between ${WORKER_GOAL_TURN_LIMIT_MIN} and ${WORKER_GOAL_TURN_LIMIT_MAX}.`,
    );
  }
}

/**
 * Work out the goal's next state for one action.
 *
 * Kept separate from the write so the rules read as rules: each action is
 * validated against the state it is allowed to act on, and the version it
 * produces is decided here rather than by the caller.
 */
function planGoalMutation(
  current: WorkerGoalRecord,
  input: MutateWorkerGoalInput,
  /** The group's newest message sequence, used as the new generation's boundary. */
  latestSeq: number,
): {
  content: string;
  turnLimit: number;
  status: WorkerGoalStatus;
  generation: number;
  revision: number;
  pauseReason: WorkerGoalPauseReason | null;
  resultMessageId: string | null;
  /** Public messages must exceed this sequence to count against the budget. */
  generationStartSeq: number;
} {
  const base = {
    content: current.content,
    turnLimit: current.turnLimit,
    status: current.status,
    generation: current.generation,
    revision: current.revision + 1,
    pauseReason: current.pauseReason,
    resultMessageId: current.resultMessageId,
    generationStartSeq: current.generationStartSeq,
  };

  switch (input.action) {
    case "update": {
      requireActive(current, "update");
      const content = input.content ?? current.content;
      if (content.trim().length === 0) {
        throw new WorkerGoalActionError("An update must keep a non-empty objective.");
      }
      const turnLimit = input.turnLimit ?? current.turnLimit;
      assertTurnLimit(turnLimit);
      return { ...base, content, turnLimit };
    }
    case "complete": {
      requireActive(current, "complete");
      if (!input.resultMessageId) {
        throw new WorkerGoalActionError(
          "Completing a goal requires the message that delivered the result.",
        );
      }
      return {
        ...base,
        status: "completed",
        resultMessageId: input.resultMessageId,
        pauseReason: null,
      };
    }
    case "pause": {
      requireActive(current, "pause");
      if (!input.pauseReason) {
        throw new WorkerGoalActionError("Pausing a goal requires a reason.");
      }
      return { ...base, status: "paused", pauseReason: input.pauseReason };
    }
    case "reopen": {
      if (current.status === "active") {
        throw new WorkerGoalActionError("This goal is already active; update it instead.");
      }
      const content = input.content ?? current.content;
      if (content.trim().length === 0) {
        throw new WorkerGoalActionError("Reopening a goal requires a non-empty objective.");
      }
      const turnLimit = input.turnLimit ?? current.turnLimit;
      assertTurnLimit(turnLimit);
      // A new generation: a fresh attempt, and a fresh budget to spend on it.
      return {
        ...base,
        content,
        turnLimit,
        status: "active",
        generation: current.generation + 1,
        pauseReason: null,
        resultMessageId: null,
        generationStartSeq: latestSeq,
      };
    }
  }
}

function requireActive(current: WorkerGoalRecord, action: string): void {
  if (current.status !== "active") {
    throw new WorkerGoalActionError(
      `Cannot ${action} a goal that is ${current.status}. Reopen it first.`,
    );
  }
}

function toMessageRecord(
  row: WorkerMessageRow,
  audience: string[],
  privateTo: string[],
): WorkerMessageRecord {
  return {
    messageId: row.message_id,
    groupId: row.group_id,
    seq: row.seq,
    senderWorkerId: row.sender_worker_id,
    body: row.body,
    intent: row.intent as WorkerMessageIntent,
    deliveryPolicy: row.delivery_policy as WorkerMessageDeliveryPolicy,
    replyToMessageId: row.reply_to_message_id,
    audience,
    privateTo,
    createdAt: row.created_at,
  };
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
