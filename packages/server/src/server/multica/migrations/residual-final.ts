/**
 * The final residual — every column the generated models.go structs read
 * that the replica still lacked, one migration per source file.
 *
 * This is the third and last audit layer: batch translation (per-migration),
 * the ADD COLUMN union, and now the structs themselves — what the Go code
 * actually reads. After this batch, every replica table's column set equals
 * its models.go struct minus the cut columns (workspace_id, owner_id, and
 * the chat/channel/plugin/github/usage circles).
 *
 * AgentTaskQueue is the big one: 59 source columns, the run queue the whole
 * product drives on. The chat-lifecycle columns (chat_session_id,
 * chat_input_task_id, chat_finalize_deferred_at, channel_context_revision)
 * port as nullable columns for shape parity — chat itself is cut, so their
 * values stay null; runtime_mcp_overlay and runtime_connected_apps ride the
 * composio circle and port as nullable TEXT the same way. webhook_delivery_id
 * (176) and quota_reservation_id/reason_code (352) port for the same reason —
 * shape parity with cut features, values null.
 */
import { rebuildTableWithFksOff } from "./rebuild.js";
import type { Migration } from "./runner.js";

export const migration003TaskContext: Migration = {
  version: "003_task_context",
  up: (db) => {
    db.exec(`ALTER TABLE agent_task_queue ADD COLUMN context TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN context;`);
  },
};

export const migration019InboxDetails: Migration = {
  version: "019_inbox_details",
  up: (db) => {
    db.exec(`ALTER TABLE inbox_item ADD COLUMN details TEXT DEFAULT '{}';`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE inbox_item DROP COLUMN details;`);
  },
};

export const migration020TaskSession: Migration = {
  version: "020_task_session",
  up: (db) => {
    db.exec(`ALTER TABLE agent_task_queue ADD COLUMN session_id TEXT;`);
    db.exec(`ALTER TABLE agent_task_queue ADD COLUMN work_dir TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN work_dir;`);
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN session_id;`);
  },
};

export const migration028TaskTriggerComment: Migration = {
  version: "028_task_trigger_comment",
  up: (db) => {
    db.exec(
      `ALTER TABLE agent_task_queue ADD COLUMN trigger_comment_id TEXT REFERENCES comment(id) ON DELETE SET NULL;`,
    );
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN trigger_comment_id;`);
  },
};

export const migration033Chat: Migration = {
  version: "033_chat",
  up: (db) => {
    // The chat tables are cut; the queue's chat linkage column ports for
    // shape parity and stays null. The source's other half — issue_id
    // dropping NOT NULL, because chat tasks and run_only autopilot runs
    // carry no issue — rides a rebuild: SQLite cannot relax a constraint in
    // place. Carry order is the table's shape at 033.
    rebuildTableWithFksOff(db, {
      table: "agent_task_queue",
      ddl: `CREATE TABLE agent_task_queue (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
        issue_id TEXT REFERENCES issue(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'queued',
        priority INTEGER NOT NULL DEFAULT 0,
        dispatched_at TEXT, started_at TEXT, completed_at TEXT,
        result TEXT, error TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        context TEXT,
        runtime_id TEXT,
        session_id TEXT,
        work_dir TEXT,
        trigger_comment_id TEXT,
        chat_session_id TEXT
      )`,
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
        "created_at",
        "context",
        "runtime_id",
        "session_id",
        "work_dir",
        "trigger_comment_id",
      ],
      indexes: [`CREATE INDEX idx_agent_task_queue_agent ON agent_task_queue(agent_id, status)`],
    });
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN chat_session_id;`);
  },
};

export const migration093WebhookDeliveries: Migration = {
  version: "093_webhook_deliveries",
  up: (db) => {
    // webhook_delivery itself is cut (webhook circle); the trigger columns
    // port for shape parity.
    db.exec(`ALTER TABLE autopilot_trigger ADD COLUMN provider TEXT NOT NULL DEFAULT 'generic';`);
    db.exec(`ALTER TABLE autopilot_trigger ADD COLUMN signing_secret TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE autopilot_trigger DROP COLUMN signing_secret;`);
    db.exec(`ALTER TABLE autopilot_trigger DROP COLUMN provider;`);
  },
};

export const migration109AgentTaskWaitingLocalDirectory: Migration = {
  version: "109_agent_task_waiting_local_directory",
  up: (db) => {
    db.exec(`ALTER TABLE agent_task_queue ADD COLUMN wait_reason TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN wait_reason;`);
  },
};

