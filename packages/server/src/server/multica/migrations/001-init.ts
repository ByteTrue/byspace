/**
 * 001_init — SQLite translation of multica's server/migrations/001_init.up.sql
 * (commit 04cdd48).
 *
 * Source contract, table by table. Every deviation from the source is one of
 * the three sanctioned translations (uuid→TEXT generated in code, timestamptz
 * →TEXT ISO-8601, jsonb→TEXT) or the multitenancy cut — nothing else.
 *
 *   user / workspace / member  — CUT (multitenancy). Consequences carried
 *     through every referencing table: no workspace_id column; creator_type/
 *     assignee_type/recipient_type/actor_type lose the 'member' variant and
 *     keep 'agent' plus a new 'owner' standing for the single local user (the
 *     person at the daemon). FK targets dropped accordingly.
 *
 *   agent — as source, minus workspace_id and owner_id (no users);
 *     runtime_mode kept with only 'local' (cloud is cut with its tables).
 *
 *   issue — as source, minus workspace_id. assignee_type gains 'squad'
 *     (multica adds it in 084; here the check starts with all three because
 *     the migration sequence is being collapsed for 001 only).
 *     acceptance_criteria / context_refs TEXT '[]'. position REAL.
 *
 *   issue_label / issue_to_label / issue_dependency — as source minus
 *     workspace_id on the label table.
 *
 *   comment — as source minus workspace_id. type check has the four variants.
 *
 *   inbox_item — as source minus workspace_id; recipient_type member→owner.
 *
 *   agent_task_queue — as source minus workspace_id (the queue is the
 *     daemon's, single machine by form factor). result TEXT json.
 *
 *   daemon_connection — CUT: it tracks cloud-daemon WebSocket identity
 *     against the server; the replica has no cloud daemon, the executor is
 *     in-process. (Revisit if a second machine ever claims tasks.)
 *
 *   activity_log — as source minus workspace_id; actor_type member→owner.
 */
import type { Migration } from "./runner.js";

export const migration001Init: Migration = {
  version: "001_init",
  up: (db) => {
    db.exec("PRAGMA foreign_keys = ON");

    db.exec(`
      CREATE TABLE agent (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        avatar_url TEXT,
        runtime_mode TEXT NOT NULL CHECK (runtime_mode IN ('local')),
        runtime_config TEXT NOT NULL DEFAULT '{}',
        visibility TEXT NOT NULL DEFAULT 'workspace' CHECK (visibility IN ('workspace', 'private')),
        status TEXT NOT NULL DEFAULT 'offline'
          CHECK (status IN ('idle', 'working', 'blocked', 'error', 'offline')),
        max_concurrent_tasks INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `);

    db.exec(`
      CREATE TABLE issue (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'backlog'
          CHECK (status IN ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled')),
        priority TEXT NOT NULL DEFAULT 'none'
          CHECK (priority IN ('urgent', 'high', 'medium', 'low', 'none')),
        assignee_type TEXT CHECK (assignee_type IN ('owner', 'agent', 'squad')),
        assignee_id TEXT,
        creator_type TEXT NOT NULL CHECK (creator_type IN ('owner', 'agent')),
        creator_id TEXT NOT NULL,
        parent_issue_id TEXT REFERENCES issue(id) ON DELETE SET NULL,
        acceptance_criteria TEXT NOT NULL DEFAULT '[]',
        context_refs TEXT NOT NULL DEFAULT '[]',
        position REAL NOT NULL DEFAULT 0,
        due_date TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `);

    db.exec(`
      CREATE TABLE issue_label (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL
      );
    `);

    db.exec(`
      CREATE TABLE issue_to_label (
        issue_id TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
        label_id TEXT NOT NULL REFERENCES issue_label(id) ON DELETE CASCADE,
        PRIMARY KEY (issue_id, label_id)
      );
    `);

    db.exec(`
      CREATE TABLE issue_dependency (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
        depends_on_issue_id TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('blocks', 'blocked_by', 'related'))
      );
    `);

    db.exec(`
      CREATE TABLE comment (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
        author_type TEXT NOT NULL CHECK (author_type IN ('owner', 'agent')),
        author_id TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'comment'
          CHECK (type IN ('comment', 'status_change', 'progress_update', 'system')),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `);

    db.exec(`
      CREATE TABLE inbox_item (
        id TEXT PRIMARY KEY,
        recipient_type TEXT NOT NULL CHECK (recipient_type IN ('owner', 'agent')),
        recipient_id TEXT NOT NULL,
        type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'info'
          CHECK (severity IN ('action_required', 'attention', 'info')),
        issue_id TEXT REFERENCES issue(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        body TEXT,
        read INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `);

    db.exec(`
      CREATE TABLE agent_task_queue (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
        issue_id TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'queued'
          CHECK (status IN ('queued', 'dispatched', 'running', 'completed', 'failed', 'cancelled')),
        priority INTEGER NOT NULL DEFAULT 0,
        dispatched_at TEXT,
        started_at TEXT,
        completed_at TEXT,
        result TEXT,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `);

    db.exec(`
      CREATE TABLE activity_log (
        id TEXT PRIMARY KEY,
        issue_id TEXT REFERENCES issue(id) ON DELETE CASCADE,
        actor_type TEXT CHECK (actor_type IN ('owner', 'agent', 'system')),
        actor_id TEXT,
        action TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `);

    // Indexes — the source's workspace indexes are gone with the column; the
    // rest translate one for one.
    db.exec(`
      CREATE INDEX idx_issue_assignee ON issue(assignee_type, assignee_id);
      CREATE INDEX idx_issue_status ON issue(status);
      CREATE INDEX idx_issue_parent ON issue(parent_issue_id);
      CREATE INDEX idx_comment_issue ON comment(issue_id);
      CREATE INDEX idx_inbox_recipient ON inbox_item(recipient_type, recipient_id, read);
      CREATE INDEX idx_agent_task_queue_agent ON agent_task_queue(agent_id, status);
      CREATE INDEX idx_activity_log_issue ON activity_log(issue_id);
    `);
  },
  down: (db) => {
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(`
      DROP INDEX IF EXISTS idx_activity_log_issue;
      DROP INDEX IF EXISTS idx_agent_task_queue_agent;
      DROP INDEX IF EXISTS idx_inbox_recipient;
      DROP INDEX IF EXISTS idx_comment_issue;
      DROP INDEX IF EXISTS idx_issue_parent;
      DROP INDEX IF EXISTS idx_issue_status;
      DROP INDEX IF EXISTS idx_issue_assignee;
      DROP TABLE IF EXISTS activity_log;
      DROP TABLE IF EXISTS agent_task_queue;
      DROP TABLE IF EXISTS inbox_item;
      DROP TABLE IF EXISTS comment;
      DROP TABLE IF EXISTS issue_dependency;
      DROP TABLE IF EXISTS issue_to_label;
      DROP TABLE IF EXISTS issue_label;
      DROP TABLE IF EXISTS issue;
      DROP TABLE IF EXISTS agent;
    `);
  },
};
