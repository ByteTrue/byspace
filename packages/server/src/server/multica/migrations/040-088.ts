/**
 * The 040–088 evolution chain — SQLite translations of multica's migrations
 * that add or tighten columns on the replica tables (commit 04cdd48).
 *
 * One batch file because these are a chain: each is small on its own and the
 * final shape is what matters. Contracts preserved per source:
 *
 *   040 — agent.custom_env TEXT json (launch-time env).
 *   041 — agent.custom_args TEXT json array (CLI launch arguments).
 *   046 — agent names unique per workspace → unique in the single namespace.
 *   050 — agent.model; issue.first_executed_at (+ partial index).
 *   055 — queue attempt/max_attempts/parent_task_id/failure_reason/
 *         last_heartbeat_at: the lease-and-retry mechanics.
 *   058 — autopilot drops priority and project_id.
 *   059 — issue_label timestamps.
 *   060 — agent.description ≤ 255 (CHECK added NOT VALID in PG; inline here);
 *         issue.origin_type gains 'quick_create'.
 *   061 — queue.trigger_summary (a snapshot that survives source edits).
 *   066 — queue.force_fresh_session.
 *   069 — comment.resolved_at/resolved_by (with the consistency CHECK).
 *   079 — autopilot_run.status enum tightened (adds 'skipped', drops
 *         'pending'/'issue_created' from 042's list — the source's own edit).
 *   083 — attachment gains chat linkage (chat_comment_id; chat is cut so only
 *         the issue/comment/task linkage is kept — task_id lands in 164).
 *   085–088 — squad: archived_at/archived_by, avatar_url, name NOT unique
 *         (dropped in 087 so squads can share names), instructions.
 */
import type { Migration } from "./runner.js";
import { rebuildTableWithFksOff } from "./rebuild.js";

const TS = "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