export const migration110AutopilotTriggerEventFilters: Migration = {
  version: "110_autopilot_trigger_event_filters",
  up: (db) => {
    db.exec(`ALTER TABLE autopilot_trigger ADD COLUMN event_filters TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE autopilot_trigger DROP COLUMN event_filters;`);
  },
};

export const migration117AgentTaskQueueInitiatorUserId: Migration = {
  version: "117_agent_task_queue_initiator_user_id",
  up: (db) => {
    db.exec(`ALTER TABLE agent_task_queue ADD COLUMN initiator_user_id TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN initiator_user_id;`);
  },
};

export const migration128AgentTaskQueueRuntimeMcpOverlay: Migration = {
  version: "128_agent_task_queue_runtime_mcp_overlay",
  up: (db) => {
    db.exec(`ALTER TABLE agent_task_queue ADD COLUMN runtime_mcp_overlay TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN runtime_mcp_overlay;`);
  },
};

export const migration132AgentTaskQueueRuntimeConnectedApps: Migration = {
  version: "132_agent_task_queue_runtime_connected_apps",
  up: (db) => {
    db.exec(`ALTER TABLE agent_task_queue ADD COLUMN runtime_connected_apps TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN runtime_connected_apps;`);
  },
};

export const migration158AgentTaskQueueChatInputTaskId: Migration = {
  version: "158_agent_task_queue_chat_input_task_id",
  up: (db) => {
    // Chat linkage, cut feature, nullable for shape parity.
    db.exec(`ALTER TABLE agent_task_queue ADD COLUMN chat_input_task_id TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN chat_input_task_id;`);
  },
};

export const migration176WebhookDeliveryWorker: Migration = {
  version: "176_webhook_delivery_worker",
  up: (db) => {
    db.exec(`ALTER TABLE autopilot_run ADD COLUMN webhook_delivery_id TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE autopilot_run DROP COLUMN webhook_delivery_id;`);
  },
};

export const migration180TaskChatFinalizeDeferred: Migration = {
  version: "180_task_chat_finalize_deferred",
  up: (db) => {
    db.exec(`ALTER TABLE agent_task_queue ADD COLUMN chat_finalize_deferred_at TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN chat_finalize_deferred_at;`);
  },
};

export const migration240AgentTaskRegenerateQuickActions: Migration = {
  version: "240_agent_task_regenerate_quick_actions",
  up: (db) => {
    db.exec(`ALTER TABLE agent_task_queue ADD COLUMN regenerate_quick_actions_for TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN regenerate_quick_actions_for;`);
  },
};

export const migration251AgentRuntimeUnbind: Migration = {
  version: "251_agent_runtime_unbind",
  up: (db) => {
    // The source's runtime_id DROP NOT NULL lands implicitly: our runtime_id
    // is already nullable. pause_reason is the column the struct reads.
    db.exec(`ALTER TABLE autopilot ADD COLUMN pause_reason TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE autopilot DROP COLUMN pause_reason;`);
  },
};

export const migration308AgentTaskBranchName: Migration = {
  version: "308_agent_task_branch_name",
  up: (db) => {
    db.exec(`ALTER TABLE agent_task_queue ADD COLUMN branch_name TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN branch_name;`);
  },
};

export const migration499AgentTaskIssueSnapshot: Migration = {
  version: "499_agent_task_issue_snapshot",
  up: (db) => {
    db.exec(`ALTER TABLE agent_task_queue ADD COLUMN issue_snapshot TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN issue_snapshot;`);
  },
};

export const migration352AutopilotQuotaExecution: Migration = {
  version: "352_autopilot_quota_execution",
  up: (db) => {
    // The quota circle is cut; the run columns port for shape parity.
    db.exec(`ALTER TABLE autopilot_run ADD COLUMN quota_reservation_id TEXT;`);
    db.exec(`ALTER TABLE autopilot_run ADD COLUMN reason_code TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE autopilot_run DROP COLUMN reason_code;`);
    db.exec(`ALTER TABLE autopilot_run DROP COLUMN quota_reservation_id;`);
  },
};

export const migration376AgentTaskDurableWorkDir: Migration = {
  version: "376_agent_task_durable_work_dir",
  up: (db) => {
    db.exec(`ALTER TABLE agent_task_queue ADD COLUMN durable_work_dir TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN durable_work_dir;`);
  },
};

