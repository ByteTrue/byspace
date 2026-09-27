/**
 * Migrations 084 and 332–339 — SQLite translations of multica's
 * server/migrations/084_squad and 332…339 issue-status catalog (commit 04cdd48).
 *
 * Source contracts preserved:
 *
 *   084 — squad (leader references agent RESTRICT) and squad_member
 *         (agent|member, unique per squad), issue.assignee_type gains
 *         'squad' (already present in our 001 collapse; kept as a no-op
 *         assertion so the sequence stays diffable).
 *
 *   332 — the issue_status catalog. The MODEL the source documents: category
 *         maps one-to-one onto the 7 built-ins and a category's value IS its
 *         canonical key — no second behaves_as concept. issue.status stays
 *         the authoritative TEXT key, so no status_id, no backfill, no double
 *         write. Two table-level CHECKs: a built-in's key equals its category
 *         (Effective() identity), and a built-in can never be archived.
 *
 *   333/334 — PG's split out CONCURRENTLY-built index then PRIMARY KEY USING
 *         INDEX; SQLite has no concurrent-index concern, so the primary key
 *         is inline in 332 and these collapse to no-ops (kept as sequence
 *         entries for diffability against the source).
 *
 *   335/336 — unique (key) and (name) indexes; the source's workspace
 *         variants collapse to the single namespace.
 *
 *   337 — issue.status drops the hard-coded 7-value CHECK so catalog keys
 *         validate at the application layer.
 *
 *   339 — seed the 7 built-ins. The source seeds per existing workspace;
 *         single namespace seeds once. Descriptions carry the trigger
 *         semantics ("Assigning an issue here never starts an agent run",
 *         "Moving an issue here starts the assigned agent") verbatim — they
 *         are behavior contracts in words, not decoration.
 */
import type { Migration } from "./runner.js";

const TS = "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

export const migration084Squad: Migration = {
  version: "084_squad",
  up: (db) => {
    db.exec(`
      CREATE TABLE squad (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        leader_id TEXT NOT NULL REFERENCES agent(id) ON DELETE RESTRICT,
        creator_type TEXT NOT NULL CHECK (creator_type IN ('owner', 'agent')),
        creator_id TEXT NOT NULL,
        created_at ${TS},
        updated_at ${TS}
      );
      CREATE TABLE squad_member (
        id TEXT PRIMARY KEY,
        squad_id TEXT NOT NULL REFERENCES squad(id) ON DELETE CASCADE,
        member_type TEXT NOT NULL CHECK (member_type IN ('agent', 'owner')),
        member_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT '',
        created_at ${TS},
        UNIQUE (squad_id, member_type, member_id)
      );
      CREATE INDEX idx_squad_member_squad ON squad_member(squad_id);
      CREATE INDEX idx_squad_member_entity ON squad_member(member_type, member_id);
    `);
    // The source widens issue.assignee_type to include 'squad'; our 001
    // already created the widened check, so this asserts rather than alters.
    const check = (
      db.prepare("SELECT sql FROM sqlite_master WHERE name = 'issue'").get() as {
        sql: string;
      }
    ).sql;
    if (!check.includes("'squad'")) {
      throw new Error("001 should have created issue.assignee_type with 'squad'");
    }
  },
  down: (db) => {
    db.exec(`
      DROP TABLE IF EXISTS squad_member;
      DROP TABLE IF EXISTS squad;
    `);
  },
};

