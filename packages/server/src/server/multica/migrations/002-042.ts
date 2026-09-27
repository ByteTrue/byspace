/**
 * Migrations 002–042 — SQLite translations of multica's
 * server/migrations/002…042 (commit 04cdd48).
 *
 * One export per source migration, numbered and named as the source. Only the
 * migrations that touch replica tables are ported; the multitenancy circle
 * (005 daemon_pairing, 009 verification_code, 011 personal_access_token,
 * 020/024 workspace issue-number, 029 daemon_token, 038 pinned_item,
 * 041 agent custom args is ported, 043 reserved slugs) is skipped per the
 * baseline's cut list.
 *
 * Source contracts preserved per migration:
 *   002 — agent gains description/skills (text) and tools/triggers (jsonb);
 *         032 later drops tools+triggers, keeping description+skills.
 *   004 — agent_runtime (workspace-cut): one row per agent describing its
 *         execution loop wiring.
 *   008 — skill/skill_file/agent_skill: workspace-level skill entities
 *         (workspace cut → one skill namespace).
 *   015 — issue_subscriber with the reason enum.
 *   017/018 — comment.parent_id, SET NULL, then cascade-corrected FK
 *         (SQLite re-creates the table; the final state is parent_id
 *         ON DELETE CASCADE per 018).
 *   020 — issue number: workspace-prefixed counters are workspace-scoped;
 *         ported as a workspace-less issue_number column on issue with a
 *         global counter table (single-workspace form factor).
 *   026/027 — comment_reaction / issue_reaction.
 *   029 — attachment with uploader type check.
 *   032 — drop agent.triggers/tools (behaviour hardcoded upstream).
 *   034 — project (+issue.project_id).
 *   041 — agent.custom_args TEXT json array for CLI launch arguments.
 *   042 — autopilot/autopilot_trigger/autopilot_run + queue/issue linkage.
 */
import type { Migration } from "./runner.js";

const TS = "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

export const migration002AgentConfig: Migration = {
  version: "002_agent_config",
  up: (db) => {
    db.exec(`
      ALTER TABLE agent ADD COLUMN description TEXT NOT NULL DEFAULT '';
      ALTER TABLE agent ADD COLUMN skills TEXT NOT NULL DEFAULT '';
      ALTER TABLE agent ADD COLUMN tools TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE agent ADD COLUMN triggers TEXT NOT NULL DEFAULT '[]';
    `);
  },
  down: (db) => {
    // SQLite cannot drop columns before 3.35; node:sqlite ships a modern
    // SQLite, but table-rebuild is the portable form — done once for all four.
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(`
      CREATE TABLE agent_002 (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, avatar_url TEXT,
        runtime_mode TEXT NOT NULL CHECK (runtime_mode IN ('local')),
        runtime_config TEXT NOT NULL DEFAULT '{}',
        visibility TEXT NOT NULL DEFAULT 'workspace' CHECK (visibility IN ('workspace', 'private')),
        status TEXT NOT NULL DEFAULT 'offline'
          CHECK (status IN ('idle', 'working', 'blocked', 'error', 'offline')),
        max_concurrent_tasks INTEGER NOT NULL DEFAULT 1,
        created_at ${TS}, updated_at ${TS}
      );
      INSERT INTO agent_002 SELECT id, name, avatar_url, runtime_mode, runtime_config,
        visibility, status, max_concurrent_tasks, created_at, updated_at FROM agent;
      DROP TABLE agent; ALTER TABLE agent_002 RENAME TO agent;
    `);
    db.exec("PRAGMA foreign_keys = ON");
  },
};

export const migration004AgentRuntimeLoop: Migration = {
  version: "004_agent_runtime_loop",
  up: (db) => {
    // Source: workspace_id, agent_id, runtime_data JSONB, last_seen_at — the
    // runtime's per-agent loop state (workspace column cut).
    db.exec(`
      CREATE TABLE agent_runtime (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL UNIQUE REFERENCES agent(id) ON DELETE CASCADE,
        runtime_data TEXT NOT NULL DEFAULT '{}',
        last_seen_at TEXT,
        created_at ${TS},
        updated_at ${TS}
      );
      CREATE INDEX idx_agent_runtime_agent ON agent_runtime(agent_id);
    `);
  },
  down: (db) => {
    db.exec("DROP TABLE IF EXISTS agent_runtime;");
  },
};

