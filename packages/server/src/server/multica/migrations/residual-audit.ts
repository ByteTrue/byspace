/**
 * The residual replica-table migrations found by a full-column audit
 * (commit 04cdd48) — everything the per-batch passes missed.
 *
 * The audit: for each replica table, the union of every `ADD COLUMN` in the
 * source's 577 migrations was diffed against the replica's final snapshot.
 * What it caught: issue's optimistic-concurrency revision and calendar dates
 * and metadata bag and triage/duplicate/origin columns; comment's revision
 * and deletion/recovery/suppression columns; inbox's actor attribution;
 * issue_status's icon; and the queue's chat-input linkage. 109/127 are
 * issue_pull_request (GitHub circle, cut). 520 is a stored function
 * (behavior, engine slice).
 */
import type { Migration } from "./runner.js";

export const migration012InboxActor: Migration = {
  version: "012_inbox_actor",
  up: (db) => {
    db.exec(`ALTER TABLE inbox_item ADD COLUMN actor_type TEXT;`);
    db.exec(`ALTER TABLE inbox_item ADD COLUMN actor_id TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE inbox_item DROP COLUMN actor_id;`);
    db.exec(`ALTER TABLE inbox_item DROP COLUMN actor_type;`);
  },
};

export const migration091IssueStartDate: Migration = {
  version: "091_issue_start_date",
  up: (db) => {
    // start_date only: issue.due_date exists since 001. The source later
    // converts both to DATE (112); the replica stores ISO dates as TEXT
    // throughout, so the column arrives in its final form.
    db.exec(`ALTER TABLE issue ADD COLUMN start_date TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE issue DROP COLUMN start_date;`);
  },
};

export const migration105IssueMetadata: Migration = {
  version: "105_issue_metadata",
  up: (db) => {
    db.exec(`ALTER TABLE issue ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';`);
    // The source's two CHECKs (is-object, size limit) land with the store
    // layer's Zod validation: SQLite has no JSON operators in CHECKs.
  },
  down: (db) => {
    db.exec(`ALTER TABLE issue DROP COLUMN metadata;`);
  },
};

export const migration348PluginViaAttribution: Migration = {
  version: "348_plugin_via_attribution",
  up: (db) => {
    db.exec(`ALTER TABLE comment ADD COLUMN via_plugin_id TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE comment DROP COLUMN via_plugin_id;`);
  },
};

export const migration351IssueCommentRevision: Migration = {
  version: "351_issue_comment_revision",
  up: (db) => {
    // Optimistic concurrency for issue and comment edits — the column the
    // update handlers compare before writing.
    db.exec(`ALTER TABLE issue ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;`);
    db.exec(`ALTER TABLE comment ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE comment DROP COLUMN revision;`);
    db.exec(`ALTER TABLE issue DROP COLUMN revision;`);
  },
};

export const migration360IssueLastActivityAt: Migration = {
  version: "360_issue_last_activity_at",
  up: (db) => {
    db.exec(`ALTER TABLE issue ADD COLUMN last_activity_at TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE issue DROP COLUMN last_activity_at;`);
  },
};

export const migration444CommentRecoverySettledAt: Migration = {
  version: "444_comment_recovery_settled_at",
  up: (db) => {
    db.exec(`ALTER TABLE comment ADD COLUMN recovery_settled_at TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE comment DROP COLUMN recovery_settled_at;`);
  },
};

export const migration470IssueStatusIcon: Migration = {
  version: "470_issue_status_icon",
  up: (db) => {
    db.exec(`ALTER TABLE issue_status ADD COLUMN icon TEXT NOT NULL DEFAULT '';`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE issue_status DROP COLUMN icon;`);
  },
};

export const migration483IssueTriageState: Migration = {
  version: "483_issue_triage_state",
  up: (db) => {
    db.exec(
      `ALTER TABLE issue ADD COLUMN triage_state TEXT CHECK (triage_state IS NULL OR triage_state IN ('pending'));`,
    );
    db.exec(
      `CREATE INDEX idx_issue_triage_state ON issue(created_at) WHERE triage_state IS NOT NULL;`,
    );
  },
  down: (db) => {
    db.exec(`DROP INDEX IF EXISTS idx_issue_triage_state;`);
    db.exec(`ALTER TABLE issue DROP COLUMN triage_state;`);
  },
};

export const migration490DropTriageStatusKeyReservation: Migration = {
  version: "490_drop_triage_status_key_reservation",
  up: () => {
    // The source drops a PG constraint our 332 translation never created
    // (triage never reserved a status key here); kept as a sequence entry.
  },
  down: () => {},
};

export const migration536IssueDuplicateOf: Migration = {
  version: "536_issue_duplicate_of",
  up: (db) => {
    db.exec(`ALTER TABLE issue ADD COLUMN duplicate_of_issue_id TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE issue DROP COLUMN duplicate_of_issue_id;`);
  },
};

export const migration537IssueDuplicateOfIndex: Migration = {
  version: "537_issue_duplicate_of_index",
  up: (db) => {
    db.exec(
      `CREATE INDEX idx_issue_duplicate_of ON issue(duplicate_of_issue_id) WHERE duplicate_of_issue_id IS NOT NULL;`,
    );
  },
  down: (db) => {
    db.exec(`DROP INDEX IF EXISTS idx_issue_duplicate_of;`);
  },
};

export const migration550CommentSuppressedAgents: Migration = {
  version: "550_comment_suppressed_agents",
  up: (db) => {
    // UUID[] → TEXT json array, the standing translation.
    db.exec(`ALTER TABLE comment ADD COLUMN suppressed_agent_ids TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE comment DROP COLUMN suppressed_agent_ids;`);
  },
};
