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

import type { DatabaseSync } from "node:sqlite";

import { applyMigrations, type Migration } from "./migrations/runner.js";
import {
  AGENT_SELECT,
  COMMENT_SELECT,
  ISSUE_SELECT,
  mapAgentRow,
  mapCommentRow,
  mapIssueRow,
  type AgentRow,
  type CommentRow,
  type IssueRow,
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
    return this.getIssue(input.id);
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

  listAgents(filter: { readonly includeArchived?: boolean } = {}): AgentRow[] {
    // The source's ListAgents excludes system-kind rows (hidden execution
    // carriers) and archived ones; ListAllAgentsAnyKind is the admin surface.
    const clause = filter.includeArchived
      ? " WHERE kind != 'system'"
      : " WHERE kind != 'system' AND archived_at IS NULL";
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
