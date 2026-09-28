/**
 * Migrations 120–549 (the replica-table subset) — SQLite translations of
 * multica's trigger-routing, attribution, properties, and supplement work
 * (commit 04cdd48).
 *
 * Source contracts preserved:
 *
 *   120 — autopilot_subscriber (user_type 'member' → 'owner'); comment gains
 *         source_task_id (a comment written by a run carries that run's id —
 *         the self-trigger guard and attribution both read it).
 *   122/124/128 — queue handoff_note, prepare lease, escalation/fire_at;
 *         128 also widens the queue status enum (adds 'deferred',
 *         'waiting_local_directory').
 *   149 — issue.origin_type gains 'agent_create' (chat origins cut, the agent
 *         path kept).
 *   150/157/158/180 — queue coalesced/delivered comment ids (TEXT json
 *         arrays), chat linkage columns (chat is cut; chat_finalize and
 *         chat_input_task_id still ported as columns for shape parity since
 *         they ride the queue — values stay null without chat).
 *   162 — labels generalize: resource_type on issue_label + agent_to_label
 *         + skill_to_label link tables.
 *   163 — agent.kind ('user'|'system') + system_key: the built-in-agent
 *         mechanism the secretary stands on.
 *   164/166 — attachment.task_id; project start/due dates.
 *   184/185/190/197 — the attribution waterfall: originator_source,
 *         delegated_from/retry_of/rerun_of/rule_version/trigger-evidence
 *         columns, accountable_user_id ("audit only — NEVER authorization",
 *         kept verbatim in the comment), the loose then strict invariant
 *         CHECKs between accountable and originator.
 *   189 — autopilot_trigger gains published_by attribution.
 *   186 — autopilot_rule_version: the rule snapshot table the strict
 *         attribution references.
 *   191/192 — issue_property (typed custom fields) + its lookup index
 *         (192's GIN becomes a plain index).
 *   206/212 — agent disabled_runtime_skills (TEXT json), service_tier.
 *   224/234/236 — queue session_rollout_missing, retired_session_id,
 *         quick_actions_disabled.
 *   239 — comment.quick_action_id.
 *   249 — issue_subscriber reason gains 'autopilot' and 'delegated', plus
 *         unsubscribed_at.
 *   538/548/549 — task_supplement + capability: the run's queued comment
 *         deliveries with idempotent delivery state; the 548/549 primary-key
 *         swap collapses to a composite PK on (comment_id, task_id) inline
 *         (PG's CONCURRENTLY split is mechanics, not model). The source's
 *         settle-terminal-supplements trigger function is behavior, not
 *         schema — it lands with the trigger engine (slice 4).
 */
import type { Migration } from "./runner.js";
import { rebuildTableWithFksOff } from "./rebuild.js";

const TS = "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

export const migration120AutopilotSubscriber: Migration = {
  version: "120_autopilot_subscriber",
  up: (db) => {
    db.exec(`
      CREATE TABLE autopilot_subscriber (
        autopilot_id TEXT NOT NULL REFERENCES autopilot(id) ON DELETE CASCADE,
        user_type TEXT NOT NULL CHECK (user_type IN ('owner')),
        user_id TEXT NOT NULL,
        created_at ${TS},
        PRIMARY KEY (autopilot_id, user_type, user_id)
      );
      CREATE INDEX idx_autopilot_subscriber_user ON autopilot_subscriber(user_type, user_id);
    `);
    db.exec(`ALTER TABLE comment ADD COLUMN source_task_id TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE comment DROP COLUMN source_task_id;`);
    db.exec(`DROP TABLE IF EXISTS autopilot_subscriber;`);
  },
};

export const migration122TaskHandoffNote: Migration = {
  version: "122_task_handoff_note",
  up: (db) => {
    db.exec(`ALTER TABLE agent_task_queue ADD COLUMN handoff_note TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN handoff_note;`);
  },
};

