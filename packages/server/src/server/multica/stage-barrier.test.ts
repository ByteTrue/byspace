import { DatabaseSync } from "node:sqlite";
/**
 * The stage barrier (MUL-3508): a child's completion wakes the parent only
 * when it closes the lowest unfinished stage — the serial handoff gate for
 * staged decomposition. The matrix here pins the three load-bearing
 * behaviors: the frontier rule (a lower unfinished stage holds the barrier),
 * the implicit single stage for unstaged sets (wake once on the last child,
 * not on every child), and the parent guards (parked and closed parents
 * stay inert; human assignees get no noise).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MulticaStore } from "./store.js";
import { MIGRATIONS } from "./migrations/index.js";

let store: MulticaStore;

const seed = (title: string) =>
  store.createIssue({ title, creatorType: "owner", creatorId: "owner" });
const seedChild = (title: string, parentIssueId: string, stage?: number) =>
  store.createIssue({
    title,
    creatorType: "owner",
    creatorId: "owner",
    parentIssueId,
    stage,
  });

beforeEach(() => {
  store = new MulticaStore(new DatabaseSync(":memory:"), { migrations: MIGRATIONS });
});

afterEach(() => {
  store.close();
});

const systemCommentsOn = (issueId: string) => store.listSystemComments(issueId);

describe("stage barrier", () => {
  it("an unstaged set wakes once, when the last child finishes", () => {
    const parent = seed("Parent");
    const worker = store.createAgent({ name: "Worker" });
    store.updateIssue({
      id: parent.id,
      expectedRevision: store.getIssue(parent.id).revision,
      assigneeType: "agent",
      assigneeId: worker.id,
      status: "todo",
    });
    const a = seedChild("A", parent.id);
    const b = seedChild("B", parent.id);

    const aRow = store.getIssue(a.id);
    store.updateIssueStatus({ id: a.id, status: "done", expectedRevision: aRow.revision });
    expect(systemCommentsOn(parent.id)).toHaveLength(0);

    const bRow = store.getIssue(b.id);
    store.updateIssueStatus({ id: b.id, status: "done", expectedRevision: bRow.revision });
    expect(systemCommentsOn(parent.id)).toHaveLength(1);
  });

  it("a lower unfinished stage holds the barrier; its close wakes with the next stage named", () => {
    const parent = seed("Parent2");
    const worker = store.createAgent({ name: "Worker2" });
    store.updateIssue({
      id: parent.id,
      expectedRevision: store.getIssue(parent.id).revision,
      assigneeType: "agent",
      assigneeId: worker.id,
      status: "todo",
    });
    const s2a = seedChild("S2A", parent.id, 2);
    const s2b = seedChild("S2B", parent.id, 2);
    const s1a = seedChild("S1A", parent.id, 1);

    // Stage 2 completes first — the frontier is still stage 1.
    const r = store.getIssue(s2a.id);
    store.updateIssueStatus({ id: s2a.id, status: "done", expectedRevision: r.revision });
    const r2 = store.getIssue(s2b.id);
    store.updateIssueStatus({ id: s2b.id, status: "done", expectedRevision: r2.revision });
    expect(systemCommentsOn(parent.id)).toHaveLength(0);

    // Stage 1 closes — the barrier passes, the comment names stage 1 and
    // the next unfinished stage (2 is terminal now, so no next).
    const r1 = store.getIssue(s1a.id);
    store.updateIssueStatus({ id: s1a.id, status: "done", expectedRevision: r1.revision });
    expect(systemCommentsOn(parent.id)).toHaveLength(1);
    expect(systemCommentsOn(parent.id)[0].content).toContain("Stage 1 of this issue is complete");
  });

  it("terminal-to-terminal edits do not re-fire the wake", () => {
    const parent = seed("Parent3");
    const worker = store.createAgent({ name: "Worker3" });
    store.updateIssue({
      id: parent.id,
      expectedRevision: store.getIssue(parent.id).revision,
      assigneeType: "agent",
      assigneeId: worker.id,
      status: "todo",
    });
    const only = seedChild("Only", parent.id);
    const r = store.getIssue(only.id);
    store.updateIssueStatus({ id: only.id, status: "done", expectedRevision: r.revision });
    expect(systemCommentsOn(parent.id)).toHaveLength(1);
    const r2 = store.getIssue(only.id);
    store.updateIssueStatus({ id: only.id, status: "cancelled", expectedRevision: r2.revision });
    expect(systemCommentsOn(parent.id)).toHaveLength(1);
  });

  it("a backlog parent stays inert; a human-assigned parent gets no system comment", () => {
    const parked = seed("Parked");
    const w = store.createAgent({ name: "W4" });
    store.updateIssue({
      id: parked.id,
      expectedRevision: store.getIssue(parked.id).revision,
      assigneeType: "agent",
      assigneeId: w.id,
    });
    const childP = seedChild("CP", parked.id);
    const rp = store.getIssue(parked.id);
    store.updateIssueStatus({ id: parked.id, status: "backlog", expectedRevision: rp.revision });
    const rc = store.getIssue(childP.id);
    store.updateIssueStatus({ id: childP.id, status: "done", expectedRevision: rc.revision });
    expect(systemCommentsOn(parked.id)).toHaveLength(0);

    const humanParent = seed("HumanParent");
    const childH = seedChild("CH", humanParent.id);
    const rh = store.getIssue(childH.id);
    store.updateIssueStatus({ id: childH.id, status: "done", expectedRevision: rh.revision });
    expect(systemCommentsOn(humanParent.id)).toHaveLength(0);
  });
});