export const migration040AgentCustomEnv: Migration = {
  version: "040_agent_custom_env",
  up: (db) => {
    db.exec(`ALTER TABLE agent ADD COLUMN custom_env TEXT NOT NULL DEFAULT '{}';`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent DROP COLUMN custom_env;`);
  },
};

export const migration046AgentUniqueName: Migration = {
  version: "046_agent_unique_name",
  up: (db) => {
    // Source deduplicates then adds the unique constraint; a fresh database
    // has nothing to dedupe, and the constraint is the contract. custom_env
    // and custom_args already exist (040/041) and must ride the rebuild,
    // as do instructions (021), the archive pair (031), and mcp_config (046).
    rebuildTableWithFksOff(db, {
      table: "agent",
      ddl: `CREATE TABLE agent (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, avatar_url TEXT,
        runtime_mode TEXT NOT NULL CHECK (runtime_mode IN ('local')),
        runtime_config TEXT NOT NULL DEFAULT '{}',
        visibility TEXT NOT NULL DEFAULT 'workspace' CHECK (visibility IN ('workspace', 'private')),
        status TEXT NOT NULL DEFAULT 'offline'
          CHECK (status IN ('idle', 'working', 'blocked', 'error', 'offline')),
        max_concurrent_tasks INTEGER NOT NULL DEFAULT 1,
        description TEXT NOT NULL DEFAULT '',
        instructions TEXT NOT NULL DEFAULT '',
        archived_at TEXT,
        archived_by TEXT,
        custom_env TEXT NOT NULL DEFAULT '{}',
        custom_args TEXT NOT NULL DEFAULT '[]',
        mcp_config TEXT,
        created_at ${TS}, updated_at ${TS}
      );`,
      carry: [
        "id",
        "name",
        "avatar_url",
        "runtime_mode",
        "runtime_config",
        "visibility",
        "status",
        "max_concurrent_tasks",
        "description",
        "instructions",
        "archived_at",
        "archived_by",
        "custom_env",
        "custom_args",
        "mcp_config",
        "created_at",
        "updated_at",
      ],
    });
  },
  down: (db) => {
    rebuildTableWithFksOff(db, {
      table: "agent",
      ddl: `CREATE TABLE agent (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, avatar_url TEXT,
        runtime_mode TEXT NOT NULL CHECK (runtime_mode IN ('local')),
        runtime_config TEXT NOT NULL DEFAULT '{}',
        visibility TEXT NOT NULL DEFAULT 'workspace' CHECK (visibility IN ('workspace', 'private')),
        status TEXT NOT NULL DEFAULT 'offline'
          CHECK (status IN ('idle', 'working', 'blocked', 'error', 'offline')),
        max_concurrent_tasks INTEGER NOT NULL DEFAULT 1,
        description TEXT NOT NULL DEFAULT '',
        instructions TEXT NOT NULL DEFAULT '',
        archived_at TEXT,
        archived_by TEXT,
        custom_env TEXT NOT NULL DEFAULT '{}',
        custom_args TEXT NOT NULL DEFAULT '[]',
        mcp_config TEXT,
        created_at ${TS}, updated_at ${TS}
      );`,
      carry: [
        "id",
        "name",
        "avatar_url",
        "runtime_mode",
        "runtime_config",
        "visibility",
        "status",
        "max_concurrent_tasks",
        "description",
        "instructions",
        "archived_at",
        "archived_by",
        "custom_env",
        "custom_args",
        "mcp_config",
        "created_at",
        "updated_at",
      ],
    });
  },
};

export const migration050AgentModel: Migration = {
  version: "050_agent_model",
  up: (db) => {
    db.exec(`ALTER TABLE agent ADD COLUMN model TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent DROP COLUMN model;`);
  },
};

export const migration050IssueFirstExecutedAt: Migration = {
  version: "050_issue_first_executed_at",
  up: (db) => {
    db.exec(`ALTER TABLE issue ADD COLUMN first_executed_at TEXT;`);
    db.exec(
      `CREATE INDEX idx_issue_first_executed_at ON issue(first_executed_at) WHERE first_executed_at IS NOT NULL;`,
    );
  },
  down: (db) => {
    db.exec(`DROP INDEX IF EXISTS idx_issue_first_executed_at;`);
    db.exec(`ALTER TABLE issue DROP COLUMN first_executed_at;`);
  },
};

export const migration055TaskLeaseAndRetry: Migration = {
  version: "055_task_lease_and_retry",
  up: (db) => {
    for (const stmt of [
      `ALTER TABLE agent_task_queue ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1;`,
      `ALTER TABLE agent_task_queue ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 2;`,
      `ALTER TABLE agent_task_queue ADD COLUMN parent_task_id TEXT;`,
      `ALTER TABLE agent_task_queue ADD COLUMN failure_reason TEXT;`,
      `ALTER TABLE agent_task_queue ADD COLUMN last_heartbeat_at TEXT;`,
    ]) {
      db.exec(stmt);
    }
  },
  down: (db) => {
    for (const col of [
      "last_heartbeat_at",
      "failure_reason",
      "parent_task_id",
      "max_attempts",
      "attempt",
    ]) {
      db.exec(`ALTER TABLE agent_task_queue DROP COLUMN ${col};`);
    }
  },
};

export const migration058DropAutopilotPriorityAndProjectId: Migration = {
  version: "058_drop_autopilot_priority_and_project_id",
  up: (db) => {
    // 042 collapsed without project_id already; drop priority like the
    // source's IF EXISTS — SQLite DROP COLUMN has no IF EXISTS, so consult
    // the table_info pragma instead of guessing.
    const cols = (db.prepare("PRAGMA table_info(autopilot)").all() as Array<{ name: string }>).map(
      (row) => row.name,
    );
    if (cols.includes("priority")) {
      db.exec("ALTER TABLE autopilot DROP COLUMN priority;");
    }
  },
  down: () => {
    // The source has no down for these drops.
  },
};

export const migration059LabelTimestamps: Migration = {
  version: "059_label_timestamps",
  up: (db) => {
    db.exec(`ALTER TABLE issue_label ADD COLUMN created_at ${TS};`);
    db.exec(`ALTER TABLE issue_label ADD COLUMN updated_at ${TS};`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE issue_label DROP COLUMN created_at;`);
    db.exec(`ALTER TABLE issue_label DROP COLUMN updated_at;`);
  },
};

