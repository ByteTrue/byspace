/**
 * Migration 514 (SQLite translation of multica 514_wakeup_receipt_key).
 *
 * The receipt's idempotency guarantee: one (wakeup, revision, event_key)
 * triple is captured once, forever. The capture path inserts with
 * ON CONFLICT DO NOTHING, which needs this unique index to be a guarantee
 * and not a hope. 510/513 (id uniqueness on both wakeup tables) are
 * SQLite's TEXT PRIMARY KEY already and need no translation.
 */
import type { Migration } from "./runner.js";

export const migration514WakeupReceiptKey: Migration = {
  version: "514_wakeup_receipt_key",
  up: (db) => {
    db.exec(`
      CREATE UNIQUE INDEX idx_issue_wakeup_receipt_key
        ON issue_wakeup_receipt(wakeup_id, revision, event_key);
    `);
  },
  down: (db) => {
    db.exec(`DROP INDEX IF EXISTS idx_issue_wakeup_receipt_key;`);
  },
};
