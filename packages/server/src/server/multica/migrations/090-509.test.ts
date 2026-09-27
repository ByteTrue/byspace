/**
 * Tests for the 090/096/127/509 batch: squad dispatch accounting and issue
 * wakeups.
 *
 * The contracts worth pinning: the leader-task marker and its squad linkage
 * (with the no-FK-on-purpose queue design), squad-as-leader autopilot
 * assignment, and the wakeup/receipt pair that makes event capture idempotent.
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

describe("squad dispatch accounting (090/096/127)", () => {
  it("marks leader tasks and links them to squads without an FK", () => {
    db.exec("INSERT INTO agent (id, name, runtime_mode) VALUES ('a1','A','local')");
    db.exec(
      "INSERT INTO issue (id, title, creator_type, creator_id, number) VALUES ('i1','t','owner','x',1)",
    );
    db.exec(
      "INSERT INTO agent_task_queue (id, agent_id, issue_id, is_leader_task, squad_id) VALUES ('q1','a1','i1',1,'s_gone')",
    );
    // squad_id 's_gone' does not exist — deliberately no FK on the hot queue.
    expect((db.prepare("PRAGMA foreign_key_check").all() as unknown[]).length).toBe(0);
    expect(
      (
        db.prepare("SELECT is_leader_task FROM agent_task_queue WHERE id = 'q1'").get() as {
          is_leader_task: number;
        }
      ).is_leader_task,
    ).toBe(1);
  });

  it("autopilot can be assigned to a squad, and runs carry the squad attribution", () => {
    db.exec("INSERT INTO agent (id, name, runtime_mode) VALUES ('a1','A','local')");
    db.exec(
      "INSERT INTO squad (id, name, leader_id, creator_type, creator_id) VALUES ('sq1','S','a1','owner','x')",
    );
    db.exec(
      "INSERT INTO autopilot (id, title, assignee_type, assignee_id, created_by_type, created_by_id) VALUES ('ap1','AP','squad','sq1','owner','x')",
    );
    db.exec(
      "INSERT INTO autopilot_trigger (id, autopilot_id, kind, cron_expression) VALUES ('tr1','ap1','schedule','*/5 * * * *')",
    );
    db.exec(
      "INSERT INTO autopilot_run (id, autopilot_id, trigger_id, source, squad_id) VALUES ('r1','ap1','tr1','schedule','sq1')",
    );
    expect(
      (
        db.prepare("SELECT squad_id FROM autopilot_run WHERE id = 'r1'").get() as {
          squad_id: string;
        }
      ).squad_id,
    ).toBe("sq1");
  });
});

describe("issue wakeups (509)", () => {
  it("creates a wakeup subscription of every kind and its receipt", () => {
    db.exec("INSERT INTO agent (id, name, runtime_mode) VALUES ('a1','A','local')");
    db.exec(
      "INSERT INTO issue (id, title, creator_type, creator_id, number) VALUES ('i1','t','owner','x',1)",
    );
    db.exec(
      `INSERT INTO issue_wakeup (id, issue_id, agent_id, created_by, instruction, kind, mode, event_types)
       VALUES ('w1','i1','a1','a1','check and report','event','once','["task.completed","task.failed"]')`,
    );
    db.exec(`
      INSERT INTO issue_wakeup_receipt (id, wakeup_id, revision, event_key, event_type, payload)
      VALUES ('rc1','w1',1,'task.completed:i1:q1','task.completed','{"task_id":"q1"}')`);
    expect(
      db.prepare("SELECT kind, mode, enabled FROM issue_wakeup WHERE id = 'w1'").get() as {
        kind: string;
        mode: string;
        enabled: number;
      },
    ).toEqual({ kind: "event", mode: "once", enabled: 1 });
    expect(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM issue_wakeup_receipt WHERE wakeup_id = 'w1' AND event_key = 'task.completed:i1:q1'",
          )
          .get() as { n: number }
      ).n,
    ).toBe(1);
  });

  it("constrains wakeup kind and mode to the source's enums", () => {
    db.exec("INSERT INTO agent (id, name, runtime_mode) VALUES ('a1','A','local')");
    db.exec(
      "INSERT INTO issue (id, title, creator_type, creator_id, number) VALUES ('i1','t','owner','x',1)",
    );
    const insert = (kind: string, mode: string) =>
      db.exec(
        `INSERT INTO issue_wakeup (id, issue_id, agent_id, created_by, instruction, kind, mode) VALUES ('w2','i1','a1','a1','x','${kind}','${mode}')`,
      );
    expect(() => insert("event", "once")).not.toThrow();
    expect(() => insert("webhook", "once")).toThrow(/CHECK constraint/);
    expect(() => insert("at", "weekly")).toThrow(/CHECK constraint/);
  });

  it("a wakeup dies with its issue (cascade)", () => {
    db.exec("INSERT INTO agent (id, name, runtime_mode) VALUES ('a1','A','local')");
    db.exec(
      "INSERT INTO issue (id, title, creator_type, creator_id, number) VALUES ('i1','t','owner','x',1)",
    );
    db.exec(
      "INSERT INTO issue_wakeup (id, issue_id, agent_id, created_by, instruction, kind, mode) VALUES ('w1','i1','a1','a1','x','event','once')",
    );
    db.exec("DELETE FROM issue WHERE id = 'i1'");
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM issue_wakeup WHERE id = 'w1'").get() as { n: number })
        .n,
    ).toBe(0);
  });
});
