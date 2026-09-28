/**
 * Tests for the squad and run-queue store methods.
 *
 * Contracts from the source: the leader FK is RESTRICT (a squad without its
 * leader is not a state the schema allows), members are unique per squad and
 * purely a roster, a run enqueues queued with its stamps unset, and each
 * status transition stamps its own timestamp.
 */
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MIGRATIONS } from "./migrations/index.js";
import { MulticaStore } from "./store.js";

let store: MulticaStore;
let db: DatabaseSync;
let agentId: string;
let issueId: string;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  store = new MulticaStore(db, { migrations: MIGRATIONS });
  agentId = store.createAgent({ name: "Leader" }).id;
  issueId = store.createIssue({ title: "t", creatorType: "owner", creatorId: "owner" }).id;
});

afterEach(() => {
  store.close();
});

describe("squad store", () => {
  it("creates a squad with a leader and reads the roster", () => {
    const squad = store.createSquad({
      name: "Team",
      leaderId: agentId,
      creatorType: "owner",
      creatorId: "owner",
    });
    expect(store.getSquad(squad.id).name).toBe("Team");
    expect(store.listSquads()).toHaveLength(1);

    const worker = store.createAgent({ name: "Worker" });
    store.addSquadMember({ squadId: squad.id, memberType: "agent", memberId: worker.id });
    // The leader rides the roster from creation (the source's CreateSquad
    // auto-adds it with role "leader"), so the roster is leader + worker.
    const roster = store.listSquadMembers(squad.id);
    expect(roster).toHaveLength(2);
    // Source shape: the leader's row carries role "leader"; a plain member's
    // role is the schema's empty default (084), and the UI marks the leader
    // by comparing against squad.leader_id, not by role.
    expect(roster.map((entry) => entry.role).sort()).toEqual(["", "leader"]);
  });

  it("refuses deleting a squad's leader while the squad exists", () => {
    const squad = store.createSquad({
      name: "S",
      leaderId: agentId,
      creatorType: "owner",
      creatorId: "owner",
    });
    expect(() => db.exec(`DELETE FROM agent WHERE id = '${agentId}'`)).toThrow(/FOREIGN KEY/);
    // After the squad goes, the leader is deletable.
    db.exec(`DELETE FROM squad WHERE id = '${squad.id}'`);
    expect(() => db.exec(`DELETE FROM agent WHERE id = '${agentId}'`)).not.toThrow();
  });

  it("members are unique per squad and removable", () => {
    const squad = store.createSquad({
      name: "S",
      leaderId: agentId,
      creatorType: "owner",
      creatorId: "owner",
    });
    const worker = store.createAgent({ name: "W" });
    store.addSquadMember({ squadId: squad.id, memberType: "agent", memberId: worker.id });
    expect(() =>
      store.addSquadMember({ squadId: squad.id, memberType: "agent", memberId: worker.id }),
    ).toThrow(/UNIQUE/);
    store.removeSquadMember(squad.id, "agent", worker.id);
    // The leader remains: removing a plain member leaves the roster's
    // structural row in place.
    expect(store.listSquadMembers(squad.id)).toHaveLength(1);
    expect(() => store.removeSquadMember(squad.id, "agent", worker.id)).toThrow(/not found/);
  });
});

describe("run queue", () => {
  it("enqueues a run as queued with stamps unset", () => {
    const task = store.createTask({ agentId, issueId });
    expect(task.status).toBe("queued");
    expect(task.dispatchedAt).toBeNull();
    expect(task.startedAt).toBeNull();
    expect(task.isLeaderTask).toBe(false);
  });

  it("records leader tasks and their squad linkage", () => {
    const squad = store.createSquad({
      name: "S",
      leaderId: agentId,
      creatorType: "owner",
      creatorId: "owner",
    });
    const task = store.createTask({
      agentId,
      issueId,
      isLeaderTask: true,
      squadId: squad.id,
    });
    expect(task.isLeaderTask).toBe(true);
    expect(task.squadId).toBe(squad.id);
  });

  it("moves through the lifecycle stamping each state's timestamp", () => {
    const task = store.createTask({ agentId, issueId });
    const dispatched = store.updateTaskStatus({ id: task.id, status: "dispatched" });
    expect(dispatched.dispatchedAt).not.toBeNull();
    const running = store.updateTaskStatus({ id: task.id, status: "running" });
    expect(running.startedAt).not.toBeNull();
    const done = store.updateTaskStatus({ id: task.id, status: "completed" });
    expect(done.completedAt).not.toBeNull();

    const failed = store.createTask({ agentId, issueId });
    const failedRun = store.updateTaskStatus({
      id: failed.id,
      status: "failed",
      error: "boom",
    });
    expect(failedRun.error).toBe("boom");
    expect(failedRun.completedAt).not.toBeNull();
  });

  it("lists a run under its issue", () => {
    store.createTask({ agentId, issueId });
    expect(store.listTasksForIssue(issueId)).toHaveLength(1);
    expect(() => store.getTask("missing")).toThrow(/task not found/);
  });
});

describe("run identity: session stamp and reverse resolution", () => {
  it("a stamped session resolves back to its run", () => {
    const agent = store.createAgent({ name: "Writer" });
    const issue = store.createIssue({
      title: "Work",
      creatorType: "owner",
      creatorId: "owner",
    });
    const task = store.createTask({ issueId: issue.id, agentId: agent.id });
    expect(store.getTaskBySession("sess-1")).toBeNull();

    store.attachTaskSession(task.id, "sess-1");

    const found = store.getTaskBySession("sess-1");
    expect(found?.id).toBe(task.id);
    expect(found?.agentId).toBe(agent.id);
  });

  it("the stamp survives status moves (it is a fact, not a transition)", () => {
    const agent = store.createAgent({ name: "Writer" });
    const issue = store.createIssue({
      title: "Work",
      creatorType: "owner",
      creatorId: "owner",
    });
    const task = store.createTask({ issueId: issue.id, agentId: agent.id });
    store.attachTaskSession(task.id, "sess-2");
    store.updateTaskStatus({ id: task.id, status: "running" });
    expect(store.getTaskBySession("sess-2")?.status).toBe("running");
  });
});

describe("squad roster completeness", () => {
  it("creating a squad puts its leader on the roster with role leader", () => {
    const leader = store.createAgent({ name: "Lead" });
    const member = store.createAgent({ name: "Follower" });
    const squad = store.createSquad({
      name: "Crew",
      leaderId: leader.id,
      creatorType: "owner",
      creatorId: "owner",
    });
    store.addSquadMember({ squadId: squad.id, memberType: "agent", memberId: member.id });
    const roles = new Map(
      store.listSquadMembers(squad.id).map((entry) => [entry.memberId, entry.role]),
    );
    expect(roles.get(leader.id)).toBe("leader");
    expect(roles.get(member.id)).not.toBe("leader");
  });
});
