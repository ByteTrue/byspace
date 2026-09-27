/**
 * The agent-side residual migrations found by reading the source's generated
 * query layer (models.go's Agent struct) against the replica's snapshot.
 *
 * This is the second application of "the queries are the ground truth": the
 * full-column audit greped ADD COLUMN lines and missed agent's instructions,
 * mcp_config, thinking_level, archive pair, conversation starters (added as
 * starter_prompts in 404, renamed by 432), and runtime_id (060 adds it to
 * agent alongside the chat linkage we cut). The generated Agent struct lists
 * what the code actually reads, and that list is the contract.
 *
 * archived_by keeps no FK here: its PG target is "user", which the cut
 * removed; the column survives as plain TEXT so the audit trail it names
 * stays representable, with integrity at the application layer.
 */
import type { Migration } from "./runner.js";

export const migration021AgentInstructions: Migration = {
  version: "021_agent_instructions",
  up: (db) => {
    db.exec(`ALTER TABLE agent ADD COLUMN instructions TEXT NOT NULL DEFAULT '';`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent DROP COLUMN instructions;`);
  },
};

export const migration031AgentArchive: Migration = {
  version: "031_agent_archive",
  up: (db) => {
    db.exec(`ALTER TABLE agent ADD COLUMN archived_at TEXT;`);
    db.exec(`ALTER TABLE agent ADD COLUMN archived_by TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent DROP COLUMN archived_by;`);
    db.exec(`ALTER TABLE agent DROP COLUMN archived_at;`);
  },
};

export const migration046AgentMcpConfig: Migration = {
  version: "046_agent_mcp_config",
  up: (db) => {
    db.exec(`ALTER TABLE agent ADD COLUMN mcp_config TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent DROP COLUMN mcp_config;`);
  },
};

export const migration060ChatSessionRuntimeId: Migration = {
  version: "060_chat_session_runtime_id",
  up: (db) => {
    // The source adds this to chat_session and agent; chat is cut, agent
    // keeps the runtime linkage the queries read.
    db.exec(
      `ALTER TABLE agent ADD COLUMN runtime_id TEXT REFERENCES agent_runtime(id) ON DELETE SET NULL;`,
    );
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent DROP COLUMN runtime_id;`);
  },
};

export const migration095AgentThinkingLevel: Migration = {
  version: "095_agent_thinking_level",
  up: (db) => {
    db.exec(`ALTER TABLE agent ADD COLUMN thinking_level TEXT;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent DROP COLUMN thinking_level;`);
  },
};

export const migration404AgentStarterPrompts: Migration = {
  version: "404_agent_starter_prompts",
  up: (db) => {
    // JSONB array, at most three starters; the CHECK is the store layer's
    // validation under translation (SQLite CHECKs have no JSON operators).
    db.exec(`ALTER TABLE agent ADD COLUMN starter_prompts TEXT NOT NULL DEFAULT '[]';`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent DROP COLUMN starter_prompts;`);
  },
};

export const migration432AgentConversationStartersRename: Migration = {
  version: "432_agent_conversation_starters_rename",
  up: (db) => {
    db.exec(`ALTER TABLE agent RENAME COLUMN starter_prompts TO conversation_starters;`);
  },
  down: (db) => {
    db.exec(`ALTER TABLE agent RENAME COLUMN conversation_starters TO starter_prompts;`);
  },
};