export const migration332IssueStatus: Migration = {
  version: "332_issue_status",
  up: (db) => {
    // Inline PRIMARY KEY: 333/334's split is a PG concurrency convention,
    // not part of the model.
    db.exec(`
      CREATE TABLE issue_status (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL CHECK (key GLOB '[a-z0-9][a-z0-9_]*' AND length(key) BETWEEN 1 AND 32),
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
        description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 256),
        category TEXT NOT NULL CHECK (
          category IN ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled')
        ),
        color TEXT NOT NULL CHECK (color GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
        is_system INTEGER NOT NULL DEFAULT 0,
        position REAL NOT NULL DEFAULT 0,
        archived_at TEXT,
        created_at ${TS},
        updated_at ${TS},
        CONSTRAINT issue_status_system_is_canonical
          CHECK (NOT is_system OR key = category),
        CONSTRAINT issue_status_system_not_archivable
          CHECK (NOT is_system OR archived_at IS NULL)
      );
    `);
  },
  down: (db) => {
    db.exec("DROP TABLE IF EXISTS issue_status;");
  },
};

export const migration333IssueStatusPkeyIndex: Migration = {
  version: "333_issue_status_pkey_index",
  up: () => {
    // PG concurrency split; nothing to do — 332 declared the primary key.
  },
  down: () => {},
};

export const migration334IssueStatusPrimaryKey: Migration = {
  version: "334_issue_status_primary_key",
  up: () => {
    // PG concurrency split; nothing to do.
  },
  down: () => {},
};

export const migration335IssueStatusWorkspaceKeyIndex: Migration = {
  version: "335_issue_status_workspace_key_index",
  up: (db) => {
    db.exec("CREATE UNIQUE INDEX idx_issue_status_key ON issue_status(key);");
  },
  down: (db) => {
    db.exec("DROP INDEX IF EXISTS idx_issue_status_key;");
  },
};

export const migration336IssueStatusWorkspaceNameIndex: Migration = {
  version: "336_issue_status_workspace_name_index",
  up: (db) => {
    db.exec("CREATE UNIQUE INDEX idx_issue_status_name ON issue_status(name);");
  },
  down: (db) => {
    db.exec("DROP INDEX IF EXISTS idx_issue_status_name;");
  },
};