export const migration008StructuredSkills: Migration = {
  version: "008_structured_skills",
  up: (db) => {
    // Source is workspace-scoped; the single-namespace form drops
    // workspace_id and keeps UNIQUE(name).
    db.exec(`
      CREATE TABLE skill (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        source_type TEXT NOT NULL CHECK (source_type IN ('git', 'local', 'builtin')),
        source_url TEXT,
        version TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at ${TS},
        updated_at ${TS}
      );
      CREATE TABLE skill_file (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at ${TS},
        updated_at ${TS},
        UNIQUE (skill_id, path)
      );
      CREATE TABLE agent_skill (
        agent_id TEXT NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
        skill_id TEXT NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
        created_at ${TS},
        PRIMARY KEY (agent_id, skill_id)
      );
    `);
  },
  down: (db) => {
    db.exec(`
      DROP TABLE IF EXISTS agent_skill;
      DROP TABLE IF EXISTS skill_file;
      DROP TABLE IF EXISTS skill;
    `);
  },
};

export const migration015IssueSubscriber: Migration = {
  version: "015_issue_subscriber",
  up: (db) => {
    db.exec(`
      CREATE TABLE issue_subscriber (
        issue_id TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
        user_type TEXT NOT NULL CHECK (user_type IN ('owner', 'agent')),
        user_id TEXT NOT NULL,
        reason TEXT NOT NULL CHECK (reason IN ('creator', 'assignee', 'commenter', 'mentioned', 'manual')),
        created_at ${TS},
        PRIMARY KEY (issue_id, user_type, user_id)
      );
      CREATE INDEX idx_issue_subscriber_user ON issue_subscriber(user_type, user_id);
    `);
  },
  down: (db) => {
    db.exec("DROP TABLE IF EXISTS issue_subscriber;");
  },
};

export const migration017CommentParentId: Migration = {
  version: "017_comment_parent_id",
  up: (db) => {
    db.exec(
      `ALTER TABLE comment ADD COLUMN parent_id TEXT REFERENCES comment(id) ON DELETE SET NULL;`,
    );
  },
  down: (db) => {
    // Portable column drop via rebuild; comment has no dependents yet.
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(`
      CREATE TABLE comment_017 (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
        author_type TEXT NOT NULL CHECK (author_type IN ('owner', 'agent')),
        author_id TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'comment'
          CHECK (type IN ('comment', 'status_change', 'progress_update', 'system')),
        created_at ${TS}, updated_at ${TS}
      );
      INSERT INTO comment_017 SELECT id, issue_id, author_type, author_id, content, type, created_at, updated_at FROM comment;
      DROP TABLE comment; ALTER TABLE comment_017 RENAME TO comment;
    `);
    db.exec("PRAGMA foreign_keys = ON");
  },
};

export const migration018CommentParentCascade: Migration = {
  version: "018_comment_parent_cascade",
  up: (db) => {
    // SQLite cannot ALTER a FK: rebuild with parent_id cascading, the state
    // 018 leaves Postgres in.
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(`
      CREATE TABLE comment_018 (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
        author_type TEXT NOT NULL CHECK (author_type IN ('owner', 'agent')),
        author_id TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'comment'
          CHECK (type IN ('comment', 'status_change', 'progress_update', 'system')),
        parent_id TEXT REFERENCES comment_018(id) ON DELETE CASCADE,
        created_at ${TS}, updated_at ${TS}
      );
      INSERT INTO comment_018 SELECT id, issue_id, author_type, author_id, content, type, parent_id, created_at, updated_at FROM comment;
      DROP TABLE comment; ALTER TABLE comment_018 RENAME TO comment;
      CREATE INDEX idx_comment_issue ON comment(issue_id);
      CREATE INDEX idx_comment_parent ON comment(parent_id);
    `);
    db.exec("PRAGMA foreign_keys = ON");
  },
  down: (db) => {
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(`
      CREATE TABLE comment_018d (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
        author_type TEXT NOT NULL CHECK (author_type IN ('owner', 'agent')),
        author_id TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'comment'
          CHECK (type IN ('comment', 'status_change', 'progress_update', 'system')),
        parent_id TEXT REFERENCES comment_018d(id) ON DELETE SET NULL,
        created_at ${TS}, updated_at ${TS}
      );
      INSERT INTO comment_018d SELECT id, issue_id, author_type, author_id, content, type, parent_id, created_at, updated_at FROM comment;
      DROP TABLE comment; ALTER TABLE comment_018d RENAME TO comment;
      CREATE INDEX idx_comment_issue ON comment(issue_id);
    `);
    db.exec("PRAGMA foreign_keys = ON");
  },
};

