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
      "004_agent_runtime_loop",
      "008_structured_skills",
      "015_issue_subscriber",
      "017_comment_parent_id",
      "018_comment_parent_cascade",
      "020_issue_number",
      "026_comment_reactions",
      "027_issue_reactions",
      "029_attachment",
      "032_drop_agent_triggers",
      "034_projects",
      "041_agent_custom_args",
      "042_autopilot",
      "084_squad",
      "090_task_is_leader",
      "096_autopilot_squad_assignee",
      "127_task_squad_id",
      "332_issue_status",
      "333_issue_status_pkey_index",
      "334_issue_status_primary_key",
      "335_issue_status_workspace_key_index",
      "336_issue_status_workspace_name_index",
      "337_issue_status_open_check",
      "338_issue_status_validate_format",
      "339_seed_issue_status_catalog",
      "509_issue_wakeup",
    ];
    expect(versions).toEqual(expected);
  });

  it("002+032 leave agent with description and skills, without tools/triggers", () => {
    applyMigrations(db, MIGRATIONS);
    expect(columns("agent")).toContain("description");
    expect(columns("agent")).toContain("skills");
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
      // ALTER TABLE ADD appends: 096's squad_id lands at the tail.
      "squad_id",
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
