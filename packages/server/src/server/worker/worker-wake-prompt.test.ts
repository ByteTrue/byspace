/**
 * Tests for the wake framing.
 *
 * What a worker is told decides what it can do, so the parts that matter are
 * whether it can identify the speaker, find the message to reply to, and know
 * who is in the group.
 */
import { describe, expect, it } from "vitest";

import type { WorkerMessageRecord } from "./worker-store.js";
import { NO_ACTIONABLE_MESSAGES, buildWakePrompt } from "./worker-wake-prompt.js";

function message(overrides: Partial<WorkerMessageRecord> = {}): WorkerMessageRecord {
  return {
    messageId: "msg_1",
    groupId: "grp_1",
    seq: 1,
    senderWorkerId: "w1",
    body: "need the schema",
    intent: "request_action",
    deliveryPolicy: "wake",
    replyToMessageId: null,
    audience: ["w2"],
    privateTo: [],
    createdAt: "2026-09-24T00:00:00.000Z",
    ...overrides,
  };
}

const MEMBERS = [
  { groupId: "grp_1", workerId: "w1", role: "coordinator" as const, joinedAt: "" },
  { groupId: "grp_1", workerId: "w2", role: "member" as const, joinedAt: "" },
];
const NAMES = new Map([
  ["w1", "Alice"],
  ["w2", "Bob"],
]);

function build(overrides: Partial<Parameters<typeof buildWakePrompt>[0]> = {}) {
  return buildWakePrompt({
    workerName: "Bob",
    workerId: "w2",
    groupId: "grp_1",
    messages: [message()],
    members: MEMBERS,
    nameById: NAMES,
    hasGoal: true,
    isCoordinator: false,
    hasRequestedWork: true,
    ...overrides,
  });
}

describe("wake prompt", () => {
  it("names the worker being spoken to", () => {
    expect(build()).toContain("You are Bob");
  });

  it("gives the message id, because replying requires it", () => {
    // `message send --reply-to` and `goal mutate --result-message` both take a
    // message id, so a wake that omits them produces a worker that cannot
    // attribute its own answer.
    expect(build()).toContain("[msg_1]");
  });

  it("names the speaker rather than leaving a raw id", () => {
    const out = build();
    expect(out).toContain("Alice: need the schema");
  });

  it("falls back to the id for an unknown sender", () => {
    // A name that is guessed wrong is worse than an id that is merely ugly.
    const out = build({ messages: [message({ senderWorkerId: "w_ghost" })] });
    expect(out).toContain("w_ghost:");
  });

  it("lists the group with its coordinator marked", () => {
    const out = build();
    expect(out).toContain("Alice (coordinator)");
    expect(out).toContain("Bob");
  });

  it("carries the reply target so a thread stays followable", () => {
    const out = build({ messages: [message({ replyToMessageId: "msg_root" })] });
    expect(out).toContain("in reply to msg_root");
  });

  it("counts several arrivals accurately", () => {
    const out = build({
      messages: [message({ messageId: "a" }), message({ messageId: "b" })],
    });
    expect(out).toContain("2 messages arrived");
    expect(out).toContain("[a]");
    expect(out).toContain("[b]");
  });

  it("uses the singular for one arrival", () => {
    expect(build()).toContain("1 message arrived");
  });

  it("tells the worker to report a blocker rather than invent an answer", () => {
    // This is the behaviour the role's skill promises; the framing must not
    // contradict it by demanding a result.
    expect(build()).toContain("report a blocker rather than inventing an answer");
  });

  it("tells a woken worker that a wake alone is not a reason to speak", () => {
    // Two workers who each acknowledge the other's acknowledgement wake each
    // other forever. The reference product carries this rule explicitly, and it
    // belongs in the framing rather than only in the skill, because the skill is
    // read on demand and this is the moment the decision is made.
    expect(build()).toContain("Being woken is not by itself a reason to speak");
    expect(build()).toContain("--not-mention");
  });

  it("designates a leader without a goal only when work was assigned", () => {
    // The bound is structural: without a goal nothing caps how many wakes a
    // group spends, and every wake is a paid agent session. But designating over
    // an errand would invent a planning task out of a one-word question.
    expect(build({ hasGoal: false, isCoordinator: true, hasRequestedWork: true })).toContain(
      "you are designated to set one now",
    );
    expect(build({ hasGoal: false, isCoordinator: true, hasRequestedWork: false })).not.toContain(
      "designated to set one",
    );
    // A member is never told to set the group's goal; that is the leader's job.
    expect(build({ hasGoal: false, isCoordinator: false, hasRequestedWork: true })).not.toContain(
      "designated to set one",
    );
    // And a group that already has one is not asked to make a second.
    expect(build({ hasGoal: true, isCoordinator: true, hasRequestedWork: true })).not.toContain(
      "designated to set one",
    );
  });

  it("instructs nothing when there is nothing to act on", () => {
    expect(build({ messages: [] })).toBe(NO_ACTIONABLE_MESSAGES);
  });

  it("does not command the worker to run specific shell commands", () => {
    // A wake that reads "run this exact command and report it verbatim" is
    // refused by the model as an injection pattern. The commands are named as
    // belonging to the skill, which is where their detail lives.
    const out = build();
    expect(out).not.toMatch(/run this exact|verbatim|do not summarize/);
  });
});
