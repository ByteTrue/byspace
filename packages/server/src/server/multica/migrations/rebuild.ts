/**
 * Portable column add/drop for SQLite: node:sqlite ships a modern engine
 * where ALTER TABLE DROP COLUMN works, but constraint changes and column
 * reordering still require the rebuild form — and the rebuild is also the
 * only portable shape across SQLite versions. One helper, used by every
 * migration that changes an existing table's shape.
 *
 * The rebuild copies shared columns and preserves rowid-less primary keys the
 * way SQLite documents: create the new table with the final shape, copy, drop,
 * rename, then re-create the indexes the caller passes.
 */
import type { DatabaseSync } from "node:sqlite";

export interface RebuildSpec {
  /** Table to rebuild. */
  table: string;
  /** Fresh DDL for the final shape — created under a temp name. */
  ddl: string;
  /** Columns to carry over, in the new table's order. */
  carry: readonly string[];
  /** Index DDL statements to re-create after the rename. */
  indexes?: readonly string[];
}

/**
 * Rebuild a table: create `table__rebuild` from `ddl`, carry the columns,
 * drop the original, rename, re-create indexes.
 *
 * Column-count mismatch between `ddl` and `carry` fails inside SQLite's own
 * INSERT (wrong number of values), which is the check we want: the failure
 * names the migration that lied about its shape.
 */
export function rebuildTable(db: DatabaseSync, spec: RebuildSpec): void {
  const temp = `${spec.table}__rebuild`;
  db.exec(`DROP TABLE IF EXISTS ${temp};`);
  // sqlite_master-sourced DDL carries quoted names; accept both forms.
  db.exec(
    spec.ddl
      .replace(`CREATE TABLE "${spec.table}" (`, `CREATE TABLE ${temp} (`)
      .replace(`CREATE TABLE ${spec.table} (`, `CREATE TABLE ${temp} (`),
  );
  db.exec(
    `INSERT INTO ${temp} (${spec.carry.join(", ")}) SELECT ${spec.carry.join(", ")} FROM ${spec.table};`,
  );
  db.exec(`DROP TABLE ${spec.table};`);
  db.exec(`ALTER TABLE ${temp} RENAME TO ${spec.table};`);
  for (const index of spec.indexes ?? []) {
    db.exec(index);
  }
}

/** Rebuild wrapper that turns SQLite's FKs off for the swap, per the docs. */
export function rebuildTableWithFksOff(db: DatabaseSync, spec: RebuildSpec): void {
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    rebuildTable(db, spec);
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}