export const migration377ChannelChatContextGeneration: Migration = {
  version: "377_channel_chat_context_generation",
  up: (db) => {
    db.exec(`ALTER TABLE agent_task_queue ADD COLUMN channel_context_revision TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN channel_context_revision;`);
  },
};

export const migration449AutopilotTriggerCreatedBy: Migration = {
  version: "449_autopilot_trigger_created_by",
  up: (db) => {
    db.exec(`ALTER TABLE autopilot_trigger ADD COLUMN created_by_type TEXT;`);
    db.exec(`ALTER TABLE autopilot_trigger ADD COLUMN created_by_id TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE autopilot_trigger DROP COLUMN created_by_id;`);
    db.exec(`ALTER TABLE autopilot_trigger DROP COLUMN created_by_type;`);
  },
};

export const migration451AgentTaskCommentThread: Migration = {
  version: "451_agent_task_comment_thread",
  up: (db) => {
    db.exec(`ALTER TABLE agent_task_queue ADD COLUMN comment_thread_id TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN comment_thread_id;`);
  },
};

export const migration458AgentTaskCancellationActor: Migration = {
  version: "458_agent_task_cancellation_actor",
  up: (db) => {
    db.exec(`ALTER TABLE agent_task_queue ADD COLUMN cancelled_by_type TEXT;`);
    db.exec(`ALTER TABLE agent_task_queue ADD COLUMN cancelled_by_id TEXT;`);
    db.exec(`ALTER TABLE agent_task_queue ADD COLUMN cancelled_by_name TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN cancelled_by_name;`);
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN cancelled_by_id;`);
    db.exec(`ALTER TABLE agent_task_queue DROP COLUMN cancelled_by_type;`);
  },
};

export const migration471CommentDeletedAt: Migration = {
  version: "471_comment_deleted_at",
  up: (db) => {
    db.exec(`ALTER TABLE comment ADD COLUMN deleted_at TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE comment DROP COLUMN deleted_at;`);
  },
};

export const migration531WakeupActorFilter: Migration = {
  version: "531_wakeup_actor_filter",
  up: (db) => {
    db.exec(`ALTER TABLE issue_wakeup ADD COLUMN filter_actor_type TEXT;`);
    db.exec(`ALTER TABLE issue_wakeup ADD COLUMN filter_actor_id TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE issue_wakeup DROP COLUMN filter_actor_id;`);
    db.exec(`ALTER TABLE issue_wakeup DROP COLUMN filter_actor_type;`);
  },
};

/**
 * Repair for databases that applied the pre-rebuild 033 (ADD COLUMN only):
 * their agent_task_queue.issue_id is still NOT NULL, which run_only
 * autopilot tasks and the source's chat tasks both need nullable (033's
 * other half). Fresh databases already carry the relaxed shape, so this is
 * a conditional no-op there.
 */
export const migration551QueueIssueNullableRepair: Migration = {
  version: "551_queue_issue_nullable_repair",
  up: (db) => {
    const columns = db.prepare("PRAGMA table_info(agent_task_queue)").all() as Array<{
      name: string;
      notnull: number;
    }>;
    const issueColumn = columns.find((entry) => entry.name === "issue_id");
    if (!issueColumn || issueColumn.notnull === 0) {
      // Fresh databases already carry 033's relaxed shape.
      return;
    }
    // Constraint-only change: rebuild from the table's own current DDL with
    // the NOT NULL relaxed, carrying every column in its current order and
    // re-creating the table's own indexes. A hand-written column list here
    // is exactly how a repair drops the columns added after it.
    const shape = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_task_queue'")
      .get() as { sql: string };
    const relaxed = shape.sql.replace(
      "issue_id TEXT NOT NULL REFERENCES issue(id) ON DELETE CASCADE",
      "issue_id TEXT REFERENCES issue(id) ON DELETE CASCADE",
    );
    if (relaxed === shape.sql) {
      return;
    }
    const indexes = (
      db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'agent_task_queue' AND sql IS NOT NULL",
        )
        .all() as Array<{ sql: string }>
    ).map((row) => row.sql);
    rebuildTableWithFksOff(db, {
      table: "agent_task_queue",
      ddl: relaxed,
      carry: columns.map((entry) => entry.name),
      indexes,
    });
  },
  down: () => undefined,
};
