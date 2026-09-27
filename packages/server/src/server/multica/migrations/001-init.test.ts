/**
 * Tests for the SQLite translation of multica's 001_init.
 *
 * The contract is fidelity: every table and column of the source migration
 * appears here (modulo the sanctioned translations and the multitenancy cut),
 * the version table behaves like multica's, and up/down round-trips.
 *
 * Column lists are asserted against the source's field names, which were
 * copied from server/migrations/001_init.up.sql at commit 04cdd48 — if a
 * column is missing here, the replica has drifted from its source.
 */
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migration001Init } from "./001-init.js";
import { applyMigrations, appliedVersions, revertLastMigration } from "./runner.js";

let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
});

afterEach(() => {
  db.close();
});

function columns(table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (row) => row.name,
  );
}

/** The tables multica's 001 creates, minus the multitenancy cut. */
// Sorted: the assertion compares against a sorted list.
const EXPECTED_TABLES = [
  "activity_log",
  "agent",
  "agent_task_queue",
  "comment",
  "inbox_item",
  "issue",
  "issue_dependency",
  "issue_label",
  "issue_to_label",
];

describe("migration 001 (SQLite translation of multica 001_init)", () => {
  it("creates every source table", () => {
    applyMigrations(db, [migration001Init]);
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
        name: string;
      }>
    )
      .map((row) => row.name)
      .filter((name) => name !== "schema_migrations");
    expect([...tables].sort()).toEqual(EXPECTED_TABLES);
  });

  it("keeps the agent columns of the source, minus the cut", () => {
    applyMigrations(db, [migration001Init]);
    // Source order: id, workspace_id, name, avatar_url, runtime_mode,
    // runtime_config, visibility, status, max_concurrent_tasks, owner_id,
    // created_at, updated_at. Cut: workspace_id, owner_id.
    expect(columns("agent")).toEqual([
      "id",
      "name",
      "avatar_url",
      "runtime_mode",
      "runtime_config",
      "visibility",
      "status",
      "max_concurrent_tasks",
      "created_at",
      "updated_at",
    ]);
  });

  it("keeps the issue columns of the source, minus workspace_id", () => {
    applyMigrations(db, [migration001Init]);
    expect(columns("issue")).toEqual([
      "id",
      "title",
      "description",
      "status",
      "priority",
      "assignee_type",
      "assignee_id",
      "creator_type",
      "creator_id",
      "parent_issue_id",
      "acceptance_criteria",
      "context_refs",
      "position",
      "due_date",
      "created_at",
      "updated_at",
    ]);
  });

  it("keeps the comment, inbox, queue, and activity columns", () => {
    applyMigrations(db, [migration001Init]);
    expect(columns("comment")).toEqual([
      "id",
      "issue_id",
      "author_type",
      "author_id",
      "content",
      "type",
      "created_at",
      "updated_at",
    ]);
    expect(columns("inbox_item")).toEqual([
      "id",
      "recipient_type",
      "recipient_id",
      "type",
      "severity",
      "issue_id",
      "title",
      "body",
      "read",
      "archived",
      "created_at",
    ]);
    expect(columns("agent_task_queue")).toEqual([
      "id",
      "agent_id",
      "issue_id",
      "status",
      "priority",
      "dispatched_at",
      "started_at",
      "completed_at",
      "result",
      "error",
      "created_at",
    ]);
    expect(columns("activity_log")).toEqual([
      "id",
      "issue_id",
      "actor_type",
      "actor_id",
      "action",
      "details",
      "created_at",
    ]);
  });

  it("cut the member variant everywhere, keeping agent plus the owner", () => {
    // The single local user replaces the member/tenant layer; every *_type
    // CHECK that had 'member' in the source now has 'owner'.
    applyMigrations(db, [migration001Init]);
    const insert = db.prepare(
      "INSERT INTO issue (title, creator_type, creator_id) VALUES ('t', ?, 'x')",
    );
    expect(() => insert.run("owner")).not.toThrow();
    expect(() => insert.run("agent")).not.toThrow();
    expect(() => insert.run("member")).toThrow(/CHECK constraint/);
  });

  it("enforces the source's status and severity check constraints", () => {
    applyMigrations(db, [migration001Init]);
    expect(() =>
      db
        .prepare(
          "INSERT INTO issue (title, creator_type, creator_id, status) VALUES ('t','owner','x','bogus')",
        )
        .run(),
    ).toThrow(/CHECK constraint/);
    expect(() =>
      db
        .prepare(
          "INSERT INTO inbox_item (recipient_type, recipient_id, type, title, severity) VALUES ('owner','x','t','t','bogus')",
        )
        .run(),
    ).toThrow(/CHECK constraint/);
  });

  it("satisfies foreign keys after real inserts", () => {
    applyMigrations(db, [migration001Init]);
    db.prepare(
      "INSERT INTO issue (id, title, creator_type, creator_id) VALUES ('i1','t','owner','x')",
    ).run();
    db.prepare("INSERT INTO agent (id, name, runtime_mode) VALUES ('a1','A','local')").run();
    db.prepare(
      "INSERT INTO comment (issue_id, author_type, author_id, content) VALUES ('i1','agent','a1','hello')",
    ).run();
    db.prepare("INSERT INTO agent_task_queue (agent_id, issue_id) VALUES ('a1','i1')").run();
    expect((db.prepare("PRAGMA foreign_key_check").all() as unknown[]).length).toBe(0);
  });

  it("records the version and never reapplies", () => {
    applyMigrations(db, [migration001Init]);
    expect(appliedVersions(db)).toEqual(["001_init"]);
    // Second apply is a no-op: the version row gates it.
    applyMigrations(db, [migration001Init]);
    expect((db.prepare("SELECT COUNT(*) AS n FROM agent").get() as { n: number }).n).toBe(0);
  });

  it("reverts completely with down", () => {
    applyMigrations(db, [migration001Init]);
    expect(revertLastMigration(db, [migration001Init])).toBe("001_init");
    // The version table is the runner's own and survives a revert — the
    // migration's down only removes what the migration created.
    const left = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'",
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name);
    expect(left).toEqual([]);
  });

  it("a failing migration leaves no partial application and no version row", () => {
    // multica's runner contract: abort before recording, so the next run
    // retries exactly the failed migration.
    const broken = {
      version: "000_broken",
      up: (target: DatabaseSync) => {
        target.exec("CREATE TABLE half (id TEXT PRIMARY KEY)");
        throw new Error("boom");
      },
    };
    // The runner names the failing migration; the original error rides along as
    // the cause, which the next assertion reads back.
    expect(() => applyMigrations(db, [broken])).toThrow(/migration 000_broken failed/);
    expect(appliedVersions(db)).toEqual([]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'half'").get()).toBeUndefined();
  });
});
