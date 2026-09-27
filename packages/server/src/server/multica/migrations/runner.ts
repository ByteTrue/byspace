/**
 * Migration runner for the multica-replica schema (SQLite).
 *
 * A 1:1 port of multica's migration mechanics (server/cmd/migrate + internal/
 * migrations): a `schema_migrations` version table, migrations applied in
 * lexical order, one transaction per migration, a failed migration aborting
 * the run before the version row is written so the next run retries it.
 *
 * Two departures, both dictated by the storage decision:
 * - SQLite instead of Postgres: each migration runs inside one IMMEDIATE
 *   transaction (SQLite has no advisory locks and single-writer is the
 *   concurrency model, so the transaction is both the unit and the lock).
 * - Migrations are TS modules rather than .sql files: the PG→SQLite
 *   translation is mechanical but not textual (uuid, timestamptz, jsonb),
 *   and keeping it as code lets each migration's comment contract travel
 *   with it and stay reviewable against the source file.
 */
import { DatabaseSync } from "node:sqlite";

export interface Migration {
  /** multica's version string, e.g. "001_init". */
  readonly version: string;
  /** Apply, inside the caller's transaction. */
  readonly up: (db: DatabaseSync) => void;
  /** Reverse, inside the caller's transaction. */
  readonly down?: (db: DatabaseSync) => void;
}

const VERSION_TABLE = "schema_migrations";

export function ensureVersionTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${VERSION_TABLE} (
      version    TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
}

export function appliedVersions(db: DatabaseSync): string[] {
  ensureVersionTable(db);
  const rows = db.prepare(`SELECT version FROM ${VERSION_TABLE}`).all() as Array<{
    version: string;
  }>;
  return rows.map((row) => row.version);
}

/**
 * Apply every migration newer than the recorded versions, in list order.
 *
 * Order is the caller's list, checked against multica's lexical rule by the
 * test suite — the runner itself stays dumb so the ordering contract lives in
 * exactly one place.
 *
 * A failing migration aborts the whole run (IMMEDIATE transaction rolled
 * back) without recording its version, so re-running retries exactly the
 * failed one. Partial application is impossible by construction.
 */
export function applyMigrations(db: DatabaseSync, migrations: readonly Migration[]): void {
  ensureVersionTable(db);
  const done = new Set(appliedVersions(db));

  for (const migration of migrations) {
    if (done.has(migration.version)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      migration.up(db);
      db.prepare(`INSERT INTO ${VERSION_TABLE} (version) VALUES (?)`).run(migration.version);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${migration.version} failed`, { cause: error });
    }
  }
}

/**
 * Roll back the most recent applied migration (multica's `migrate down 1`).
 *
 * Migrations without a `down` are refused rather than skipped: a down that
 * silently does nothing would leave the version row lying about the schema.
 */
export function revertLastMigration(db: DatabaseSync, migrations: readonly Migration[]): string {
  ensureVersionTable(db);
  const applied = appliedVersions(db);
  const last = applied[applied.length - 1];
  if (last === undefined) {
    throw new Error("nothing to revert");
  }
  const migration = migrations.find((candidate) => candidate.version === last);
  if (!migration?.down) {
    throw new Error(`migration ${last} has no down`);
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    migration.down(db);
    db.prepare(`DELETE FROM ${VERSION_TABLE} WHERE version = ?`).run(last);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw new Error(`revert of ${last} failed`, { cause: error });
  }
  return last;
}
