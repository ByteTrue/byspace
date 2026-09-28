/**
 * Sequence tests for the ported migrations 002–042.
 *
 * Two contracts: the whole sequence applies cleanly onto 001 (the state a
 * fresh database reaches), every ported migration lands the source's shape
 * (columns, constraints), and the sequence stays strictly in multica's order.
 */
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MIGRATIONS } from "./index.js";
import { applyMigrations, appliedVersions } from "./runner.js";

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

describe("migration sequence 002–042", () => {
  it("applies the whole sequence in multica's order", () => {
    applyMigrations(db, MIGRATIONS);
    // Lexical order by version, exactly the source's rule. Gaps are cut
    // migrations, and a test in the registry keeps that deliberate.
    const versions = appliedVersions(db);
    const expected = [
      "001_init",
      "002_agent_config",
      "003_task_context",
      "004_agent_runtime_loop",
      "008_structured_skills",
      "012_inbox_actor",
      "015_issue_subscriber",
      "017_comment_parent_id",
      "018_comment_parent_cascade",
      "019_inbox_details",
      "020_issue_number",
      "020_task_session",
      "021_agent_instructions",
      "026_comment_reactions",
      "027_issue_reactions",
      "028_task_trigger_comment",
      "029_attachment",
      "031_agent_archive",
      "032_drop_agent_triggers",
      "033_chat",
      "034_projects",
      "040_agent_custom_env",
      "041_agent_custom_args",
      "042_autopilot",
      "046_agent_mcp_config",
      "046_agent_unique_name",
      "050_agent_model",
      "050_issue_first_executed_at",
      "055_task_lease_and_retry",
      "058_drop_autopilot_priority_and_project_id",
      "059_label_timestamps",
      "060_agent_description_length",
      "060_chat_session_runtime_id",
      "060_issue_origin_quick_create",
      "061_task_trigger_summary",
      "066_force_fresh_session",
      "069_comment_resolved_at",
      "079_autopilot_run_skipped_status",
      "084_squad",
      "085_squad_archive",
      "086_squad_avatar",
      "087_squad_name_not_unique",
      "088_squad_instructions",
      "090_task_is_leader",
      "091_issue_start_date",
      "093_webhook_deliveries",
      "095_agent_thinking_level",
      "096_autopilot_squad_assignee",
      "105_issue_metadata",
      "109_agent_task_waiting_local_directory",
      "110_autopilot_trigger_event_filters",
      "117_agent_task_queue_initiator_user_id",
      "120_autopilot_subscriber",
      "122_task_handoff_note",
      "123_issue_stage",
      "124_autopilot_run_planned_at",
      "124_task_prepare_lease",
      "127_task_squad_id",
      "128_agent_task_queue_runtime_mcp_overlay",
      "128_comment_routing_escalation",
      "129_agent_composio_allowlist_and_task_originator",
      "130_agent_invocation_permission",
      "132_agent_task_queue_runtime_connected_apps",
      "149_issue_origin_agent_create",
      "150_agent_task_coalesced_comments",
      "157_agent_task_delivered_comments",
      "158_agent_task_queue_chat_input_task_id",
      "162_resource_labels",
      "163_agent_builder",
      "164_attachment_task_id",
      "166_project_dates",
      "176_webhook_delivery_worker",
      "180_task_chat_finalize_deferred",
      "184_agent_task_attribution",
      "185_agent_task_accountable_user",
      "186_autopilot_rule_version",
      "189_autopilot_trigger_publisher",
      "190_agent_task_attribution_invariant_check",
      "191_issue_properties",
      "206_agent_disabled_runtime_skills",
      "212_agent_service_tier",
      "224_agent_task_session_rollout_missing",
      "234_agent_task_queue_retired_session_id",
      "236_agent_task_quick_actions_disabled",
      "239_comment_quick_action",
      "240_agent_task_regenerate_quick_actions",
      "249_issue_subscriber_delegated",
      "251_agent_runtime_unbind",
      "308_agent_task_branch_name",
      "332_issue_status",
      "333_issue_status_pkey_index",
      "334_issue_status_primary_key",
      "335_issue_status_workspace_key_index",
      "336_issue_status_workspace_name_index",
      "337_issue_status_open_check",
      "338_issue_status_validate_format",
      "339_seed_issue_status_catalog",
      "348_plugin_via_attribution",
      "351_issue_comment_revision",
      "352_autopilot_quota_execution",
      "360_issue_last_activity_at",
      "376_agent_task_durable_work_dir",
      "377_channel_chat_context_generation",
      "404_agent_starter_prompts",
      "432_agent_conversation_starters_rename",
      "444_comment_recovery_settled_at",
      "449_autopilot_trigger_created_by",
      "451_agent_task_comment_thread",
      "458_agent_task_cancellation_actor",
      "470_issue_status_icon",
      "471_comment_deleted_at",
      "483_issue_triage_state",
      "490_drop_triage_status_key_reservation",
      "499_agent_task_issue_snapshot",
      "509_issue_wakeup",
      "514_wakeup_receipt_key",
      "531_wakeup_actor_filter",
      "536_issue_duplicate_of",
      "537_issue_duplicate_of_index",
      "538_task_supplement",
      "550_comment_suppressed_agents",
    ];
    expect(versions).toEqual(expected);
  });

  it("002+032 leave agent with description, without tools/triggers or skills", () => {
    applyMigrations(db, MIGRATIONS);
    expect(columns("agent")).toContain("description");
    // 008 replaces the inline skills column with the structured-skill tables;
    // 032 drops tools and triggers.
    expect(columns("agent")).not.toContain("skills");
    expect(columns("agent")).not.toContain("tools");
    expect(columns("agent")).not.toContain("triggers");
  });

  it("041 adds custom_args to agent", () => {
    applyMigrations(db, MIGRATIONS);
    expect(columns("agent")).toContain("custom_args");
  });

  it("004 creates the agent_runtime table", () => {
    applyMigrations(db, MIGRATIONS);
    expect(columns("agent_runtime")).toEqual([
      "id",
      "agent_id",
      "runtime_data",
      "last_seen_at",
      "created_at",
      "updated_at",
    ]);
  });

  it("008 creates the skill trio", () => {
    applyMigrations(db, MIGRATIONS);
    expect(columns("skill")).toContain("name");
    expect(columns("skill_file")).toContain("path");
    expect(columns("agent_skill")).toEqual(["agent_id", "skill_id", "created_at"]);
  });

  it("017+018 leave comment.parent_id cascading", () => {
    applyMigrations(db, MIGRATIONS);
    expect(columns("comment")).toContain("parent_id");
    // A parent comment's deletion takes its reply, per 018's final state.
    db.exec(
      "INSERT INTO issue (id, title, creator_type, creator_id) VALUES ('i1','t','owner','x')",
    );
    db.exec(
      "INSERT INTO comment (id, issue_id, author_type, author_id, content) VALUES ('c1','i1','agent','a','root')",
    );
    db.exec(
      "INSERT INTO comment (id, issue_id, author_type, author_id, content, parent_id) VALUES ('c2','i1','agent','a','reply','c1')",
    );
    db.exec("DELETE FROM comment WHERE id = 'c1'");
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM comment WHERE id = 'c2'").get() as { n: number }).n,
    ).toBe(0);
  });

  it("020 gives issues a unique number from the sequence table", () => {
    applyMigrations(db, MIGRATIONS);
    expect(columns("issue")).toContain("number");
    db.exec(
      "INSERT INTO issue (id, title, creator_type, creator_id, number) VALUES ('i1','t','owner','x',1)",
    );
    expect(() =>
      db.exec(
        "INSERT INTO issue (id, title, creator_type, creator_id, number) VALUES ('i2','t','owner','x',1)",
      ),
    ).toThrow(/UNIQUE/);
  });

  it("034 creates project and links issues to it", () => {
    applyMigrations(db, MIGRATIONS);
    expect(columns("project")).toContain("lead_type");
    expect(columns("issue")).toContain("project_id");
  });

  it("042 creates the autopilot trio and links queue and issue", () => {
    applyMigrations(db, MIGRATIONS);
    expect(columns("autopilot")).toContain("execution_mode");
    expect(columns("autopilot_trigger")).toContain("cron_expression");
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
      // ALTER TABLE ADD appends: 096/124/176/352 land at the tail.
      "squad_id",
      "planned_at",
      "webhook_delivery_id",
      "quota_reservation_id",
      "reason_code",
    ]);
    expect(columns("agent_task_queue")).toContain("autopilot_run_id");
    expect(columns("issue")).toContain("origin_type");
  });

  it("inserts across the final schema satisfy every foreign key", () => {
    applyMigrations(db, MIGRATIONS);
    db.exec("INSERT INTO agent (id, name, runtime_mode) VALUES ('a1','A','local')");
    db.exec(
      "INSERT INTO issue (id, title, creator_type, creator_id, number) VALUES ('i1','t','owner','x',1)",
    );
    db.exec("INSERT INTO project (id, title) VALUES ('p1','P')");
    db.exec("UPDATE issue SET project_id = 'p1' WHERE id = 'i1'");
    db.exec(
      "INSERT INTO autopilot (id, title, assignee_type, assignee_id, created_by_type, created_by_id) VALUES ('ap1','AP','agent','a1','owner','x')",
    );
    db.exec(
      "INSERT INTO autopilot_trigger (id, autopilot_id, kind, cron_expression) VALUES ('tr1','ap1','schedule','*/5 * * * *')",
    );
    db.exec("INSERT INTO agent_task_queue (id, agent_id, issue_id) VALUES ('q1','a1','i1')");
    db.exec(
      "INSERT INTO autopilot_run (id, autopilot_id, trigger_id, source) VALUES ('r1','ap1','tr1','schedule')",
    );
    db.exec("UPDATE agent_task_queue SET autopilot_run_id = 'r1' WHERE id = 'q1'");
    db.exec("INSERT INTO skill (id, name, source_type) VALUES ('s1','deploy','builtin')");
    db.exec(
      "INSERT INTO skill_file (id, skill_id, path, content) VALUES ('sf1','s1','SKILL.md','x')",
    );
    db.exec("INSERT INTO agent_skill (agent_id, skill_id) VALUES ('a1','s1')");
    db.exec(
      "INSERT INTO comment (id, issue_id, author_type, author_id, content) VALUES ('c1','i1','agent','a1','hello')",
    );
    db.exec(
      "INSERT INTO attachment (id, issue_id, comment_id, uploader_type, uploader_id, filename, url, content_type, size_bytes) VALUES ('at1','i1','c1','agent','a1','f.txt','http://x','text/plain',1)",
    );
    expect((db.prepare("PRAGMA foreign_key_check").all() as unknown[]).length).toBe(0);
  });
});