export const migration060AgentDescriptionLength: Migration = {
  version: "060_agent_description_length",
  up: (db) => {
    // Truncate then check, the source's order — inline CHECK (SQLite has no
    // NOT VALID two-step). model exists by 060 and must ride the rebuild.
    db.exec("UPDATE agent SET description = substr(description, 1, 255);");
    rebuildTableWithFksOff(db, {
      table: "agent",
      ddl: `CREATE TABLE agent (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, avatar_url TEXT,
        runtime_mode TEXT NOT NULL CHECK (runtime_mode IN ('local')),
        runtime_config TEXT NOT NULL DEFAULT '{}',
        visibility TEXT NOT NULL DEFAULT 'workspace' CHECK (visibility IN ('workspace', 'private')),
        status TEXT NOT NULL DEFAULT 'offline'
          CHECK (status IN ('idle', 'working', 'blocked', 'error', 'offline')),
        max_concurrent_tasks INTEGER NOT NULL DEFAULT 1,
        description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 255),
        instructions TEXT NOT NULL DEFAULT '',
        archived_at TEXT,
        archived_by TEXT,
        custom_env TEXT NOT NULL DEFAULT '{}',
        custom_args TEXT NOT NULL DEFAULT '[]',
        mcp_config TEXT,
        model TEXT,
        created_at ${TS}, updated_at ${TS}
      );`,
      carry: [
        "id",
        "name",
        "avatar_url",
        "runtime_mode",
        "runtime_config",
        "visibility",
        "status",
        "max_concurrent_tasks",
        "description",
        "instructions",
        "archived_at",
        "archived_by",
        "custom_env",
        "custom_args",
        "mcp_config",
        "model",
        "created_at",
        "updated_at",
      ],
    });
  },
  down: (db) => {
    rebuildTableWithFksOff(db, {
      table: "agent",
      ddl: `CREATE TABLE agent (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, avatar_url TEXT,
        runtime_mode TEXT NOT NULL CHECK (runtime_mode IN ('local')),
        runtime_config TEXT NOT NULL DEFAULT '{}',
        visibility TEXT NOT NULL DEFAULT 'workspace' CHECK (visibility IN ('workspace', 'private')),
        status TEXT NOT NULL DEFAULT 'offline'
          CHECK (status IN ('idle', 'working', 'blocked', 'error', 'offline')),
        max_concurrent_tasks INTEGER NOT NULL DEFAULT 1,
        description TEXT NOT NULL DEFAULT '',
        instructions TEXT NOT NULL DEFAULT '',
        archived_at TEXT,
        archived_by TEXT,
        custom_env TEXT NOT NULL DEFAULT '{}',
        custom_args TEXT NOT NULL DEFAULT '[]',
        mcp_config TEXT,
        model TEXT,
        created_at ${TS}, updated_at ${TS}
      );`,
      carry: [
        "id",
        "name",
        "avatar_url",
        "runtime_mode",
        "runtime_config",
        "visibility",
        "status",
        "max_concurrent_tasks",
        "description",
        "instructions",
        "archived_at",
        "archived_by",
        "custom_env",
        "custom_args",
        "mcp_config",
        "model",
        "created_at",
        "updated_at",
      ],
    });
  },
};