export const migration020IssueNumber: Migration = {
  version: "020_issue_number",
  up: (db) => {
    // Source puts prefix+counter on workspace; single-workspace form factor
    // puts the counter here and the prefix as a constant in code.
    db.exec(`
      CREATE TABLE issue_number_sequence (
        next_value INTEGER NOT NULL
      );
      INSERT INTO issue_number_sequence (next_value) VALUES (1);
      ALTER TABLE issue ADD COLUMN number INTEGER;
      CREATE UNIQUE INDEX idx_issue_number ON issue(number);
    `);
  },
  down: (db) => {
    db.exec("DROP INDEX IF EXISTS idx_issue_number;");
    db.exec("DROP TABLE IF EXISTS issue_number_sequence;");
    // Column drop via rebuild (issue has dependents; FKs off for the swap).
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(`
      CREATE TABLE issue_020d (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
        status TEXT NOT NULL DEFAULT 'backlog'
          CHECK (status IN ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled')),
        priority TEXT NOT NULL DEFAULT 'none'
          CHECK (priority IN ('urgent', 'high', 'medium', 'low', 'none')),
        assignee_type TEXT CHECK (assignee_type IN ('owner', 'agent', 'squad')),
        assignee_id TEXT,
        creator_type TEXT NOT NULL CHECK (creator_type IN ('owner', 'agent')),
        creator_id TEXT NOT NULL,
        parent_issue_id TEXT REFERENCES issue_020d(id) ON DELETE SET NULL,
        acceptance_criteria TEXT NOT NULL DEFAULT '[]',
        context_refs TEXT NOT NULL DEFAULT '[]',
        position REAL NOT NULL DEFAULT 0,
        due_date TEXT,
        created_at ${TS}, updated_at ${TS}
      );
      INSERT INTO issue_020d SELECT id, title, description, status, priority, assignee_type, assignee_id,
        creator_type, creator_id, parent_issue_id, acceptance_criteria, context_refs, position, due_date, created_at, updated_at FROM issue;
      DROP TABLE issue; ALTER TABLE issue_020d RENAME TO issue;
    `);
    db.exec("PRAGMA foreign_keys = ON");
  },
};

export const migration026CommentReactions: Migration = {
  version: "026_comment_reactions",
  up: (db) => {
    db.exec(`
      CREATE TABLE comment_reaction (
        id TEXT PRIMARY KEY,
        comment_id TEXT NOT NULL REFERENCES comment(id) ON DELETE CASCADE,
        user_type TEXT NOT NULL CHECK (user_type IN ('owner', 'agent')),
        user_id TEXT NOT NULL,
        emoji TEXT NOT NULL,
        created_at ${TS},
        UNIQUE (comment_id, user_type, user_id, emoji)
      );
      CREATE INDEX idx_comment_reaction_comment ON comment_reaction(comment_id);
    `);
  },
  down: (db) => {
    db.exec("DROP TABLE IF EXISTS comment_reaction;");
  },
};

export const migration027IssueReactions: Migration = {
  version: "027_issue_reactions",
  up: (db) => {
    db.exec(`
      CREATE TABLE issue_reaction (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
        user_type TEXT NOT NULL CHECK (user_type IN ('owner', 'agent')),
        user_id TEXT NOT NULL,
        emoji TEXT NOT NULL,
        created_at ${TS},
        UNIQUE (issue_id, user_type, user_id, emoji)
      );
      CREATE INDEX idx_issue_reaction_issue ON issue_reaction(issue_id);
    `);
  },
  down: (db) => {
    db.exec("DROP TABLE IF EXISTS issue_reaction;");
  },
};

