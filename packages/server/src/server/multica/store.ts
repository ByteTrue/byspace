/**
 * The store: typed data access over the migrated SQLite schema.
 *
 * Ported from multica's pkg/db/queries (sqlc) — the query layer the handlers
 * call. Where a source query's shape is dictated by the multitenancy cut
 * (workspace_id filters, involves_user_id visibility widening), the replica
 * collapses the branch rather than translating it: one local user means
 * visibility is not a query concern here.
 *
 * Concurrency: writes run inside BEGIN IMMEDIATE transactions, the storage
 * decision's mapping of the source's row locks. The issue-number allocation
 * is the load-bearing case — the source reads the counter and inserts in one
 * transaction, and the replica must not widen that window.
 */
import { randomUUID } from "node:crypto";

import {
  computeWakeupNextFire,
  mapWakeupRow,
  WAKEUP_SELECT,
  type ReadyWakeup,
  type WakeupCaptureInput,
  type WakeupKind,
  type WakeupMode,
  type WakeupRow,
} from "./wakeup.js";

import type { DatabaseSync } from "node:sqlite";

import { applyMigrations, type Migration } from "./migrations/runner.js";
import {
  AGENT_SELECT,
  SQUAD_SELECT,
  TASK_SELECT,
  COMMENT_SELECT,
  ISSUE_SELECT,
  mapAgentRow,
  mapCommentRow,
  mapIssueRow,
  mapSquadMemberRow,
  mapSquadRow,
  mapTaskRow,
  type AgentRow,
  type CommentRow,
  type IssueRow,
  type SquadMemberRow,
  type SquadRow,
  type TaskRow,
} from "./rows.js";

export interface MulticaStoreOptions {
  readonly migrations: readonly Migration[];
}