export const migration060IssueOriginQuickCreate: Migration = {
  version: "060_issue_origin_quick_create",
  up: (db) => {
    rebuildTableWithFksOff(db, {
      table: "issue",
      ddl: `CREATE TABLE issue (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
        status TEXT NOT NULL DEFAULT 'backlog',
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
        number INTEGER,
        project_id TEXT REFERENCES project(id) ON DELETE SET NULL,
        origin_type TEXT CHECK (origin_type IN ('autopilot', 'quick_create')),
        first_executed_at TEXT,
        created_at ${TS}, updated_at ${TS}
      );`,
      carry: [
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
        "number",
        "project_id",
        "origin_type",
        "first_executed_at",
        "created_at",
        "updated_at",
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_issue_number ON issue(number);",
        "CREATE INDEX idx_issue_assignee ON issue(assignee_type, assignee_id);",
        "CREATE INDEX idx_issue_status ON issue(status);",
        "CREATE INDEX idx_issue_parent ON issue(parent_issue_id);",
        "CREATE INDEX idx_issue_project ON issue(project_id);",
        "CREATE INDEX idx_issue_first_executed_at ON issue(first_executed_at) WHERE first_executed_at IS NOT NULL;",
      ],
    });
  },
  down: () => {},
};

export const migration061TaskTriggerSummary: Migration = {
  version: "061_task_trigger_summary",
  up: (db) => {
    db.exec(`ALTER TABLE agent_task_queue ADD COLUMN trigger_summary TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN trigger_summary;`);
  },
};