export const migration123IssueStage: Migration = {
  version: "123_issue_stage",
  up: (db) => {
    db.exec(`ALTER TABLE issue ADD COLUMN stage INTEGER CHECK (stage IS NULL OR stage >= 1);`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE issue DROP COLUMN stage;`);
  },
};

export const migration124AutopilotRunPlannedAt: Migration = {
  version: "124_autopilot_run_planned_at",
  up: (db) => {
    db.exec(`ALTER TABLE autopilot_run ADD COLUMN planned_at TEXT;`);
    db.exec(
      `CREATE UNIQUE INDEX uq_autopilot_run_trigger_planned ON autopilot_run(trigger_id, planned_at) WHERE trigger_id IS NOT NULL AND planned_at IS NOT NULL;`,
    );
  },
  down: (db) => {
    db.exec(`DROP INDEX IF EXISTS uq_autopilot_run_trigger_planned;`);
    db.exec(`ALTER TABLE autopilot_run DROP COLUMN planned_at;`);
  },
};

export const migration124TaskPrepareLease: Migration = {
  version: "124_task_prepare_lease",
  up: (db) => {
    db.exec(`ALTER TABLE agent_task_queue ADD COLUMN prepare_lease_expires_at TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN prepare_lease_expires_at;`);
  },
};

export const migration128CommentRoutingEscalation: Migration = {
  version: "128_comment_routing_escalation",
  up: (db) => {
    db.exec("ALTER TABLE agent_task_queue ADD COLUMN escalation_for_task_id TEXT;");
    db.exec("ALTER TABLE agent_task_queue ADD COLUMN fire_at TEXT;");
    // 128's own status widening: adds 'deferred' and 'waiting_local_directory'.
    // is_leader_task (090) and squad_id (127) already exist and must ride the
    // rebuild.
    rebuildTableWithFksOff(db, {
      table: "agent_task_queue",
      ddl: `CREATE TABLE agent_task_queue (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
        -- 033 dropped NOT NULL here (chat and run_only autopilot tasks
        -- carry no issue); the rebuilds must not re-introduce it.
        issue_id TEXT REFERENCES issue(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'queued'
          CHECK (status IN ('queued', 'dispatched', 'running', 'completed', 'failed', 'cancelled',
                            'deferred', 'waiting_local_directory')),
        priority INTEGER NOT NULL DEFAULT 0,
        dispatched_at TEXT, started_at TEXT, completed_at TEXT,
        result TEXT, error TEXT,
        autopilot_run_id TEXT REFERENCES autopilot_run(id) ON DELETE SET NULL,
        attempt INTEGER NOT NULL DEFAULT 1,
        max_attempts INTEGER NOT NULL DEFAULT 2,
        parent_task_id TEXT,
        failure_reason TEXT,
        trigger_summary TEXT,
        force_fresh_session INTEGER NOT NULL DEFAULT 0,
        context TEXT,
        session_id TEXT,
        work_dir TEXT,
        trigger_comment_id TEXT,
        chat_session_id TEXT,
        wait_reason TEXT,
        initiator_user_id TEXT,
        runtime_mcp_overlay TEXT,
        runtime_id TEXT REFERENCES agent_runtime(id) ON DELETE SET NULL,
        handoff_note TEXT,
        prepare_lease_expires_at TEXT,
        is_leader_task INTEGER NOT NULL DEFAULT 0,
        squad_id TEXT,
        escalation_for_task_id TEXT,
        fire_at TEXT,
        created_at ${TS}
      );`,
      carry: [
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
        "autopilot_run_id",
        "attempt",
        "max_attempts",
        "parent_task_id",
        "failure_reason",
        "trigger_summary",
        "force_fresh_session",
        "context",
        "session_id",
        "work_dir",
        "trigger_comment_id",
        "chat_session_id",
        "wait_reason",
        "initiator_user_id",
        "runtime_mcp_overlay",
        "runtime_id",
        "handoff_note",
        "prepare_lease_expires_at",
        "is_leader_task",
        "squad_id",
        "escalation_for_task_id",
        "fire_at",
        "created_at",
      ],
      indexes: [
        "CREATE INDEX idx_agent_task_queue_agent ON agent_task_queue(agent_id, status);",
        "CREATE INDEX agent_task_queue_squad_id_idx ON agent_task_queue(squad_id) WHERE squad_id IS NOT NULL;",
      ],
    });
  },
  down: () => {
    // The source does not narrow the enum back; the columns are dropped.
  },
};

export const migration129AgentComposioAllowlistAndTaskOriginator: Migration = {
  version: "129_agent_composio_allowlist_and_task_originator",
  up: (db) => {
    // composio_toolkit_allowlist: TEXT[] for an ANY() hot-path filter — the
    // replica stores the same shape as TEXT json; the hot-path filter
    // difference lands with the dispatch engine, not the schema.
    db.exec(`ALTER TABLE agent ADD COLUMN composio_toolkit_allowlist TEXT;`);
    db.exec(`ALTER TABLE agent_task_queue ADD COLUMN originator_user_id TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN originator_user_id;`);
    db.exec(`ALTER TABLE agent DROP COLUMN composio_toolkit_allowlist;`);
  },
};

export const migration130AgentInvocationPermission: Migration = {
  version: "130_agent_invocation_permission",
  up: (db) => {
    db.exec(`ALTER TABLE agent ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'private'
      CHECK (permission_mode IN ('private', 'public_to'));`);
    db.exec(`
      CREATE TABLE agent_invocation_target (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL CHECK (target_type IN ('owner', 'agent')),
        target_id TEXT NOT NULL,
        created_at ${TS},
        UNIQUE (agent_id, target_type, target_id)
      );
    `);
  },
  down: (db) => {
    db.exec(`DROP TABLE IF EXISTS agent_invocation_target;`);
    db.exec(`ALTER TABLE agent DROP COLUMN permission_mode;`);
  },
};

export const migration149IssueOriginAgentCreate: Migration = {
  version: "149_issue_origin_agent_create",
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
        origin_type TEXT CHECK (origin_type IN ('autopilot', 'quick_create', 'agent_create')),
        first_executed_at TEXT,
        stage INTEGER CHECK (stage IS NULL OR stage >= 1),
        start_date TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
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
        "stage",
        "start_date",
        "metadata",
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

export const migration150AgentTaskCoalescedComments: Migration = {
  version: "150_agent_task_coalesced_comments",
  up: (db) => {
    db.exec(
      `ALTER TABLE agent_task_queue ADD COLUMN coalesced_comment_ids TEXT NOT NULL DEFAULT '[]';`,
    );
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN coalesced_comment_ids;`);
  },
};

export const migration157AgentTaskDeliveredComments: Migration = {
  version: "157_agent_task_delivered_comments",
  up: (db) => {
    db.exec(
      `ALTER TABLE agent_task_queue ADD COLUMN delivered_comment_ids TEXT NOT NULL DEFAULT '[]';`,
    );
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN delivered_comment_ids;`);
  },
};

export const migration162ResourceLabels: Migration = {
  version: "162_resource_labels",
  up: (db) => {
    db.exec(`ALTER TABLE issue_label ADD COLUMN resource_type TEXT NOT NULL DEFAULT 'issue'
      CHECK (resource_type IN ('issue', 'agent', 'skill'));`);
    db.exec(`ALTER TABLE issue_label ADD COLUMN description TEXT NOT NULL DEFAULT '';`);
    db.exec(`
      CREATE TABLE agent_to_label (
        agent_id TEXT NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
        label_id TEXT NOT NULL REFERENCES issue_label(id) ON DELETE CASCADE,
        created_at ${TS},
        PRIMARY KEY (agent_id, label_id)
      );
      CREATE TABLE skill_to_label (
        skill_id TEXT NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
        label_id TEXT NOT NULL REFERENCES issue_label(id) ON DELETE CASCADE,
        created_at ${TS},
        PRIMARY KEY (skill_id, label_id)
      );
    `);
  },
  down: (db) => {
    db.exec(`DROP TABLE IF EXISTS skill_to_label;`);
    db.exec(`DROP TABLE IF EXISTS agent_to_label;`);
    db.exec(`ALTER TABLE issue_label DROP COLUMN description;`);
    db.exec(`ALTER TABLE issue_label DROP COLUMN resource_type;`);
  },
};

export const migration163AgentBuilder: Migration = {
  version: "163_agent_builder",
  up: (db) => {
    // The built-in-agent mechanism: kind='system' rows are hidden execution
    // carriers seeded by the product; the secretary is one.
    db.exec(
      `ALTER TABLE agent ADD COLUMN kind TEXT NOT NULL DEFAULT 'user' CHECK (kind IN ('user', 'system'));`,
    );
    db.exec(`ALTER TABLE agent ADD COLUMN system_key TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent DROP COLUMN system_key;`);
    db.exec(`ALTER TABLE agent DROP COLUMN kind;`);
  },
};

export const migration164AttachmentTaskId: Migration = {
  version: "164_attachment_task_id",
  up: (db) => {
    db.exec(`ALTER TABLE attachment ADD COLUMN task_id TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE attachment DROP COLUMN task_id;`);
  },
};

export const migration166ProjectDates: Migration = {
  version: "166_project_dates",
  up: (db) => {
    db.exec(`ALTER TABLE project ADD COLUMN start_date TEXT;`);
    db.exec(`ALTER TABLE project ADD COLUMN due_date TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE project DROP COLUMN due_date;`);
    db.exec(`ALTER TABLE project DROP COLUMN start_date;`);
  },
};

export const migration184AgentTaskAttribution: Migration = {
  version: "184_agent_task_attribution",
  up: (db) => {
    for (const col of [
      "originator_source TEXT NULL",
      "delegated_from_task_id TEXT NULL",
      "retry_of_task_id TEXT NULL",
      "rerun_of_task_id TEXT NULL",
      "rule_version_id TEXT NULL",
      "trigger_evidence_kind TEXT NULL",
      "trigger_evidence_ref_id TEXT NULL",
    ]) {
      db.exec(`ALTER TABLE agent_task_queue ADD COLUMN ${col};`);
    }
  },
  down: (db) => {
    for (const col of [
      "trigger_evidence_ref_id",
      "trigger_evidence_kind",
      "rule_version_id",
      "rerun_of_task_id",
      "retry_of_task_id",
      "delegated_from_task_id",
      "originator_source",
    ]) {
      db.exec(`ALTER TABLE agent_task_queue DROP COLUMN ${col};`);
    }
  },
};

export const migration185AgentTaskAccountableUser: Migration = {
  version: "185_agent_task_accountable_user",
  up: (db) => {
    db.exec(`ALTER TABLE agent_task_queue ADD COLUMN accountable_user_id TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN accountable_user_id;`);
  },
};

export const migration186AutopilotRuleVersion: Migration = {
  version: "186_autopilot_rule_version",
  up: (db) => {
    db.exec(`
      CREATE TABLE autopilot_rule_version (
        id TEXT PRIMARY KEY,
        autopilot_id TEXT NOT NULL,
        published_by_type TEXT NOT NULL,
        published_by_id TEXT,
        config_summary TEXT NOT NULL DEFAULT '{}',
        created_at ${TS}
      );
    `);
  },
  down: (db) => {
    db.exec(`DROP TABLE IF EXISTS autopilot_rule_version;`);
  },
};

export const migration189AutopilotTriggerPublisher: Migration = {
  version: "189_autopilot_trigger_publisher",
  up: (db) => {
    db.exec(`ALTER TABLE autopilot_trigger ADD COLUMN published_by_type TEXT;`);
    db.exec(`ALTER TABLE autopilot_trigger ADD COLUMN published_by_id TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE autopilot_trigger DROP COLUMN published_by_id;`);
    db.exec(`ALTER TABLE autopilot_trigger DROP COLUMN published_by_type;`);
  },
};

export const migration190AgentTaskAttributionInvariantCheck: Migration = {
  version: "190_agent_task_attribution_invariant_check",
  up: (db) => {
    // The invariant, verbatim from the source: accountable_user_id is audit
    // and visibility only — never authorization.
    rebuildTableWithFksOff(db, {
      table: "agent_task_queue",
      ddl: `CREATE TABLE agent_task_queue (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
        -- 033 dropped NOT NULL here (chat and run_only autopilot tasks
        -- carry no issue); the rebuilds must not re-introduce it.
        issue_id TEXT REFERENCES issue(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'queued'
          CHECK (status IN ('queued', 'dispatched', 'running', 'completed', 'failed', 'cancelled',
                            'deferred', 'waiting_local_directory')),
        priority INTEGER NOT NULL DEFAULT 0,
        dispatched_at TEXT, started_at TEXT, completed_at TEXT,
        result TEXT, error TEXT,
        autopilot_run_id TEXT REFERENCES autopilot_run(id) ON DELETE SET NULL,
        attempt INTEGER NOT NULL DEFAULT 1,
        max_attempts INTEGER NOT NULL DEFAULT 2,
        parent_task_id TEXT,
        failure_reason TEXT,
        trigger_summary TEXT,
        force_fresh_session INTEGER NOT NULL DEFAULT 0,
        context TEXT,
        session_id TEXT,
        work_dir TEXT,
        trigger_comment_id TEXT,
        chat_session_id TEXT,
        wait_reason TEXT,
        initiator_user_id TEXT,
        runtime_mcp_overlay TEXT,
        runtime_connected_apps TEXT,
        chat_input_task_id TEXT,
        chat_finalize_deferred_at TEXT,
        runtime_id TEXT REFERENCES agent_runtime(id) ON DELETE SET NULL,
        handoff_note TEXT,
        prepare_lease_expires_at TEXT,
        escalation_for_task_id TEXT,
        fire_at TEXT,
        is_leader_task INTEGER NOT NULL DEFAULT 0,
        squad_id TEXT,
        originator_user_id TEXT,
        originator_source TEXT,
        delegated_from_task_id TEXT,
        retry_of_task_id TEXT,
        rerun_of_task_id TEXT,
        rule_version_id TEXT,
        trigger_evidence_kind TEXT,
        trigger_evidence_ref_id TEXT,
        accountable_user_id TEXT,
        coalesced_comment_ids TEXT NOT NULL DEFAULT '[]',
        delivered_comment_ids TEXT NOT NULL DEFAULT '[]',
        created_at ${TS},
        -- Table-level constraints must follow all column definitions in
        -- SQLite; PG allows either order.
        CONSTRAINT agent_task_queue_accountable_matches_originator
          CHECK (
            originator_source IS NULL
            OR originator_user_id IS NULL
            OR (accountable_user_id IS NOT NULL AND accountable_user_id = originator_user_id)
          )
      );`,
      carry: [
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
        "autopilot_run_id",
        "attempt",
        "max_attempts",
        "parent_task_id",
        "failure_reason",
        "trigger_summary",
        "force_fresh_session",
        "context",
        "session_id",
        "work_dir",
        "trigger_comment_id",
        "chat_session_id",
        "wait_reason",
        "initiator_user_id",
        "runtime_mcp_overlay",
        "runtime_connected_apps",
        "chat_input_task_id",
        "chat_finalize_deferred_at",
        "runtime_id",
        "handoff_note",
        "prepare_lease_expires_at",
        "escalation_for_task_id",
        "fire_at",
        "is_leader_task",
        "squad_id",
        "originator_user_id",
        "originator_source",
        "delegated_from_task_id",
        "retry_of_task_id",
        "rerun_of_task_id",
        "rule_version_id",
        "trigger_evidence_kind",
        "trigger_evidence_ref_id",
        "accountable_user_id",
        "coalesced_comment_ids",
        "delivered_comment_ids",
        "created_at",
      ],
      indexes: [
        "CREATE INDEX idx_agent_task_queue_agent ON agent_task_queue(agent_id, status);",
        "CREATE INDEX agent_task_queue_squad_id_idx ON agent_task_queue(squad_id) WHERE squad_id IS NOT NULL;",
      ],
    });
  },
  down: () => {},
};

export const migration191IssueProperties: Migration = {
  version: "191_issue_properties",
  up: (db) => {
    db.exec(`
      CREATE TABLE issue_property (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url')),
        description TEXT NOT NULL DEFAULT '',
        options TEXT NOT NULL DEFAULT '{}',
        created_at ${TS},
        updated_at ${TS}
      );
      CREATE TABLE issue_to_property (
        issue_id TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
        property_id TEXT NOT NULL REFERENCES issue_property(id) ON DELETE CASCADE,
        value TEXT,
        created_at ${TS},
        updated_at ${TS},
        PRIMARY KEY (issue_id, property_id)
      );
      CREATE INDEX idx_issue_to_property_property ON issue_to_property(property_id);
      -- The JSONB value bag on each issue, keyed by property definition id —
      -- structurally a sibling of metadata. TEXT json under translation.
      ALTER TABLE issue ADD COLUMN properties TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE issue ADD COLUMN origin_id TEXT;
      CREATE INDEX idx_issue_origin ON issue(origin_type, origin_id) WHERE origin_type IS NOT NULL;
    `);
  },
  down: (db) => {
    db.exec(`DROP INDEX IF EXISTS idx_issue_origin;`);
    db.exec(`ALTER TABLE issue DROP COLUMN origin_id;`);
    db.exec(`ALTER TABLE issue DROP COLUMN properties;`);
    db.exec(`DROP TABLE IF EXISTS issue_to_property;`);
    db.exec(`DROP TABLE IF EXISTS issue_property;`);
  },
};

export const migration206AgentDisabledRuntimeSkills: Migration = {
  version: "206_agent_disabled_runtime_skills",
  up: (db) => {
    db.exec(`ALTER TABLE agent ADD COLUMN disabled_runtime_skills TEXT NOT NULL DEFAULT '[]';`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent DROP COLUMN disabled_runtime_skills;`);
  },
};

export const migration212AgentServiceTier: Migration = {
  version: "212_agent_service_tier",
  up: (db) => {
    db.exec(`ALTER TABLE agent ADD COLUMN service_tier TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent DROP COLUMN service_tier;`);
  },
};

export const migration224AgentTaskSessionRolloutMissing: Migration = {
  version: "224_agent_task_session_rollout_missing",
  up: (db) => {
    db.exec(
      `ALTER TABLE agent_task_queue ADD COLUMN session_rollout_missing INTEGER NOT NULL DEFAULT 0;`,
    );
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN session_rollout_missing;`);
  },
};

export const migration234AgentTaskQueueRetiredSessionId: Migration = {
  version: "234_agent_task_queue_retired_session_id",
  up: (db) => {
    db.exec(`ALTER TABLE agent_task_queue ADD COLUMN retired_session_id TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN retired_session_id;`);
  },
};

export const migration236AgentTaskQuickActionsDisabled: Migration = {
  version: "236_agent_task_quick_actions_disabled",
  up: (db) => {
    db.exec(
      `ALTER TABLE agent_task_queue ADD COLUMN quick_actions_disabled INTEGER NOT NULL DEFAULT 0;`,
    );
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN quick_actions_disabled;`);
  },
};

