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
import { ISSUE_SELECT, mapIssueRow, type IssueRow } from "./rows.js";

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
