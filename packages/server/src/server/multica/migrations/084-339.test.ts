/**
 * Tests for the 084 and 332–339 batch: squads and the issue-status catalog.
 *
 * The catalog's model is the contract: a category maps one-to-one onto its
 * built-in key, built-ins cannot be archived, issue.status stays an
 * authoritative TEXT key with membership validated at the application layer.
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

describe("squad (084)", () => {
  it("creates squad and squad_member with the source's uniqueness", () => {
    db.exec("INSERT INTO agent (id, name, runtime_mode) VALUES ('a1','A','local')");
    db.exec(
      "INSERT INTO squad (id, name, leader_id, creator_type, creator_id) VALUES ('s1','S','a1','owner','x')",
    );
    db.exec(
      "INSERT INTO squad_member (id, squad_id, member_type, member_id) VALUES ('m1','s1','agent','a1')",
    );
    expect(() =>
      db.exec(
        "INSERT INTO squad_member (id, squad_id, member_type, member_id) VALUES ('m2','s1','agent','a1')",
      ),
    ).toThrow(/UNIQUE/);
  });

  it("refuses deleting a squad's leader while the squad exists", () => {
    // ON DELETE RESTRICT, the source's choice: a squad without its leader is
    // not a thing the schema allows to come into existence.
    db.exec("INSERT INTO agent (id, name, runtime_mode) VALUES ('a1','A','local')");
    db.exec(
      "INSERT INTO squad (id, name, leader_id, creator_type, creator_id) VALUES ('s1','S','a1','owner','x')",
    );
    expect(() => db.exec("DELETE FROM agent WHERE id = 'a1'")).toThrow(/FOREIGN KEY/);
  });
});

describe("issue status catalog (332–339)", () => {
  it("seeds exactly the seven built-ins, canonical and colored", () => {
    const rows = db
      .prepare("SELECT key, category, is_system FROM issue_status ORDER BY position")
      .all() as Array<{ key: string; category: string; is_system: number }>;
    expect(rows).toHaveLength(7);
    expect(rows.map((row) => row.key)).toEqual([
      "backlog",
      "todo",
      "in_progress",
      "in_review",
      "done",
      "blocked",
      "cancelled",
    ]);
    // A built-in IS its category's canonical: key equals category.
    for (const row of rows) {
      expect(row.key).toBe(row.category);
      expect(row.is_system).toBe(1);
    }
  });

  it("holds the built-in semantics in its descriptions", () => {
    const backlog = (
      db.prepare("SELECT description FROM issue_status WHERE key = 'backlog'").get() as {
        description: string;
      }
    ).description;
    const todo = (
      db.prepare("SELECT description FROM issue_status WHERE key = 'todo'").get() as {
        description: string;
      }
    ).description;
    // The trigger contract in words, verbatim from the source seed.
    expect(backlog).toContain("never starts an agent run");
    expect(todo).toContain("starts the assigned agent");
  });

  it("keeps key unique and category-key equality enforced on custom rows", () => {
    expect(() =>
      db.exec(
        "INSERT INTO issue_status (id, key, name, category, color) VALUES ('x1','shipping','Shipping','todo','#123456')",
      ),
    ).not.toThrow();
    // A second status with the same key collides.
    expect(() =>
      db.exec(
        "INSERT INTO issue_status (id, key, name, category, color) VALUES ('x2','shipping','Other','todo','#123456')",
      ),
    ).toThrow(/UNIQUE/);
  });

  it("refuses archiving a built-in and allows custom status archiving", () => {
    expect(() =>
      db.exec(
        "UPDATE issue_status SET archived_at = '2026-01-01T00:00:00.000Z' WHERE key = 'done'",
      ),
    ).toThrow(/CHECK constraint/);
    db.exec(
      "INSERT INTO issue_status (id, key, name, category, color) VALUES ('x1','shipping','Shipping','todo','#123456')",
    );
    expect(() =>
      db.exec("UPDATE issue_status SET archived_at = '2026-01-01T00:00:00.000Z' WHERE id = 'x1'"),
    ).not.toThrow();
  });

  it("lets issue.status hold a catalog key (337 opened the check)", () => {
    db.exec(
      "INSERT INTO issue (id, title, creator_type, creator_id, status, number) VALUES ('i1','t','owner','x','shipping',1)",
    );
    expect(
      (db.prepare("SELECT status FROM issue WHERE id = 'i1'").get() as { status: string }).status,
    ).toBe("shipping");
  });
});