export const migration029Attachment: Migration = {
  version: "029_attachment",
  up: (db) => {
    db.exec(`
      CREATE TABLE attachment (
        id TEXT PRIMARY KEY,
        issue_id TEXT REFERENCES issue(id) ON DELETE CASCADE,
        comment_id TEXT REFERENCES comment(id) ON DELETE CASCADE,
        uploader_type TEXT NOT NULL CHECK (uploader_type IN ('owner', 'agent')),
        uploader_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        url TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_at ${TS}
      );
      CREATE INDEX idx_attachment_issue ON attachment(issue_id) WHERE issue_id IS NOT NULL;
      CREATE INDEX idx_attachment_comment ON attachment(comment_id) WHERE comment_id IS NOT NULL;
    `);
  },
  down: (db) => {
    db.exec("DROP TABLE IF EXISTS attachment;");
  },
};

export const migration032DropAgentTriggers: Migration = {
  version: "032_drop_agent_triggers",
  up: (db) => {
    // Behaviour is hardcoded upstream; the columns go.
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(`
      CREATE TABLE agent_032 (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, avatar_url TEXT,
        runtime_mode TEXT NOT NULL CHECK (runtime_mode IN ('local')),
        runtime_config TEXT NOT NULL DEFAULT '{}',
        visibility TEXT NOT NULL DEFAULT 'workspace' CHECK (visibility IN ('workspace', 'private')),
        status TEXT NOT NULL DEFAULT 'offline'
          CHECK (status IN ('idle', 'working', 'blocked', 'error', 'offline')),
        max_concurrent_tasks INTEGER NOT NULL DEFAULT 1,
        description TEXT NOT NULL DEFAULT '',
        skills TEXT NOT NULL DEFAULT '',
        created_at ${TS}, updated_at ${TS}
      );
      INSERT INTO agent_032 SELECT id, name, avatar_url, runtime_mode, runtime_config, visibility,
        status, max_concurrent_tasks, description, skills, created_at, updated_at FROM agent;
      DROP TABLE agent; ALTER TABLE agent_032 RENAME TO agent;
    `);
    db.exec("PRAGMA foreign_keys = ON");
  },
  down: (db) => {
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(`
      CREATE TABLE agent_032d (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, avatar_url TEXT,
        runtime_mode TEXT NOT NULL CHECK (runtime_mode IN ('local')),
        runtime_config TEXT NOT NULL DEFAULT '{}',
        visibility TEXT NOT NULL DEFAULT 'workspace' CHECK (visibility IN ('workspace', 'private')),
        status TEXT NOT NULL DEFAULT 'offline'
          CHECK (status IN ('idle', 'working', 'blocked', 'error', 'offline')),
        max_concurrent_tasks INTEGER NOT NULL DEFAULT 1,
        description TEXT NOT NULL DEFAULT '',
        skills TEXT NOT NULL DEFAULT '',
        tools TEXT NOT NULL DEFAULT '[]',
        triggers TEXT NOT NULL DEFAULT '[]',
        created_at ${TS}, updated_at ${TS}
      );
      INSERT INTO agent_032d SELECT id, name, avatar_url, runtime_mode, runtime_config, visibility,
        status, max_concurrent_tasks, description, skills, '[]', '[]', created_at, updated_at FROM agent;
      DROP TABLE agent; ALTER TABLE agent_032d RENAME TO agent;
    `);
    db.exec("PRAGMA foreign_keys = ON");
  },
};

