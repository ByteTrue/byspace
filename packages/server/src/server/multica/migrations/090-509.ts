/**
 * Migrations 090, 096, 127, 509 — SQLite translations of multica's squad
 * dispatch accounting and issue wakeups (commit 04cdd48).
 *
 * Source contracts preserved:
 *
 *   090 — agent_task_queue.is_leader_task. The comment matters: the
 *         squad-leader self-trigger guard consults the agent's most recent
 *         task on the issue and skips only when that task was itself a leader
 *         task, because an agent can be both leader and worker of the same
 *         squad — a comment in its worker role must still wake its leader
 *         role.
 *
 *   096 — autopilot "Squad-as-Leader": assignee_type with the FK dropped so
 *         one id column can reference agent or squad; dispatch resolves to
 *         squad.leader_id, referential integrity at the application layer.
 *         autopilot_run.squad_id is the attribution hook so runs can be
 *         grouped by squad even though the executing agent is the leader.
 *
 *   127 — agent_task_queue.squad_id. No FK on purpose (hot queue; squad
 *         maintenance must not take cross-table locks; a stale UUID means no
 *         briefing injected — the same observable as "condition not matched").
 *
 *   509 — issue_wakeup + issue_wakeup_receipt. The wakeup is an agent's own
 *         subscription on an issue (kind event|at|every|cron, mode once|
 *         continuous, filters, instruction); the receipt is idempotent event
 *         capture so a repeated event cannot fire the same wakeup twice.
 *         event_types is PG text[] → TEXT json array.
 *
 * Not ported as schema: 523/530/532 are PG stored functions implementing
 * wakeup event capture inside the database. That is behavior, not schema —
 * the replica implements capture in the trigger engine (epic slice 4), where
 * BySpace's Node daemon owns it. The functions' contracts (ignore events
 * emitted by the registering run, terminal issues capture nothing, filters)
 * are recorded in the schema baseline and land with the engine.
 */
import type { Migration } from "./runner.js";

const TS = "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

export const migration090TaskIsLeader: Migration = {
  version: "090_task_is_leader",
  up: (db) => {
    db.exec(`ALTER TABLE agent_task_queue ADD COLUMN is_leader_task INTEGER NOT NULL DEFAULT 0;`);
  },
  down: (db) => {
    // Column drop via rebuild; queue carries autopilot_run_id from 042.
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(`
      CREATE TABLE queue_090d (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
        issue_id TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'queued'
          CHECK (status IN ('queued', 'dispatched', 'running', 'completed', 'failed', 'cancelled')),
        priority INTEGER NOT NULL DEFAULT 0,
        dispatched_at TEXT, started_at TEXT, completed_at TEXT,
        result TEXT, error TEXT,
        autopilot_run_id TEXT REFERENCES autopilot_run(id) ON DELETE SET NULL,
        created_at ${TS}
      );
      INSERT INTO queue_090d SELECT id, agent_id, issue_id, status, priority, dispatched_at, started_at,
        completed_at, result, error, autopilot_run_id, created_at FROM agent_task_queue;
      DROP TABLE agent_task_queue; ALTER TABLE queue_090d RENAME TO agent_task_queue;
      CREATE INDEX idx_agent_task_queue_agent ON agent_task_queue(agent_id, status);
    `);
    db.exec("PRAGMA foreign_keys = ON");
  },
};

export const migration096AutopilotSquadAssignee: Migration = {
  version: "096_autopilot_squad_assignee",
  up: (db) => {
    // Rebuild autopilot with assignee_type and no FK on assignee_id (one id
    // column, two referents, integrity in the application layer).
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(`
      CREATE TABLE autopilot_096 (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        assignee_type TEXT NOT NULL DEFAULT 'agent'
          CHECK (assignee_type IN ('agent', 'squad')),
        assignee_id TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'medium'
          CHECK (priority IN ('urgent', 'high', 'medium', 'low', 'none')),
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'paused', 'archived')),
        execution_mode TEXT NOT NULL DEFAULT 'create_issue'
          CHECK (execution_mode IN ('create_issue', 'run_only')),
        issue_title_template TEXT,
        concurrency_policy TEXT NOT NULL DEFAULT 'skip'
          CHECK (concurrency_policy IN ('skip', 'queue', 'replace')),
        created_by_type TEXT NOT NULL CHECK (created_by_type IN ('owner', 'agent')),
        created_by_id TEXT NOT NULL,
        last_run_at TEXT,
        created_at ${TS},
        updated_at ${TS}
      );
      INSERT INTO autopilot_096 SELECT id, title, description, 'agent', assignee_id, priority, status,
        execution_mode, issue_title_template, concurrency_policy, created_by_type, created_by_id,
        last_run_at, created_at, updated_at FROM autopilot;
      DROP TABLE autopilot; ALTER TABLE autopilot_096 RENAME TO autopilot;
      CREATE INDEX idx_autopilot_assignee_type_id ON autopilot(assignee_type, assignee_id);
    `);
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(
      `ALTER TABLE autopilot_run ADD COLUMN squad_id TEXT REFERENCES squad(id) ON DELETE SET NULL;`,
    );
    db.exec(
      `CREATE INDEX idx_autopilot_run_squad_id ON autopilot_run(squad_id) WHERE squad_id IS NOT NULL;`,
    );
  },
  down: (db) => {
    db.exec("DROP INDEX IF EXISTS idx_autopilot_run_squad_id;");
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(`
      CREATE TABLE autopilot_096d (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        assignee_type TEXT NOT NULL CHECK (assignee_type IN ('owner', 'agent')),
        assignee_id TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'medium'
          CHECK (priority IN ('urgent', 'high', 'medium', 'low', 'none')),
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'paused', 'archived')),
        execution_mode TEXT NOT NULL DEFAULT 'create_issue'
          CHECK (execution_mode IN ('create_issue', 'run_only')),
        issue_title_template TEXT,
        concurrency_policy TEXT NOT NULL DEFAULT 'skip'
          CHECK (concurrency_policy IN ('skip', 'queue', 'replace')),
        created_by_type TEXT NOT NULL CHECK (created_by_type IN ('owner', 'agent')),
        created_by_id TEXT NOT NULL,
        last_run_at TEXT,
        created_at ${TS},
        updated_at ${TS}
      );
      INSERT INTO autopilot_096d SELECT id, title, description, 'agent', assignee_id, priority, status,
        execution_mode, issue_title_template, concurrency_policy, created_by_type, created_by_id,
        last_run_at, created_at, updated_at FROM autopilot;
      DROP TABLE autopilot; ALTER TABLE autopilot_096d RENAME TO autopilot;
    `);
    db.exec("PRAGMA foreign_keys = ON");
  },
};

