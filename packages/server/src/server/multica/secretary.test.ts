/**
 * Tests for the secretary seed: the system agent, its standing workspace,
 * tombstoning of the retired channel issue, and idempotence.
 */
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MIGRATIONS } from "./migrations/index.js";
import { SECRETARY_SYSTEM_KEY, SECRETARY_WORKSPACE_TITLE, seedSecretary } from "./secretary.js";
import { MulticaStore } from "./store.js";

let store: MulticaStore;
let provisioned: { cwd: string; title: string }[];

const provision = async (input: { cwd: string; title: string }) => {
  provisioned.push(input);
  return { cwd: input.cwd, workspaceId: `ws-${provisioned.length}` };
};

beforeEach(() => {
  store = new MulticaStore(new DatabaseSync(":memory:"), { migrations: MIGRATIONS });
  provisioned = [];
});

afterEach(() => {
  store.close();
});

describe("seedSecretary", () => {
  it("seeds the system agent and its standing workspace", async () => {
    const seed = await seedSecretary(store, provision, os.tmpdir());
    const agent = store.getAgent(seed.agentId);
    expect(agent.kind).toBe("system");
    expect(agent.systemKey).toBe(SECRETARY_SYSTEM_KEY);
    expect(agent.name).toBe(SECRETARY_WORKSPACE_TITLE);
    expect(agent.instructions).toContain("goal, not a routing decision");
    expect(seed.workspaceId).toBe("ws-1");
    expect(provisioned[0].title).toBe(SECRETARY_WORKSPACE_TITLE);
    // The workspace lives under the daemon home, not in a user checkout.
    expect(provisioned[0].cwd).toBe(path.join(os.tmpdir(), "multica", "secretary"));
  });

  it("the office is a workspace, not an issue", async () => {
    await seedSecretary(store, provision, os.tmpdir());
    expect(store.listIssues({})).toHaveLength(0);
  });

  it("tombstones a leftover channel issue instead of deleting it", async () => {
    const agent = store.createAgent({
      name: "Chief of Staff",
      kind: "system",
      systemKey: SECRETARY_SYSTEM_KEY,
    });
    const channel = store.createIssue({
      title: "Office — talk to your chief of staff",
      creatorType: "owner",
      creatorId: "owner",
      assigneeType: "agent",
      assigneeId: agent.id,
      status: "in_progress",
    });
    store.createComment({
      issueId: channel.id,
      authorType: "owner",
      authorId: "owner",
      content: "history worth keeping",
    });

    await seedSecretary(store, provision, os.tmpdir());

    const tombstoned = store.getIssue(channel.id);
    expect(tombstoned.title.startsWith("[retired]")).toBe(true);
    expect(tombstoned.status).toBe("cancelled");
    // The record survives: comments cascade-delete with their issue, so a
    // delete would have erased the conversation the channel once carried.
    expect(store.listCommentsForIssue(channel.id)).toHaveLength(1);
  });

  it("is idempotent: a second seed reuses the agent and provisions once more is harmless", async () => {
    const first = await seedSecretary(store, provision, os.tmpdir());
    const second = await seedSecretary(store, provision, os.tmpdir());
    expect(second.agentId).toBe(first.agentId);
    expect(store.listAgents({ includeSystem: true })).toHaveLength(1);
    expect(store.listIssues({})).toHaveLength(0);
  });

  it("the secretary is hidden from the default agent list", async () => {
    await seedSecretary(store, provision, os.tmpdir());
    store.createAgent({ name: "Worker" });
    const visible = store.listAgents();
    expect(visible).toHaveLength(1);
    expect(visible[0].name).toBe("Worker");
  });
});