export const migration034Projects: Migration = {
  version: "034_projects",
  up: (db) => {
    db.exec(`
      CREATE TABLE project (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        icon TEXT,
        status TEXT NOT NULL DEFAULT 'planned'
          CHECK (status IN ('planned', 'in_progress', 'paused', 'completed', 'cancelled')),
        lead_type TEXT CHECK (lead_type IN ('owner', 'agent')),
        lead_id TEXT,
        created_at ${TS},
        updated_at ${TS}
      );
      ALTER TABLE issue ADD COLUMN project_id TEXT REFERENCES project(id) ON DELETE SET NULL;
      CREATE INDEX idx_issue_project ON issue(project_id);
    `);
  },
  down: (db) => {
    db.exec("DROP INDEX IF EXISTS idx_issue_project;");
    // issue rebuild without project_id.
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(`
      CREATE TABLE issue_034d (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
        status TEXT NOT NULL DEFAULT 'backlog'
          CHECK (status IN ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled')),
        priority TEXT NOT NULL DEFAULT 'none'
          CHECK (priority IN ('urgent', 'high', 'medium', 'low', 'none')),
        assignee_type TEXT CHECK (assignee_type IN ('owner', 'agent', 'squad')),
        assignee_id TEXT,
        creator_type TEXT NOT NULL CHECK (creator_type IN ('owner', 'agent')),
        creator_id TEXT NOT NULL,
        parent_issue_id TEXT REFERENCES issue_034d(id) ON DELETE SET NULL,
        acceptance_criteria TEXT NOT NULL DEFAULT '[]',
        context_refs TEXT NOT NULL DEFAULT '[]',
        position REAL NOT NULL DEFAULT 0,
        due_date TEXT,
        number INTEGER,
        created_at ${TS}, updated_at ${TS}
      );
      INSERT INTO issue_034d SELECT id, title, description, status, priority, assignee_type, assignee_id,
        creator_type, creator_id, parent_issue_id, acceptance_criteria, context_refs, position, due_date, number, created_at, updated_at FROM issue;
      DROP TABLE issue; ALTER TABLE issue_034d RENAME TO issue;
      CREATE UNIQUE INDEX idx_issue_number ON issue(number);
      CREATE INDEX idx_issue_assignee ON issue(assignee_type, assignee_id);
      CREATE INDEX idx_issue_status ON issue(status);
      CREATE INDEX idx_issue_parent ON issue(parent_issue_id);
    `);
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("DROP TABLE IF EXISTS project;");
  },
};

export const migration041AgentCustomArgs: Migration = {
  version: "041_agent_custom_args",
  up: (db) => {
    db.exec(`ALTER TABLE agent ADD COLUMN custom_args TEXT NOT NULL DEFAULT '[]';`);
  },
  down: (db) => {
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(`
      CREATE TABLE agent_041d (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, avatar_url TEXT,
        runtime_mode TEXT NOT NULL CHECK (runtime_mode IN ('local')),
        runtime_config TEXT NOT NULL DEFAULT '{}',
        visibility TEXT NOT NULL DEFAULT 'workspace' CHECK (visibility IN ('workspace', 'private')),
        status TEXT NOT NULL DEFAULT 'offline'
          CHECK (status IN ('idle', 'working', 'blocked', 'error', 'offline')),
        max_concurrent_tasks INTEGER NOT NULL DEFAULT 1,
        description TEXT NOT NULL DEFAULT '',
        skills TEXT NOT NULL DEFAULT '',
        created_at ${TS}, updated_at ${TS}
      );
      INSERT INTO agent_041d SELECT id, name, avatar_url, runtime_mode, runtime_config, visibility,
        status, max_concurrent_tasks, description, skills, created_at, updated_at FROM agent;
      DROP TABLE agent; ALTER TABLE agent_041d RENAME TO agent;
    `);
    db.exec("PRAGMA foreign_keys = ON");
  },
};