export const migration337IssueStatusOpenCheck: Migration = {
  version: "337_issue_status_open_check",
  up: (db) => {
    // Rebuild issue without the hard-coded status CHECK: membership validates
    // against the catalog at the application layer, exactly as the source
    // opens it.
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(`
      CREATE TABLE issue_337 (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
        status TEXT NOT NULL DEFAULT 'backlog',
        priority TEXT NOT NULL DEFAULT 'none'
          CHECK (priority IN ('urgent', 'high', 'medium', 'low', 'none')),
        assignee_type TEXT CHECK (assignee_type IN ('owner', 'agent', 'squad')),
        assignee_id TEXT,
        creator_type TEXT NOT NULL CHECK (creator_type IN ('owner', 'agent')),
        creator_id TEXT NOT NULL,
        parent_issue_id TEXT REFERENCES issue_337(id) ON DELETE SET NULL,
        acceptance_criteria TEXT NOT NULL DEFAULT '[]',
        context_refs TEXT NOT NULL DEFAULT '[]',
        position REAL NOT NULL DEFAULT 0,
        due_date TEXT,
        number INTEGER,
        project_id TEXT REFERENCES project(id) ON DELETE SET NULL,
        origin_type TEXT CHECK (origin_type IN ('autopilot')),
        first_executed_at TEXT,
        stage INTEGER CHECK (stage IS NULL OR stage >= 1),
        created_at ${TS}, updated_at ${TS}
      );
      INSERT INTO issue_337 SELECT id, title, description, status, priority, assignee_type, assignee_id,
        creator_type, creator_id, parent_issue_id, acceptance_criteria, context_refs, position, due_date,
        number, project_id, origin_type, first_executed_at, stage, created_at, updated_at FROM issue;
      DROP TABLE issue; ALTER TABLE issue_337 RENAME TO issue;
      CREATE UNIQUE INDEX idx_issue_number ON issue(number);
      CREATE INDEX idx_issue_assignee ON issue(assignee_type, assignee_id);
      CREATE INDEX idx_issue_status ON issue(status);
      CREATE INDEX idx_issue_parent ON issue(parent_issue_id);
      CREATE INDEX idx_issue_project ON issue(project_id);
    `);
    db.exec("PRAGMA foreign_keys = ON");
  },
  down: (db) => {
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(`
      CREATE TABLE issue_337d (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
        status TEXT NOT NULL DEFAULT 'backlog'
          CHECK (status IN ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled')),
        priority TEXT NOT NULL DEFAULT 'none'
          CHECK (priority IN ('urgent', 'high', 'medium', 'low', 'none')),
        assignee_type TEXT CHECK (assignee_type IN ('owner', 'agent', 'squad')),
        assignee_id TEXT,
        creator_type TEXT NOT NULL CHECK (creator_type IN ('owner', 'agent')),
        creator_id TEXT NOT NULL,
        parent_issue_id TEXT REFERENCES issue_337d(id) ON DELETE SET NULL,
        acceptance_criteria TEXT NOT NULL DEFAULT '[]',
        context_refs TEXT NOT NULL DEFAULT '[]',
        position REAL NOT NULL DEFAULT 0,
        due_date TEXT,
        number INTEGER,
        project_id TEXT REFERENCES project(id) ON DELETE SET NULL,
        origin_type TEXT CHECK (origin_type IN ('autopilot')),
        created_at ${TS}, updated_at ${TS}
      );
      INSERT INTO issue_337d SELECT id, title, description, status, priority, assignee_type, assignee_id,
        creator_type, creator_id, parent_issue_id, acceptance_criteria, context_refs, position, due_date,
        number, project_id, origin_type, created_at, updated_at FROM issue;
      DROP TABLE issue; ALTER TABLE issue_337d RENAME TO issue;
      CREATE UNIQUE INDEX idx_issue_number ON issue(number);
      CREATE INDEX idx_issue_assignee ON issue(assignee_type, assignee_id);
      CREATE INDEX idx_issue_status ON issue(status);
      CREATE INDEX idx_issue_parent ON issue(parent_issue_id);
      CREATE INDEX idx_issue_project ON issue(project_id);
    `);
    db.exec("PRAGMA foreign_keys = ON");
  },
};

/** 338 validates a NOT VALID constraint from 330 — PG mechanics, nothing here. */
export const migration338IssueStatusValidateFormat: Migration = {
  version: "338_issue_status_validate_format",
  up: () => {},
  down: () => {},
};

export const migration339SeedIssueStatusCatalog: Migration = {
  version: "339_seed_issue_status_catalog",
  up: (db) => {
    // Verbatim from the source seed, descriptions included: they state the
    // trigger semantics of each status.
    const seed = db.prepare(`
      INSERT INTO issue_status (id, key, name, description, category, color, is_system, position)
      VALUES (?, ?, ?, ?, ?, ?, 1, 0)
      ON CONFLICT (key) DO NOTHING
    `);
    const rows: Array<[string, string, string, string]> = [
      [
        "backlog",
        "Backlog",
        "Parked. Assigning an issue here never starts an agent run.",
        "#6b7280",
      ],
      [
        "todo",
        "Todo",
        "Queued for work. Moving an issue here starts the assigned agent.",
        "#6b7280",
      ],
      ["in_progress", "In Progress", "Actively being worked on.", "#f59e0b"],
      [
        "in_review",
        "In Review",
        "Work delivered, waiting on human review. Finalizes the autopilot run.",
        "#22c55e",
      ],
      ["done", "Done", "Completed.", "#3b82f6"],
      ["blocked", "Blocked", "Stalled on an external dependency.", "#ef4444"],
      ["cancelled", "Cancelled", "Decided not to do.", "#6b7280"],
    ];
    for (const [key, name, description, color] of rows) {
      seed.run(`status_${key}`, key, name, description, key, color);
    }
  },
  down: (db) => {
    db.exec("DELETE FROM issue_status WHERE is_system = 1;");
  },
};
