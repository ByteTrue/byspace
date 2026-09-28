/**
 * Tests for the trigger engine: the predicate that decides when a write
 * starts a run, and the comment trigger that decides who a comment wakes.
 *
 * The contracts are the source's, in its own words: backlog is the parking
 * lot, terminal statuses start nothing, a squad resolves to its leader,
 * explicit mentions win over @all, agent authors get no implicit routing,
 * and a pending run coalesces instead of duplicating.
 */
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MIGRATIONS } from "./migrations/index.js";
import { MulticaStore } from "./store.js";
import { commentTriggers, hasPendingRun, parseMentions, willEnqueueRun } from "./trigger-engine.js";

let store: MulticaStore;
let db: DatabaseSync;
let agentId: string;
let leaderId: string;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  store = new MulticaStore(db, { migrations: MIGRATIONS });
  agentId = store.createAgent({ name: "Frontend" }).id;
  leaderId = store.createAgent({ name: "Lead" }).id;
});

afterEach(() => {
  store.close();
});

function issueWith(overrides: Partial<Parameters<MulticaStore["createIssue"]>[0]> = {}) {
  return store.createIssue({
    title: "t",
    creatorType: "owner",
    creatorId: "owner",
    status: "todo",
    assigneeType: "agent",
    assigneeId: agentId,
    ...overrides,
  });
}

describe("willEnqueueRun", () => {
  it("assigning into an active status starts a run", () => {
    const issue = issueWith({ status: "todo" });
    const decision = willEnqueueRun({
      store,
      issue,
      isCreate: true,
      assigneeChanged: false,
      statusChanged: false,
      prevStatus: "backlog",
    });
    expect(decision).toMatchObject({ agentId: agentId, source: "assign" });
  });

  it("backlog is the parking lot: assigning into it starts nothing", () => {
    const issue = issueWith({ status: "backlog" });
    const decision = willEnqueueRun({
      store,
      issue,
      isCreate: true,
      assigneeChanged: false,
      statusChanged: false,
      prevStatus: "backlog",
    });
    expect(decision).toBeNull();
  });

  it("leaving backlog toward an active status starts a run", () => {
    const issue = issueWith({ status: "in_progress" });
    const decision = willEnqueueRun({
      store,
      issue,
      isCreate: false,
      assigneeChanged: false,
      statusChanged: true,
      prevStatus: "backlog",
    });
    expect(decision).toMatchObject({ source: "status" });
  });

  it("leaving backlog toward done starts nothing", () => {
    const issue = issueWith({ status: "done" });
    const decision = willEnqueueRun({
      store,
      issue,
      isCreate: false,
      assigneeChanged: false,
      statusChanged: true,
      prevStatus: "backlog",
    });
    expect(decision).toBeNull();
  });

  it("a squad assignee resolves to its leader", () => {
    const squad = store.createSquad({
      name: "Team",
      leaderId,
      creatorType: "owner",
      creatorId: "owner",
    });
    const issue = issueWith({ status: "todo", assigneeType: "squad", assigneeId: squad.id });
    const decision = willEnqueueRun({
      store,
      issue,
      isCreate: true,
      assigneeChanged: false,
      statusChanged: false,
      prevStatus: "backlog",
    });
    expect(decision).toMatchObject({ agentId: leaderId, assigneeType: "agent" });
  });

  it("an unassigned issue starts nothing", () => {
    const issue = issueWith({ assigneeType: null, assigneeId: null });
    const decision = willEnqueueRun({
      store,
      issue,
      isCreate: true,
      assigneeChanged: false,
      statusChanged: false,
      prevStatus: "backlog",
    });
    expect(decision).toBeNull();
  });
});