export const migration042Autopilot: Migration = {
  version: "042_autopilot",
  up: (db) => {
    db.exec(`
      CREATE TABLE autopilot (
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
      CREATE INDEX idx_autopilot_assignee ON autopilot(assignee_type, assignee_id);

      CREATE TABLE autopilot_trigger (
        id TEXT PRIMARY KEY,
        autopilot_id TEXT NOT NULL REFERENCES autopilot(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('schedule', 'webhook', 'api')),
        enabled INTEGER NOT NULL DEFAULT 1,
        cron_expression TEXT,
        timezone TEXT DEFAULT 'UTC',
        next_run_at TEXT,
        webhook_token TEXT,
        label TEXT,
        last_fired_at TEXT,
        created_at ${TS},
        updated_at ${TS}
      );
      CREATE INDEX idx_autopilot_trigger_autopilot ON autopilot_trigger(autopilot_id);
      CREATE INDEX idx_autopilot_trigger_next_run ON autopilot_trigger(next_run_at)
        WHERE enabled = 1 AND kind = 'schedule';

      CREATE TABLE autopilot_run (
        id TEXT PRIMARY KEY,
        autopilot_id TEXT NOT NULL REFERENCES autopilot(id) ON DELETE CASCADE,
        trigger_id TEXT REFERENCES autopilot_trigger(id) ON DELETE SET NULL,
        source TEXT NOT NULL CHECK (source IN ('schedule', 'manual', 'webhook', 'api')),
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'issue_created', 'running', 'skipped', 'completed', 'failed')),
        issue_id TEXT REFERENCES issue(id) ON DELETE SET NULL,
        task_id TEXT REFERENCES agent_task_queue(id) ON DELETE SET NULL,
        triggered_at ${TS},
        completed_at TEXT,
        failure_reason TEXT,
        trigger_payload TEXT,
        result TEXT,
        created_at ${TS}
      );
      CREATE INDEX idx_autopilot_run_autopilot ON autopilot_run(autopilot_id, created_at DESC);
      CREATE INDEX idx_autopilot_run_status ON autopilot_run(autopilot_id, status)
        WHERE status IN ('pending', 'issue_created', 'running');
    `);
    db.exec(
      `ALTER TABLE agent_task_queue ADD COLUMN autopilot_run_id TEXT REFERENCES autopilot_run(id) ON DELETE SET NULL;`,
    );
    db.exec(`ALTER TABLE issue ADD COLUMN origin_type TEXT CHECK (origin_type IN ('autopilot'));`);
  },
  down: (db) => {
    // Rebuild issue and queue without the 042 columns, then drop the tables.
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(`
      CREATE TABLE issue_042d (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
        status TEXT NOT NULL DEFAULT 'backlog'
          CHECK (status IN ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled')),
        priority TEXT NOT NULL DEFAULT 'none'
          CHECK (priority IN ('urgent', 'high', 'medium', 'low', 'none')),
        assignee_type TEXT CHECK (assignee_type IN ('owner', 'agent', 'squad')),
        assignee_id TEXT,
        creator_type TEXT NOT NULL CHECK (creator_type IN ('owner', 'agent')),
        creator_id TEXT NOT NULL,
        parent_issue_id TEXT REFERENCES issue_042d(id) ON DELETE SET NULL,
        acceptance_criteria TEXT NOT NULL DEFAULT '[]',
        context_refs TEXT NOT NULL DEFAULT '[]',
        position REAL NOT NULL DEFAULT 0,
        due_date TEXT,
        number INTEGER,
        project_id TEXT REFERENCES project(id) ON DELETE SET NULL,
        created_at ${TS}, updated_at ${TS}
      );
      INSERT INTO issue_042d SELECT id, title, description, status, priority, assignee_type, assignee_id,
        creator_type, creator_id, parent_issue_id, acceptance_criteria, context_refs, position, due_date,
        number, project_id, created_at, updated_at FROM issue;
      DROP TABLE issue; ALTER TABLE issue_042d RENAME TO issue;
      CREATE UNIQUE INDEX idx_issue_number ON issue(number);
      CREATE INDEX idx_issue_assignee ON issue(assignee_type, assignee_id);
      CREATE INDEX idx_issue_status ON issue(status);
      CREATE INDEX idx_issue_parent ON issue(parent_issue_id);
      CREATE INDEX idx_issue_project ON issue(project_id);

      CREATE TABLE queue_042d (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
        issue_id TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'queued'
          CHECK (status IN ('queued', 'dispatched', 'running', 'completed', 'failed', 'cancelled')),
        priority INTEGER NOT NULL DEFAULT 0,
        dispatched_at TEXT, started_at TEXT, completed_at TEXT,
        result TEXT, error TEXT, created_at ${TS}
      );
      INSERT INTO queue_042d SELECT id, agent_id, issue_id, status, priority, dispatched_at, started_at,
        completed_at, result, error, created_at FROM agent_task_queue;
      DROP TABLE agent_task_queue; ALTER TABLE queue_042d RENAME TO agent_task_queue;
      CREATE INDEX idx_agent_task_queue_agent ON agent_task_queue(agent_id, status);
    `);
    db.exec(`
      DROP TABLE IF EXISTS autopilot_run;
      DROP TABLE IF EXISTS autopilot_trigger;
      DROP TABLE IF EXISTS autopilot;
    `);
    db.exec("PRAGMA foreign_keys = ON");
  },
};