export class MulticaStore {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync, options: MulticaStoreOptions) {
    this.#db = db;
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA journal_mode = WAL");
    applyMigrations(db, options.migrations);
  }

  close(): void {
    this.#db.close();
  }

  // ------------------------------------------------------------- issues

  createIssue(input: {
    readonly title: string;
    readonly description?: string | null;
    readonly status?: string;
    readonly priority?: string;
    readonly assigneeType?: string | null;
    readonly assigneeId?: string | null;
    readonly creatorType: string;
    readonly creatorId: string;
    readonly parentIssueId?: string | null;
    readonly projectId?: string | null;
    readonly originType?: string | null;
  }): IssueRow {
    const id = randomUUID();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      // One number per issue, allocated under the write lock — the source
      // reads its workspace counter and inserts atomically; same window.
      const counter = this.#db.prepare("SELECT next_value FROM issue_number_sequence").get() as {
        next_value: number;
      };
      this.#db.prepare("UPDATE issue_number_sequence SET next_value = next_value + 1").run();
      const number = counter.next_value;

      this.#db
        .prepare(
          `INSERT INTO issue (id, title, description, status, priority, assignee_type, assignee_id,
             creator_type, creator_id, parent_issue_id, number, project_id, origin_type,
             last_activity_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
        )
        .run(
          id,
          input.title,
          input.description ?? null,
          input.status ?? "backlog",
          input.priority ?? "none",
          input.assigneeType ?? null,
          input.assigneeId ?? null,
          input.creatorType,
          input.creatorId,
          input.parentIssueId ?? null,
          number,
          input.projectId ?? null,
          input.originType ?? null,
        );
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return this.getIssue(id);
  }

  getIssue(id: string): IssueRow {
    const raw = this.#db.prepare(`SELECT ${ISSUE_SELECT} FROM issue WHERE id = ?`).get(id);
    if (!raw) {
      throw new Error(`issue not found: ${id}`);
    }
    return mapIssueRow(raw as never);
  }

  listIssues(filter: {
    readonly status?: string;
    readonly assigneeId?: string;
    readonly projectId?: string;
    readonly limit?: number;
  }): IssueRow[] {
    // The source's optional-filter shape, with the workspace and visibility
    // branches collapsed by the cut.
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.status !== undefined) {
      where.push("status = ?");
      params.push(filter.status);
    }
    if (filter.assigneeId !== undefined) {
      where.push("assignee_id = ?");
      params.push(filter.assigneeId);
    }
    if (filter.projectId !== undefined) {
      where.push("project_id = ?");
      params.push(filter.projectId);
    }
    const clause = where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "";
    const limit = filter.limit ?? 200;
    const rows = this.#db
      .prepare(
        `SELECT ${ISSUE_SELECT} FROM issue${clause} ORDER BY position ASC, created_at DESC, number DESC LIMIT ?`,
      )
      .all(...params, limit);
    return rows.map((row) => mapIssueRow(row as never));
  }

  /**
   * Update an issue's editable fields with revision-checked optimism.
   *
   * The source's UpdateAgent/UpdateIssue pattern: omitted fields keep their
   * values, provided fields replace them (null clears where the field is
   * nullable). A status change enqueues through the trigger engine by the
   * handler, not here — the store owns the row, the handler owns the rules.
   */
  updateIssue(input: {
    readonly id: string;
    readonly expectedRevision: number;
    readonly status?: string;
    readonly priority?: string;
    readonly assigneeType?: string | null;
    readonly assigneeId?: string | null;
    readonly title?: string;
  }): IssueRow {
    const before = this.getIssue(input.id);
    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.status !== undefined) {
      sets.push("status = ?");
      params.push(input.status);
    }
    if (input.priority !== undefined) {
      sets.push("priority = ?");
      params.push(input.priority);
    }
    if (input.assigneeType !== undefined) {
      sets.push("assignee_type = ?");
      params.push(input.assigneeType);
    }
    if (input.assigneeId !== undefined) {
      sets.push("assignee_id = ?");
      params.push(input.assigneeId);
    }
    if (input.title !== undefined) {
      sets.push("title = ?");
      params.push(input.title);
    }
    if (sets.length === 0) {
      return this.getIssue(input.id);
    }
    sets.push("revision = revision + 1");
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    const result = this.#db
      .prepare(`UPDATE issue SET ${sets.join(", ")} WHERE id = ? AND revision = ?`)
      .run(...params, input.id, input.expectedRevision);
    if (Number(result.changes) === 0) {
      throw new Error(
        `issue ${input.id} changed since revision ${input.expectedRevision}; read it again`,
      );
    }
    const after = this.getIssue(input.id);
    if (input.status !== undefined && input.status !== before.status) {
      this.#afterStatusWrite(input.id, before.status, after.revision, input.status);
    }
    return this.getIssue(input.id);
  }

  /**
   * Update an issue's status with revision-checked optimism.
   *
   * The source's UpdateIssueStatus updates under a row lock and bumps
   * revision; SQLite's equivalent is the write transaction plus a WHERE on
   * the revision the caller read — changes === 0 means a concurrent writer
   * won, and the caller must re-read rather than overwrite.
   */
  updateIssueStatus(input: {
    readonly id: string;
    readonly status: string;
    readonly expectedRevision: number;
  }): IssueRow {
    const before = this.getIssue(input.id).status;
    const result = this.#db
      .prepare(
        `UPDATE issue SET status = ?, revision = revision + 1,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ? AND revision = ?`,
      )
      .run(input.status, input.id, input.expectedRevision);
    if (Number(result.changes) === 0) {
      throw new Error(
        `issue ${input.id} changed since revision ${input.expectedRevision}; read it again`,
      );
    }
    const updated = this.getIssue(input.id);
    this.#afterStatusWrite(input.id, before, updated.revision, input.status);
    return updated;
  }

  // ------------------------------------------------------------- agents

  createAgent(input: {
    readonly name: string;
    readonly description?: string;
    readonly instructions?: string;
    readonly kind?: string;
    readonly systemKey?: string | null;
    readonly permissionMode?: string;
  }): AgentRow {
    const id = randomUUID();
    this.#db
      .prepare(
        `INSERT INTO agent (id, name, runtime_mode, description, instructions, kind, system_key,
           permission_mode)
         VALUES (?, ?, 'local', ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.description ?? "",
        input.instructions ?? "",
        input.kind ?? "user",
        input.systemKey ?? null,
        input.permissionMode ?? "private",
      );
    return this.getAgent(id);
  }

  getAgent(id: string): AgentRow {
    const raw = this.#db.prepare(`SELECT ${AGENT_SELECT} FROM agent WHERE id = ?`).get(id);
    if (!raw) {
      throw new Error(`agent not found: ${id}`);
    }
    return mapAgentRow(raw as never);
  }

  listAgents(
    filter: { readonly includeArchived?: boolean; readonly includeSystem?: boolean } = {},
  ): AgentRow[] {
    // The source's ListAgents excludes system-kind rows (hidden execution
    // carriers) and archived ones; ListAllAgentsAnyKind is the admin surface.
    // Name resolution for assignees needs the system rows too (the secretary
    // is one), so includeSystem widens just that half of the filter.
    const kindClause = filter.includeSystem ? "" : "kind != 'system'";
    const archivedClause = filter.includeArchived ? "" : "archived_at IS NULL";
    const where = [kindClause, archivedClause].filter((part) => part !== "").join(" AND ");
    const clause = where === "" ? "" : ` WHERE ${where}`;
    const rows = this.#db
      .prepare(`SELECT ${AGENT_SELECT} FROM agent${clause} ORDER BY created_at DESC`)
      .all();
    return rows.map((row) => mapAgentRow(row as never));
  }

  /**
   * The built-in-agent lookup: find the row a system key stands for.
   *
   * The source resolves its Chief of Staff this way (MikaSystemKey), and the
   * display name is never the identity — an owner may rename the agent and
   * everything server-side keeps working.
   */
  getAgentBySystemKey(systemKey: string): AgentRow | null {
    const raw = this.#db
      .prepare(`SELECT ${AGENT_SELECT} FROM agent WHERE system_key = ? AND kind = 'system'`)
      .get(systemKey);
    return raw ? mapAgentRow(raw as never) : null;
  }

  updateAgentStatus(id: string, status: string): void {
    const result = this.#db
      .prepare(
        `UPDATE agent SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      )
      .run(status, id);
    if (Number(result.changes) === 0) {
      throw new Error(`agent not found: ${id}`);
    }
  }

  // ------------------------------------------------------------- comments

  /**
   * Create a comment and touch its issue, atomically.
   *
   * The source's CreateComment makes the two inseparable with a data-modifying
   * CTE: the issue's updated_at, revision, and last_activity_at bump in the
   * same statement as the insert, so an issue is never left with a stale
   * updated_at after a comment persists, and a comment can only attach to an
   * issue that actually exists. The same two guarantees, mapped to one
   * IMMEDIATE transaction here; a missing issue fails the UPDATE's row count
   * before any insert happens.
   */
  createComment(input: {
    readonly issueId: string;
    readonly authorType: string;
    readonly authorId: string;
    readonly content: string;
    readonly type?: string;
    readonly parentId?: string | null;
    readonly sourceTaskId?: string | null;
  }): CommentRow {
    const id = randomUUID();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const touched = this.#db
        .prepare(
          `UPDATE issue SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             revision = revision + 1,
             last_activity_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE id = ?`,
        )
        .run(input.issueId);
      if (Number(touched.changes) === 0) {
        throw new Error(`issue not found: ${input.issueId}`);
      }
      this.#db
        .prepare(
          `INSERT INTO comment (id, issue_id, author_type, author_id, content, type, parent_id, source_task_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.issueId,
          input.authorType,
          input.authorId,
          input.content,
          input.type ?? "comment",
          input.parentId ?? null,
          input.sourceTaskId ?? null,
        );
      // The capture rides inside the same transaction: a comment cannot
      // land without offering itself to every matching subscription. The
      // payload carries references only — never the body (source contract).
      this.captureWakeups({
        issueId: input.issueId,
        type: "comment.created",
        key: id,
        agentId: input.authorType === "agent" ? input.authorId : null,
        taskId: input.sourceTaskId ?? null,
        payload: { comment_id: id, author_type: input.authorType },
      });
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    const raw = this.#db.prepare(`SELECT ${COMMENT_SELECT} FROM comment WHERE id = ?`).get(id);
    return mapCommentRow(raw as never);
  }

  getComment(id: string): CommentRow {
    const raw = this.#db.prepare(`SELECT ${COMMENT_SELECT} FROM comment WHERE id = ?`).get(id);
    if (!raw) {
      throw new Error(`comment not found: ${id}`);
    }
    return mapCommentRow(raw as never);
  }

  listCommentsForIssue(issueId: string): CommentRow[] {
    // The source orders threads by updated_at desc (root position), children
    // by created_at asc; the flat list here preserves the same root order and
    // leaves threading to the reader.
    const rows = this.#db
      .prepare(
        `SELECT ${COMMENT_SELECT} FROM comment WHERE issue_id = ? AND deleted_at IS NULL
         ORDER BY (parent_id IS NULL) DESC, created_at ASC`,
      )
      .all(issueId);
    return rows.map((row) => mapCommentRow(row as never));
  }

  // ------------------------------------------------------------- squads

  createSquad(input: {
    readonly name: string;
    readonly description?: string;
    readonly leaderId: string;
    readonly creatorType: string;
    readonly creatorId: string;
    readonly instructions?: string;
  }): SquadRow {
    const id = randomUUID();
    this.#db
      .prepare(
        `INSERT INTO squad (id, name, description, leader_id, creator_type, creator_id, instructions)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.description ?? "",
        input.leaderId,
        input.creatorType,
        input.creatorId,
        input.instructions ?? "",
      );
    return this.getSquad(id);
  }

  getSquad(id: string): SquadRow {
    const raw = this.#db.prepare(`SELECT ${SQUAD_SELECT} FROM squad WHERE id = ?`).get(id);
    if (!raw) {
      throw new Error(`squad not found: ${id}`);
    }
    return mapSquadRow(raw as never);
  }

  listSquads(): SquadRow[] {
    // The source lists active squads, archived ones excluded.
    const rows = this.#db
      .prepare(
        `SELECT ${SQUAD_SELECT} FROM squad WHERE archived_at IS NULL ORDER BY created_at DESC`,
      )
      .all();
    return rows.map((row) => mapSquadRow(row as never));
  }

  addSquadMember(input: {
    readonly squadId: string;
    readonly memberType: string;
    readonly memberId: string;
    readonly role?: string;
  }): SquadMemberRow {
    const id = randomUUID();
    this.#db
      .prepare(
        `INSERT INTO squad_member (id, squad_id, member_type, member_id, role) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, input.squadId, input.memberType, input.memberId, input.role ?? "");
    const raw = this.#db.prepare(`SELECT * FROM squad_member WHERE id = ?`).get(id);
    return mapSquadMemberRow(raw as never);
  }

  removeSquadMember(squadId: string, memberType: string, memberId: string): void {
    const result = this.#db
      .prepare(`DELETE FROM squad_member WHERE squad_id = ? AND member_type = ? AND member_id = ?`)
      .run(squadId, memberType, memberId);
    if (Number(result.changes) === 0) {
      throw new Error(`squad member not found: ${memberType} ${memberId}`);
    }
  }

  listSquadMembers(squadId: string): SquadMemberRow[] {
    const rows = this.#db
      .prepare(`SELECT * FROM squad_member WHERE squad_id = ? ORDER BY created_at ASC`)
      .all(squadId);
    return rows.map((row) => mapSquadMemberRow(row as never));
  }

  // ------------------------------------------------------------- run queue

  /**
   * Enqueue a run: the queue row every trigger path funnels into.
   *
   * Ported from CreateAgentTask. The source's id is a UUIDv7 so consecutive
   * enqueues cluster in the primary-key range; the replica mints the same
   * shape with crypto.randomUUID (the clustering argument is a B-tree concern
   * the rowid index already provides). The workspace-teardown fence
   * (lock_task_owner_rows) is the multitenancy circle cut away: no workspace
   * rows exist to lock, and single-user means no teardown race.
   */
  createTask(input: {
    readonly agentId: string;
    readonly issueId: string;
    readonly priority?: number;
    readonly triggerCommentId?: string | null;
    readonly triggerSummary?: string | null;
    readonly isLeaderTask?: boolean;
    readonly squadId?: string | null;
    readonly handoffNote?: string | null;
    readonly context?: Record<string, unknown> | null;
  }): TaskRow {
    const id = randomUUID();
    this.#db
      .prepare(
        `INSERT INTO agent_task_queue (id, agent_id, issue_id, status, priority,
           trigger_comment_id, trigger_summary, is_leader_task, squad_id, handoff_note, context)
         VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.agentId,
        input.issueId,
        input.priority ?? 0,
        input.triggerCommentId ?? null,
        input.triggerSummary ?? null,
        input.isLeaderTask ? 1 : 0,
        input.squadId ?? null,
        input.handoffNote ?? null,
        input.context ? JSON.stringify(input.context) : null,
      );
    return this.getTask(id);
  }

  getTask(id: string): TaskRow {
    const raw = this.#db
      .prepare(`SELECT ${TASK_SELECT} FROM agent_task_queue WHERE id = ?`)
      .get(id);
    if (!raw) {
      throw new Error(`task not found: ${id}`);
    }
    return mapTaskRow(raw as never);
  }

  /**
   * Every task that has not settled yet — the board's "who is working"
   * source. A task is working from the moment it is claimed (queued counts:
   * the executor's one-run-per-agent bound means a queue slot is real
   * intent), through dispatch and run.
   */
  listRunningTasks(): TaskRow[] {
    const rows = this.#db
      .prepare(
        `SELECT ${TASK_SELECT} FROM agent_task_queue
         WHERE status IN ('queued', 'dispatched', 'running')
         ORDER BY created_at DESC`,
      )
      .all() as Record<string, unknown>[];
    return rows.map(mapTaskRow);
  }

  /**
   * Stamp the session a run executes in. The id is a fact about the task,
   * not a state transition, so it rides its own writer rather than the
   * status update — the same discipline the worker domain's attachRunSession
   * established.
   */
  attachTaskSession(taskId: string, sessionId: string): void {
    this.#db
      .prepare("UPDATE agent_task_queue SET session_id = ? WHERE id = ?")
      .run(sessionId, taskId);
  }

  /**
   * Reverse-resolve a session to the run executing in it. The source does
   * not index session_id (its indexes serve the chat-resume lookups), so
   * this is a scan over the queue — small by construction: one row per run,
   * and runs settle. A session with no run returns null: in this domain an
   * agent speaks on an issue only through a run.
   */
  getTaskBySession(sessionId: string): TaskRow | null {
    const row = this.#db
      .prepare(`SELECT ${TASK_SELECT} FROM agent_task_queue WHERE session_id = ?`)
      .get(sessionId) as Record<string, unknown> | undefined;
    return row ? mapTaskRow(row as never) : null;
  }

  listTasksForIssue(issueId: string): TaskRow[] {
    const rows = this.#db
      .prepare(
        `SELECT ${TASK_SELECT} FROM agent_task_queue WHERE issue_id = ? ORDER BY created_at DESC`,
      )
      .all(issueId);
    return rows.map((row) => mapTaskRow(row as never));
  }

  listQueuedTasks(): TaskRow[] {
    const rows = this.#db
      .prepare(
        `SELECT ${TASK_SELECT} FROM agent_task_queue WHERE status = 'queued' ORDER BY created_at ASC`,
      )
      .all();
    return rows.map((row) => mapTaskRow(row as never));
  }

  // ── wakeups ──────────────────────────────────────────────────────────

  createWakeup(input: {
    readonly issueId: string;
    readonly agentId: string;
    readonly createdBy: string;
    readonly instruction: string;
    readonly kind: WakeupKind;
    readonly mode: WakeupMode;
    readonly eventTypes?: readonly string[];
    readonly filterAgentId?: string | null;
    readonly filterTaskId?: string | null;
    readonly intervalSeconds?: number | null;
    readonly cronExpression?: string | null;
    readonly timezone?: string;
    readonly at?: string | null;
    readonly sourceTaskId?: string | null;
    readonly parentCommentId?: string | null;
  }): WakeupRow {
    const instruction = input.instruction.trim();
    if (instruction === "" || instruction.length > 12_000) {
      throw new Error("a wakeup needs an instruction of 1..12000 characters");
    }
    const timezone = input.timezone ?? "UTC";
    const nextFireAt = computeWakeupNextFire(
      {
        kind: input.kind,
        intervalSeconds: input.intervalSeconds ?? null,
        cronExpression: input.cronExpression ?? null,
        timezone,
        at: input.at ?? null,
      },
      new Date(),
    );
    const id = randomUUID();
    this.#db
      .prepare(
        `INSERT INTO issue_wakeup (id, issue_id, agent_id, created_by, source_task_id,
           parent_comment_id, instruction, kind, mode, event_types, filter_agent_id,
           filter_task_id, interval_seconds, cron_expression, timezone, next_fire_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.issueId,
        input.agentId,
        input.createdBy,
        input.sourceTaskId ?? null,
        input.parentCommentId ?? null,
        instruction,
        input.kind,
        input.mode,
        JSON.stringify(input.eventTypes ?? []),
        input.filterAgentId ?? null,
        input.filterTaskId ?? null,
        input.intervalSeconds ?? null,
        input.cronExpression ?? null,
        timezone,
        nextFireAt,
      );
    return this.getWakeup(id);
  }

  getWakeup(id: string): WakeupRow {
    const row = this.#db
      .prepare(`SELECT ${WAKEUP_SELECT} FROM issue_wakeup WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error(`Unknown wakeup: ${id}`);
    }
    return mapWakeupRow(row);
  }

  listWakeupsForIssue(issueId: string): WakeupRow[] {
    const rows = this.#db
      .prepare(`SELECT ${WAKEUP_SELECT} FROM issue_wakeup WHERE issue_id = ? ORDER BY created_at`)
      .all(issueId) as Record<string, unknown>[];
    return rows.map((row) => mapWakeupRow(row));
  }

  disableWakeup(id: string): WakeupRow {
    this.#db
      .prepare(
        `UPDATE issue_wakeup SET enabled = 0, disabled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?`,
      )
      .run(id);
    return this.getWakeup(id);
  }

  /**
   * The event-capture entry: the Node translation of the source's
   * capture_issue_wakeup stored function. Called from inside the write
   * methods below, so a state change cannot happen without offering itself
   * to every matching subscription.
   */
  captureWakeups(input: WakeupCaptureInput): number {
    const issue = this.getIssue(input.issueId);
    if (this.isIssueClosed(issue.status)) {
      return 0;
    }
    const matches = this.#db
      .prepare(
        `SELECT ${WAKEUP_SELECT} FROM issue_wakeup
         WHERE issue_id = ? AND enabled = 1 AND kind = 'event'
           AND EXISTS (
             SELECT 1 FROM json_each(event_types) WHERE json_each.value = ?
           )
           AND (filter_agent_id IS NULL OR filter_agent_id = ?)
           AND (filter_task_id IS NULL OR filter_task_id = ?)
           AND (source_task_id IS NULL OR source_task_id IS NOT ?)
           AND NOT (
             ? IS NOT NULL AND EXISTS (
               SELECT 1 FROM agent_task_queue t
               WHERE t.id = ? AND json_extract(t.context, '$.wakeup_id') = issue_wakeup.id
             )
           )`,
      )
      .all(
        input.issueId,
        input.type,
        input.agentId,
        input.taskId,
        input.taskId,
        input.taskId,
        input.taskId,
      ) as Record<string, unknown>[];
    let captured = 0;
    for (const raw of matches) {
      const result = this.#db
        .prepare(
          `INSERT INTO issue_wakeup_receipt
             (id, wakeup_id, revision, event_key, event_type, payload)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT DO NOTHING`,
        )
        .run(
          randomUUID(),
          raw.id as string,
          raw.revision as number,
          input.key,
          input.type,
          JSON.stringify(input.payload),
        );
      captured += Number(result.changes);
    }
    return captured;
  }

  /**
   * Subscriptions with work to dispatch: event kinds with unprocessed
   * receipts, time kinds whose next fire has arrived. The source's
   * ListReadyWakeups, minus its fleet-oriented locking.
   */
  listReadyWakeups(now: Date): ReadyWakeup[] {
    const iso = now.toISOString();
    const eventRows = this.#db
      .prepare(
        `SELECT w.id FROM issue_wakeup w
         WHERE w.enabled = 1 AND w.kind = 'event'
           AND EXISTS (
             SELECT 1 FROM issue_wakeup_receipt r
             WHERE r.wakeup_id = w.id AND r.processed_at IS NULL
           )`,
      )
      .all() as Array<{ id: string }>;
    const timeRows = this.#db
      .prepare(
        `SELECT id FROM issue_wakeup
         WHERE enabled = 1 AND kind IN ('at', 'every', 'cron')
           AND next_fire_at IS NOT NULL AND next_fire_at <= ?`,
      )
      .all(iso) as Array<{ id: string }>;
    const ready: ReadyWakeup[] = [];
    for (const { id } of [...eventRows, ...timeRows]) {
      const wakeup = this.getWakeup(id);
      const evidence = (
        this.#db
          .prepare(
            `SELECT payload FROM issue_wakeup_receipt
             WHERE wakeup_id = ? AND processed_at IS NULL ORDER BY created_at`,
          )
          .all(id) as Array<{ payload: string }>
      ).map((row) => JSON.parse(row.payload) as Record<string, unknown>);
      ready.push({
        wakeup,
        evidence:
          evidence.length > 0
            ? evidence
            : [{ event_type: "time.due", planned_at: wakeup.nextFireAt, kind: wakeup.kind }],
      });
    }
    return ready;
  }

  /**
   * Dispatch one ready wakeup: enqueue the run carrying the wakeup's
   * identity in its context (the self-trigger guard reads it back), settle
   * the receipts, and advance or retire the subscription.
   */
  dispatchWakeup(
    wakeup: WakeupRow,
    evidence: readonly Record<string, unknown>[],
    now: Date,
  ): string {
    const task = this.createTask({
      agentId: wakeup.agentId,
      issueId: wakeup.issueId,
      triggerSummary: `wakeup ${wakeup.kind}`,
      context: {
        wakeup_id: wakeup.id,
        wakeup_revision: wakeup.revision,
        wakeup_evidence: evidence,
      },
    });
    this.#db
      .prepare(
        `UPDATE issue_wakeup_receipt
         SET processed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), task_id = ?
         WHERE wakeup_id = ? AND processed_at IS NULL`,
      )
      .run(task.id, wakeup.id);
    // Stale receipts from an older revision are settled without dispatch:
    // an edit to the subscription discards queued work it predates.
    this.#db
      .prepare(
        `UPDATE issue_wakeup_receipt
         SET processed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE wakeup_id = ? AND revision <> ? AND processed_at IS NULL`,
      )
      .run(wakeup.id, wakeup.revision);
    if (wakeup.mode === "once" || wakeup.kind === "at") {
      this.disableWakeup(wakeup.id);
    } else if (wakeup.kind === "every" || wakeup.kind === "cron") {
      const next = computeWakeupNextFire(
        {
          kind: wakeup.kind,
          intervalSeconds: wakeup.intervalSeconds,
          cronExpression: wakeup.cronExpression,
          timezone: wakeup.timezone,
        },
        now,
      );
      this.#db
        .prepare(
          `UPDATE issue_wakeup SET next_fire_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE id = ?`,
        )
        .run(next, wakeup.id);
    }
    return task.id;
  }

  /**
   * A closed issue stops waking anyone: the source's StopClosedIssueWakeups,
   * called from the status write below.
   */
  stopWakeupsForClosedIssue(issueId: string): number {
    const result = this.#db
      .prepare(
        `UPDATE issue_wakeup
         SET enabled = 0, disabled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE issue_id = ? AND enabled = 1`,
      )
      .run(issueId);
    return Number(result.changes);
  }

  /** Processed receipts age out after seven days, as the source's Tick does. */
  purgeExpiredReceipts(now: Date): number {
    const cutoff = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
    const result = this.#db
      .prepare(
        `DELETE FROM issue_wakeup_receipt WHERE processed_at IS NOT NULL AND processed_at < ?`,
      )
      .run(cutoff);
    return Number(result.changes);
  }

  /**
   * The shared aftermath of any status write: offer the change to event
   * subscribers and stop waking on a closed issue. Both status write paths
   * (the status update and the field update that carries a status) call
   * this — a status change that bypassed capture would silently deafen
   * every subscription.
   */
  #afterStatusWrite(issueId: string, before: string, revision: number, to: string): void {
    this.captureWakeups({
      issueId,
      type: "issue.status_changed",
      key: `${issueId}:${revision}`,
      agentId: null,
      taskId: null,
      payload: { from: before, to },
    });
    if (this.isIssueClosed(to)) {
      this.stopWakeupsForClosedIssue(issueId);
    }
  }

  isIssueClosed(status: string): boolean {
    if (status === "done" || status === "cancelled") {
      return true;
    }
    const row = this.#db.prepare("SELECT category FROM issue_status WHERE key = ?").get(status) as
      | { category: string }
      | undefined;
    return row?.category === "done" || row?.category === "closed";
  }

  /**
   * Move a run's status, stamping the state's timestamp.
   *
   * The queue's status enum is the run lifecycle (queued → dispatched →
   * running → completed/failed/cancelled, plus deferred and
   * waiting_local_directory). Each transition stamps its own timestamp column
   * exactly as the source's per-state queries do.
   */
  updateTaskStatus(input: {
    readonly id: string;
    readonly status: string;
    readonly error?: string | null;
    readonly result?: string | null;
  }): TaskRow {
    const stamps: Record<string, string> = {
      dispatched: "dispatched_at",
      running: "started_at",
      completed: "completed_at",
      failed: "completed_at",
      cancelled: "completed_at",
    };
    const stamp = stamps[input.status];
    const errorClause = input.error !== undefined ? ", error = ?" : "";
    const resultClause = input.result !== undefined ? ", result = ?" : "";
    const params: unknown[] = [input.status];
    if (stamp !== undefined) {
      params.push(new Date().toISOString());
    }
    if (input.error !== undefined) {
      params.push(input.error);
    }
    if (input.result !== undefined) {
      params.push(JSON.stringify(input.result));
    }
    params.push(input.id);
    const result = this.#db
      .prepare(
        `UPDATE agent_task_queue SET status = ?${stamp !== undefined ? `, ${stamp} = ?` : ""}${errorClause}${resultClause}
         WHERE id = ?`,
      )
      .run(...params);
    if (Number(result.changes) === 0) {
      throw new Error(`task not found: ${input.id}`);
    }
    // A run settling is exactly the fact a "run.completed"-style subscriber
    // registered for. Capture rides the same write; the self-trigger guard
    // keeps the run from waking the subscription it registered itself.
    const row = this.getTask(input.id);
    this.captureWakeups({
      issueId: row.issueId,
      type: `task.${input.status}`,
      key: `${input.id}:${input.status}`,
      agentId: row.agentId,
      taskId: input.id,
      payload: { task_id: input.id, status: input.status },
    });
    return row;
  }

  // ------------------------------------------------------------- status catalog

  listIssueStatuses(): Array<{
    readonly key: string;
    readonly name: string;
    readonly category: string;
    readonly color: string;
    readonly isSystem: boolean;
    readonly position: number;
  }> {
    const rows = this.#db
      .prepare(
        "SELECT key, name, category, color, is_system, position FROM issue_status ORDER BY position",
      )
      .all() as Array<{
      key: string;
      name: string;
      category: string;
      color: string;
      is_system: number;
      position: number;
    }>;
    return rows.map((row) => ({
      key: row.key,
      name: row.name,
      category: row.category,
      color: row.color,
      isSystem: row.is_system === 1,
      position: row.position,
    }));
  }
}