describe("commentTriggers", () => {
  it("an explicit @mention wakes the named agent", () => {
    const issue = issueWith({});
    const triggers = commentTriggers({
      store,
      issue,
      content: "hey @Frontend can you look",
      authorType: "owner",
      authorId: "owner",
      mentions: parseMentions("hey @Frontend can you look"),
    });
    expect(triggers).toEqual([{ agentId: agentId, reason: "mention" }]);
  });

  it("a squad mention wakes its leader", () => {
    store.createSquad({
      name: "Team",
      leaderId,
      creatorType: "owner",
      creatorId: "owner",
    });
    const issue = issueWith({});
    const triggers = commentTriggers({
      store,
      issue,
      content: "@Team take this",
      authorType: "owner",
      authorId: "owner",
      mentions: parseMentions("@Team take this"),
    });
    expect(triggers).toEqual([{ agentId: leaderId, reason: "mention" }]);
  });

  it("@all alone suppresses the implicit fallback and wakes nobody", () => {
    const issue = issueWith({});
    const triggers = commentTriggers({
      store,
      issue,
      content: "@all",
      authorType: "owner",
      authorId: "owner",
      mentions: parseMentions("@all"),
    });
    expect(triggers).toEqual([]);
  });

  it("an explicit mention wins over @all", () => {
    const issue = issueWith({});
    const triggers = commentTriggers({
      store,
      issue,
      content: "@all and @Frontend too",
      authorType: "owner",
      authorId: "owner",
      mentions: parseMentions("@all and @Frontend too"),
    });
    expect(triggers).toEqual([{ agentId: agentId, reason: "mention" }]);
  });

  it("a human comment on an assigned issue routes to the assignee", () => {
    const issue = issueWith({});
    const triggers = commentTriggers({
      store,
      issue,
      content: "any update?",
      authorType: "owner",
      authorId: "owner",
      mentions: [],
    });
    expect(triggers).toEqual([{ agentId: agentId, reason: "assignee" }]);
  });

  it("an agent author gets no implicit routing", () => {
    const issue = issueWith({});
    const triggers = commentTriggers({
      store,
      issue,
      content: "status note",
      authorType: "agent",
      authorId: agentId,
      mentions: [],
    });
    expect(triggers).toEqual([]);
  });
});

describe("pending dedup", () => {
  it("coalesces a second run for an agent already pending on the issue", () => {
    const issue = issueWith({});
    store.createTask({ agentId, issueId: issue.id });
    const pending = hasPendingRun(store, issue.id, agentId);
    expect(pending).not.toBeNull();
    // A different agent is unaffected.
    expect(hasPendingRun(store, issue.id, leaderId)).toBeNull();
  });
});

describe("parseMentions", () => {
  it("extracts unique bare @names with word boundaries", () => {
    const names = (text: string): string[] =>
      parseMentions(text)
        .filter((mention) => mention.name !== null)
        .map((mention) => mention.name as string);
    expect(names("hi @Foo and @Bar, cc @Foo again")).toEqual(["Foo", "Bar"]);
    expect(names("email user@host is not a mention")).toEqual([]);
  });

  it("recognizes mentions after full-width punctuation", () => {
    // CJK punctuation before the @ is a boundary: 请回复：@Writer must wake
    // Writer, and a pure-whitespace boundary rule would silently drop it.
    const names = (text: string): string[] =>
      parseMentions(text)
        .filter((mention) => mention.name !== null)
        .map((mention) => mention.name as string);
    expect(names("请回复：@Writer")).toEqual(["Writer"]);
    expect(names("任务（@Writer 负责）")).toEqual(["Writer"]);
  });

  it("reads the source's markup and never truncates a multi-word name", () => {
    const parsed = parseMentions(
      "[@Chief of Staff](mention://agent/abc-123) and [@Team](mention://squad/def-456) and [@all](mention://all/all)",
    );
    expect(parsed.map((mention) => [mention.kind, mention.id ?? mention.name])).toEqual([
      ["agent", "abc-123"],
      ["squad", "def-456"],
      ["all", null],
    ]);
  });

  it("markup mentions do not double-list as bare names", () => {
    const parsed = parseMentions("[@Writer](mention://agent/w-1) plus @Writer again");
    expect(parsed.filter((mention) => mention.name === "Writer")).toHaveLength(1);
  });
});