export const migration066ForceFreshSession: Migration = {
  version: "066_force_fresh_session",
  up: (db) => {
    db.exec(
      `ALTER TABLE agent_task_queue ADD COLUMN force_fresh_session INTEGER NOT NULL DEFAULT 0;`,
    );
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN force_fresh_session;`);
  },
};

export const migration069CommentResolvedAt: Migration = {
  version: "069_comment_resolved_at",
  up: (db) => {
    rebuildTableWithFksOff(db, {
      table: "comment",
      ddl: `CREATE TABLE comment (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
        author_type TEXT NOT NULL CHECK (author_type IN ('owner', 'agent')),
        author_id TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'comment'
          CHECK (type IN ('comment', 'status_change', 'progress_update', 'system')),
        parent_id TEXT REFERENCES comment(id) ON DELETE CASCADE,
        resolved_at TEXT,
        resolved_by_type TEXT CHECK (resolved_by_type IS NULL OR resolved_by_type IN ('owner', 'agent')),
        resolved_by_id TEXT,
        created_at ${TS}, updated_at ${TS},
        CONSTRAINT comment_resolved_consistency CHECK (
          (resolved_at IS NULL AND resolved_by_id IS NULL) OR
          (resolved_at IS NOT NULL AND resolved_by_id IS NOT NULL)
        )
      );`,
      carry: [
        "id",
        "issue_id",
        "author_type",
        "author_id",
        "content",
        "type",
        "parent_id",
        "created_at",
        "updated_at",
      ],
      indexes: [
        "CREATE INDEX idx_comment_issue ON comment(issue_id);",
        "CREATE INDEX idx_comment_parent ON comment(parent_id);",
      ],
    });
  },
  down: (db) => {
    rebuildTableWithFksOff(db, {
      table: "comment",
      ddl: `CREATE TABLE comment (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
        author_type TEXT NOT NULL CHECK (author_type IN ('owner', 'agent')),
        author_id TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'comment'
          CHECK (type IN ('comment', 'status_change', 'progress_update', 'system')),
        parent_id TEXT REFERENCES comment(id) ON DELETE CASCADE,
        created_at ${TS}, updated_at ${TS}
      );`,
      carry: [
        "id",
        "issue_id",
        "author_type",
        "author_id",
        "content",
        "type",
        "parent_id",
        "created_at",
        "updated_at",
      ],
      indexes: [
        "CREATE INDEX idx_comment_issue ON comment(issue_id);",
        "CREATE INDEX idx_comment_parent ON comment(parent_id);",
      ],
    });
  },
};

export const migration079AutopilotRunSkippedStatus: Migration = {
  version: "079_autopilot_run_skipped_status",
  up: (db) => {
    rebuildTableWithFksOff(db, {
      table: "autopilot_run",
      ddl: `CREATE TABLE autopilot_run (
        id TEXT PRIMARY KEY,
        autopilot_id TEXT NOT NULL REFERENCES autopilot(id) ON DELETE CASCADE,
        trigger_id TEXT REFERENCES autopilot_trigger(id) ON DELETE SET NULL,
        source TEXT NOT NULL CHECK (source IN ('schedule', 'manual', 'webhook', 'api')),
        status TEXT NOT NULL DEFAULT 'issue_created'
          CHECK (status IN ('issue_created', 'running', 'completed', 'failed', 'skipped')),
        issue_id TEXT REFERENCES issue(id) ON DELETE SET NULL,
        task_id TEXT REFERENCES agent_task_queue(id) ON DELETE SET NULL,
        triggered_at ${TS},
        completed_at TEXT,
        failure_reason TEXT,
        trigger_payload TEXT,
        result TEXT,
        created_at ${TS}
      );`,
      carry: [
        "id",
        "autopilot_id",
        "trigger_id",
        "source",
        "status",
        "issue_id",
        "task_id",
        "triggered_at",
        "completed_at",
        "failure_reason",
        "trigger_payload",
        "result",
        "created_at",
      ],
      indexes: [
        "CREATE INDEX idx_autopilot_run_autopilot ON autopilot_run(autopilot_id, created_at DESC);",
        "CREATE INDEX idx_autopilot_run_status ON autopilot_run(autopilot_id, status) WHERE status IN ('issue_created', 'running');",
      ],
    });
  },
  down: () => {},
};

export const migration085SquadArchive: Migration = {
  version: "085_squad_archive",
  up: (db) => {
    db.exec(`ALTER TABLE squad ADD COLUMN archived_at TEXT;`);
    db.exec(`ALTER TABLE squad ADD COLUMN archived_by TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE squad DROP COLUMN archived_by;`);
    db.exec(`ALTER TABLE squad DROP COLUMN archived_at;`);
  },
};

export const migration086SquadAvatar: Migration = {
  version: "086_squad_avatar",
  up: (db) => {
    db.exec(`ALTER TABLE squad ADD COLUMN avatar_url TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE squad DROP COLUMN avatar_url;`);
  },
};

export const migration087SquadNameNotUnique: Migration = {
  version: "087_squad_name_not_unique",
  up: (db) => {
    // Drop name uniqueness by rebuild: the constraint was created inline
    // (name TEXT NOT NULL UNIQUE), whose backing index is an internal
    // sqlite_autoindex — dropping by its internal name would be guessing.
    // Rebuild is the shape that does not depend on internals.
    rebuildTableWithFksOff(db, {
      table: "squad",
      ddl: `CREATE TABLE squad (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        leader_id TEXT NOT NULL REFERENCES agent(id) ON DELETE RESTRICT,
        creator_type TEXT NOT NULL CHECK (creator_type IN ('owner', 'agent')),
        creator_id TEXT NOT NULL,
        created_at ${TS},
        updated_at ${TS},
        archived_at TEXT,
        archived_by TEXT,
        avatar_url TEXT
      );`,
      carry: [
        "id",
        "name",
        "description",
        "leader_id",
        "creator_type",
        "creator_id",
        "created_at",
        "updated_at",
        "archived_at",
        "archived_by",
        "avatar_url",
      ],
      // squad itself carries no secondary index; the squad_member indexes
      // belong to squad_member and survive a squad rebuild untouched.
    });
  },
  down: () => {
    // Restoring uniqueness would fail on any duplicate names the window
    // allowed; the source leaves this unrecoverable too.
  },
};

export const migration088SquadInstructions: Migration = {
  version: "088_squad_instructions",
  up: (db) => {
    db.exec(`ALTER TABLE squad ADD COLUMN instructions TEXT NOT NULL DEFAULT '';`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE squad DROP COLUMN instructions;`);
  },
};