export const migration127TaskSquadId: Migration = {
  version: "127_task_squad_id",
  up: (db) => {
    db.exec(`ALTER TABLE agent_task_queue ADD COLUMN squad_id TEXT;`);
    db.exec(
      `CREATE INDEX agent_task_queue_squad_id_idx ON agent_task_queue(squad_id) WHERE squad_id IS NOT NULL;`,
    );
  },
  down: (db) => {
    db.exec("DROP INDEX IF EXISTS agent_task_queue_squad_id_idx;");
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(`
      CREATE TABLE queue_127d (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
        issue_id TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'queued'
          CHECK (status IN ('queued', 'dispatched', 'running', 'completed', 'failed', 'cancelled')),
        priority INTEGER NOT NULL DEFAULT 0,
        dispatched_at TEXT, started_at TEXT, completed_at TEXT,
        result TEXT, error TEXT,
        autopilot_run_id TEXT REFERENCES autopilot_run(id) ON DELETE SET NULL,
        is_leader_task INTEGER NOT NULL DEFAULT 0,
        created_at ${TS}
      );
      INSERT INTO queue_127d SELECT id, agent_id, issue_id, status, priority, dispatched_at, started_at,
        completed_at, result, error, autopilot_run_id, is_leader_task, created_at FROM agent_task_queue;
      DROP TABLE agent_task_queue; ALTER TABLE queue_127d RENAME TO agent_task_queue;
      CREATE INDEX idx_agent_task_queue_agent ON agent_task_queue(agent_id, status);
    `);
    db.exec("PRAGMA foreign_keys = ON");
  },
};

export const migration509IssueWakeup: Migration = {
  version: "509_issue_wakeup",
  up: (db) => {
    db.exec(`
      CREATE TABLE issue_wakeup (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
        created_by TEXT NOT NULL,
        source_task_id TEXT,
        parent_comment_id TEXT,
        instruction TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('event', 'at', 'every', 'cron')),
        mode TEXT NOT NULL CHECK (mode IN ('once', 'continuous')),
        event_types TEXT NOT NULL DEFAULT '[]',
        filter_agent_id TEXT,
        filter_task_id TEXT,
        interval_seconds INTEGER,
        cron_expression TEXT,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        next_fire_at TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        disabled_at TEXT,
        revision INTEGER NOT NULL DEFAULT 1,
        last_task_id TEXT,
        last_error TEXT,
        created_at ${TS},
        updated_at ${TS}
      );
      CREATE INDEX idx_issue_wakeup_issue ON issue_wakeup(issue_id, enabled, kind);
      CREATE INDEX idx_issue_wakeup_next_fire ON issue_wakeup(next_fire_at)
        WHERE enabled = 1 AND kind IN ('at', 'every', 'cron');

      CREATE TABLE issue_wakeup_receipt (
        id TEXT PRIMARY KEY,
        wakeup_id TEXT NOT NULL REFERENCES issue_wakeup(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        event_key TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        task_id TEXT,
        processed_at TEXT,
        created_at ${TS}
      );
      CREATE INDEX idx_issue_wakeup_receipt_wakeup ON issue_wakeup_receipt(wakeup_id, event_key);
    `);
  },
  down: (db) => {
    db.exec(`
      DROP TABLE IF EXISTS issue_wakeup_receipt;
      DROP TABLE IF EXISTS issue_wakeup;
    `);
  },
};
