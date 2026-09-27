/**
 * The final column snapshot of every replica table, after the whole sequence.
 *
 * This is the systematic defense against the rebuild-carry class of bug: a
 * rebuild that forgets a column silently drops it and its data, and the
 * chain-position tests only catch it when they happen to assert that column.
 * The snapshot catches every one of them at once — if a migration adds a
 * column, the snapshot must grow with it, and a forgotten carry fails here.
 *
 * Column sets are copied from the source's final state (migrations through
 * 549), translated: PG-only columns (workspace_id, chat linkage) excluded
 * per the cut list.
 */
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MIGRATIONS } from "./index.js";
import { applyMigrations } from "./runner.js";

let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  applyMigrations(db, MIGRATIONS);
});

afterEach(() => {
  db.close();
});

function columns(table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (row) => row.name,
  );
}

describe("final schema snapshot", () => {
  it("agent", () => {
    // The 046/060 rebuilds re-seat the base columns, then ALTER ADD appends
    // the rest in migration order.
    expect(columns("agent")).toEqual([
      "id",
      "name",
      "avatar_url",
      "runtime_mode",
      "runtime_config",
      "visibility",
      "status",
      "max_concurrent_tasks",
      "description",
      "skills",
      "custom_env",
      "custom_args",
      "model",
      "created_at",
      "updated_at",
      "composio_toolkit_allowlist",
      "permission_mode",
      "kind",
      "system_key",
      "disabled_runtime_skills",
      "service_tier",
    ]);
  });

  it("issue", () => {
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
      "number",
      "project_id",
      "origin_type",
      "first_executed_at",
      "stage",
      "start_date",
      "metadata",
      "created_at",
      "updated_at",
      "revision",
      "last_activity_at",
      "triage_state",
      "duplicate_of_issue_id",
    ]);
  });

  it("comment", () => {
    expect(columns("comment")).toEqual([
      "id",
      "issue_id",
      "author_type",
      "author_id",
      "content",
      "type",
      "parent_id",
      "resolved_at",
      "resolved_by_type",
      "resolved_by_id",
      "created_at",
      "updated_at",
      "source_task_id",
      "quick_action_id",
      "via_plugin_id",
      "revision",
      "recovery_settled_at",
      "suppressed_agent_ids",
    ]);
  });

  it("agent_task_queue", () => {
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
      "autopilot_run_id",
      "attempt",
      "max_attempts",
      "parent_task_id",
      "failure_reason",
      "last_heartbeat_at",
      "trigger_summary",
      "force_fresh_session",
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
      "session_rollout_missing",
      "retired_session_id",
      "quick_actions_disabled",
    ]);
  });

  it("squad and squad_member", () => {
    expect(columns("squad")).toEqual([
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
      "instructions",
    ]);
    expect(columns("squad_member")).toEqual([
      "id",
      "squad_id",
      "member_type",
      "member_id",
      "role",
      "created_at",
    ]);
  });

  it("autopilot, trigger, run", () => {
    expect(columns("autopilot")).toEqual([
      "id",
      "title",
      "description",
      "assignee_type",
      "assignee_id",
      "status",
      "execution_mode",
      "issue_title_template",
      "concurrency_policy",
      "created_by_type",
      "created_by_id",
      "last_run_at",
      "created_at",
      "updated_at",
    ]);
    expect(columns("autopilot_trigger")).toEqual([
      "id",
      "autopilot_id",
      "kind",
      "enabled",
      "cron_expression",
      "timezone",
      "next_run_at",
      "webhook_token",
      "label",
      "last_fired_at",
      "created_at",
      "updated_at",
      "published_by_type",
      "published_by_id",
    ]);
    expect(columns("autopilot_run")).toEqual([
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
      "squad_id",
      "planned_at",
    ]);
  });

  it("issue_wakeup and receipt", () => {
    expect(columns("issue_wakeup")).toEqual([
      "id",
      "issue_id",
      "agent_id",
      "created_by",
      "source_task_id",
      "parent_comment_id",
      "instruction",
      "kind",
      "mode",
      "event_types",
      "filter_agent_id",
      "filter_task_id",
      "interval_seconds",
      "cron_expression",
      "timezone",
      "next_fire_at",
      "enabled",
      "disabled_at",
      "revision",
      "last_task_id",
      "last_error",
      "created_at",
      "updated_at",
    ]);
    expect(columns("issue_wakeup_receipt")).toEqual([
      "id",
      "wakeup_id",
      "revision",
      "event_key",
      "event_type",
      "payload",
      "task_id",
      "processed_at",
      "created_at",
    ]);
  });

  it("issue_status and inbox_item", () => {
    expect(columns("issue_status")).toEqual([
      "id",
      "key",
      "name",
      "description",
      "category",
      "color",
      "is_system",
      "position",
      "archived_at",
      "created_at",
      "updated_at",
      "icon",
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
      "actor_type",
      "actor_id",
    ]);
  });

  it("the supporting tables", () => {
    expect(columns("skill")).toContain("name");
    expect(columns("project")).toEqual([
      "id",
      "title",
      "description",
      "icon",
      "status",
      "lead_type",
      "lead_id",
      "created_at",
      "updated_at",
      "start_date",
      "due_date",
    ]);
    expect(columns("task_supplement")).toEqual([
      "task_id",
      "issue_id",
      "comment_id",
      "author_id",
      "client_request_id",
      "status",
      "failure_reason",
      "attempt_count",
      "created_at",
      "updated_at",
      "delivered_at",
    ]);
    expect(columns("issue_subscriber")).toEqual([
      "issue_id",
      "user_type",
      "user_id",
      "reason",
      "created_at",
      "unsubscribed_at",
    ]);
  });
});
