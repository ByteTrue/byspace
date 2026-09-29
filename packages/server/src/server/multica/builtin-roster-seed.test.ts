/**
 * The roster seed is a boot-time act with a persistence contract: nine
 * built-in teammates (eight roles plus the secretary, seeded separately)
 * appear exactly once, carry their voice and their skills, and survive
 * every restart because the key, not the name, identifies them.
 */
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MIGRATIONS } from "./migrations/index.js";
import { MulticaStore } from "./store.js";
import { seedBuiltinRoster } from "./builtin-roster-seed.js";
import { listBuiltinRoles } from "./builtin-roles.js";

let store: MulticaStore;

beforeEach(() => {
  store = new MulticaStore(new DatabaseSync(":memory:"), { migrations: MIGRATIONS });
});

afterEach(() => {
  store.close();
});

describe("builtin roster seed", () => {
  it("seeds every role once, with voice and skills linked", () => {
    const seeded = seedBuiltinRoster(store);
    expect(seeded).toBe(listBuiltinRoles().length);
    for (const role of listBuiltinRoles()) {
      const row = store.findAgentBySystemKey(role.key);
      expect(row).not.toBeNull();
      expect(row?.instructions).toContain(role.identity.slice(0, 40));
      const bundles = store.listSkillBundlesForAgent((row as { id: string }).id);
      expect(bundles.length).toBe(role.skills.length);
    }
  });

  it("a second seed creates nothing — the key, not the name, is identity", () => {
    seedBuiltinRoster(store);
    const front = store.findAgentBySystemKey("frontend-developer");
    store.updateAgentInstructions((front as { id: string }).id, "renamed by the console");
    expect(seedBuiltinRoster(store)).toBe(0);
    expect(store.findAgentBySystemKey("frontend-developer")?.instructions).toBe(
      "renamed by the console",
    );
  });
});