export const migration239CommentQuickAction: Migration = {
  version: "239_comment_quick_action",
  up: (db) => {
    db.exec(`ALTER TABLE comment ADD COLUMN quick_action_id TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE comment DROP COLUMN quick_action_id;`);
  },
};

export const migration249IssueSubscriberDelegated: Migration = {
  version: "249_issue_subscriber_delegated",
  up: (db) => {
    db.exec(`ALTER TABLE issue_subscriber ADD COLUMN unsubscribed_at TEXT;`);
    rebuildTableWithFksOff(db, {
      table: "issue_subscriber",
      ddl: `CREATE TABLE issue_subscriber (
        issue_id TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
        user_type TEXT NOT NULL CHECK (user_type IN ('owner', 'agent')),
        user_id TEXT NOT NULL,
        reason TEXT NOT NULL CHECK (reason IN ('creator', 'assignee', 'commenter', 'mentioned', 'manual', 'autopilot', 'delegated')),
        created_at ${TS},
        unsubscribed_at TEXT,
        PRIMARY KEY (issue_id, user_type, user_id)
      );`,
      carry: ["issue_id", "user_type", "user_id", "reason", "created_at"],
      indexes: ["CREATE INDEX idx_issue_subscriber_user ON issue_subscriber(user_type, user_id);"],
    });
  },
  down: () => {},
};

export const migration538TaskSupplement: Migration = {
  version: "538_task_supplement",
  up: (db) => {
    // 548/549 collapsed: the PK is the (comment_id, task_id) pair the source
    // ends with after its CONCURRENTLY dance. The source's settle-terminal
    // trigger function is behavior and lands with the trigger engine.
    db.exec(`
      CREATE TABLE task_supplement_capability (
        task_id TEXT NOT NULL,
        issue_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        created_at ${TS},
        PRIMARY KEY (task_id, capability)
      );
      CREATE TABLE task_supplement (
        task_id TEXT NOT NULL,
        issue_id TEXT NOT NULL,
        comment_id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        client_request_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'delivering', 'delivered', 'failed')),
        failure_reason TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        created_at ${TS},
        updated_at ${TS},
        delivered_at TEXT,
        PRIMARY KEY (comment_id, task_id)
      );
      CREATE INDEX idx_task_supplement_task ON task_supplement(task_id);
      CREATE INDEX idx_task_supplement_client_request ON task_supplement(client_request_id);
    `);
  },
  down: (db) => {
    db.exec(`DROP TABLE IF EXISTS task_supplement;`);
    db.exec(`DROP TABLE IF EXISTS task_supplement_capability;`);
  },
};
