/**
 * Opening the replica's database: directory creation and WAL pragma.
 *
 * Separate from the store so bootstrap holds one call and the store stays
 * testable against in-memory databases without file concerns.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { DatabaseSync } from "node:sqlite";

export function openMulticaDatabase(filePath: string): DatabaseSync {
  mkdirSync(path.dirname(filePath), { recursive: true });
  return new DatabaseSync(filePath);
}
