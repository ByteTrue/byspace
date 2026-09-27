/**
 * Tests for the secretary seed: idempotence and shape.
 */
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MIGRATIONS } from "./migrations/index.js";
import { MulticaStore } from "./store.js";
import { SECRETARY_SYSTEM_KEY, seedSecretary } from "./secretary.js";

let store: MulticaStore;

beforeEach(() => {
  store = new MulticaStore(new DatabaseSync(":memory:"), { migrations: MIGRATIONS });
});

afterEach(() => {
  store.close();
});

describe("seedSecretary", () => {
  it("seeds the system agent and its channel issue", () => {
    const seed = seedSecretary(store);
    const agent = store.getAgent(seed.agentId);
    expect(agent.kind).toBe("system");
    expect(agent.systemKey).toBe(SECRETARY_SYSTEM_KEY);
    expect(agent.instructions).toContain("goal, not a routing decision");
    const issue = store.getIssue(seed.channelIssueId);
    expect(issue.assigneeId).toBe(seed.agentId);
  });

  it("is idempotent: a second seed returns the same pair", () => {
    const first = seedSecretary(store);
    const second = seedSecretary(store);
    expect(second).toEqual(first);
    // One secretary in the agent list is invisible (system kind); the
    // channel issue exists exactly once.
    expect(store.listIssues({}).filter((i) => i.title.includes("Office"))).toHaveLength(1);
  });

  it("the secretary is hidden from the default agent list", () => {
    seedSecretary(store);
    store.createAgent({ name: "Worker" });
    const visible = store.listAgents();
    expect(visible).toHaveLength(1);
    expect(visible[0].name).toBe("Worker");
  });
});
