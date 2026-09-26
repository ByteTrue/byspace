/**
 * Tests for the message stream projection.
 *
 * The parts worth pinning are the distinctions a reader can otherwise lose: a
 * structured mention versus `@name` in the body, visible versus waking, and
 * private versus addressed to one person.
 */
import { describe, expect, it } from "vitest";

import type { WorkerMessageSummary } from "@bytetrue/protocol/worker/rpc-schemas";

import {
  buildMessageStream,
  describeDelivery,
  describeVisibility,
} from "@/workers/group-message-stream";

function message(overrides: Partial<WorkerMessageSummary> = {}): WorkerMessageSummary {
  return {
    messageId: "msg_1",
    groupId: "grp_1",
    seq: 1,
    senderWorkerId: "w1",
    body: "hello",
    intent: "chat",
    deliveryPolicy: "store_only",
    replyToMessageId: null,
    audience: [],
    privateTo: [],
    createdAt: "2026-09-24T00:00:00.000Z",
    ...overrides,
  };
}

const NAMES = new Map([
  ["w1", "Alice"],
  ["w2", "Bob"],
  ["w3", "Carol"],
]);

function one(overrides: Partial<WorkerMessageSummary> = {}) {
  return buildMessageStream([message(overrides)], NAMES)[0]!;
}

describe("routing comes from the structured field", () => {
  it("reads the audience, not the body", () => {
    // Upstream: body text containing @name is presentation only and never
    // populates the audience. So a rendered mention set cannot be parsed out of
    // the text, and a message that merely mentions a name in prose woke nobody.
    const out = one({ body: "@Bob look at this" });
    expect(out.audience).toEqual([]);
    expect(out.body).toContain("@Bob");
  });

  it("resolves a structured audience to names", () => {
    expect(one({ audience: ["w2"] }).audience).toEqual([{ id: "w2", name: "Bob" }]);
  });

  it("keeps an unknown worker's id rather than inventing a name", () => {
    // A role the host no longer ships is still the one that spoke.
    expect(one({ senderWorkerId: "w_ghost" }).sender).toEqual({
      id: "w_ghost",
      name: "w_ghost",
    });
  });
});

describe("visibility is separate from waking", () => {
  it("calls a public single mention public", () => {
    // The rule that is easiest to get wrong: omitting the private set means
    // public even with exactly one addressee, so a single mention must never be
    // rendered as "only Bob can see this".
    const out = one({ audience: ["w2"], deliveryPolicy: "wake" });
    expect(out.isPrivate).toBe(false);
    expect(describeVisibility(out)).toBeNull();
    expect(describeDelivery(out)).toBe("woke Bob");
  });

  it("reports a store-only mention as visible without waking", () => {
    // Constructible on purpose: the field records who it is about while the
    // policy declines to wake them, so the two must be stated separately.
    const out = one({ audience: ["w2"], deliveryPolicy: "store_only" });
    expect(describeDelivery(out)).toBe("visible but woke nobody");
  });

  it("names a waking send that addressed nobody", () => {
    // Looks identical to a stored message unless it is said out loud.
    const out = one({ audience: [], deliveryPolicy: "wake" });
    expect(describeDelivery(out)).toBe("marked to wake, nobody addressed");
  });

  it("counts a multi-worker wake instead of listing them", () => {
    const out = one({ audience: ["w2", "w3"], deliveryPolicy: "wake" });
    expect(describeDelivery(out)).toBe("woke 2 workers");
  });
});

describe("private messages", () => {
  it("counts the sender as a reader", () => {
    // The private set names the other readers; a sender can always read their
    // own message. Treating the set as the whole audience would report a message
    // between two workers as visible to one of them.
    const out = one({ privateTo: ["w2"] });
    expect(out.readers.map((reader) => reader.name)).toEqual(["Alice", "Bob"]);
  });

  it("counts every side of a wide private exchange", () => {
    const out = one({ privateTo: ["w2", "w3"] });
    expect(out.isPrivate).toBe(true);
    expect(describeVisibility(out)).toBe("private to 3 readers");
  });

  it("names both sides of a two-worker private exchange", () => {
    expect(describeVisibility(one({ privateTo: ["w2"] }))).toBe("private between Alice and Bob");
  });

  it("says so when only the sender may read it", () => {
    // A self-private record. Naming a second party here would invent one.
    expect(describeVisibility(one({ privateTo: ["w1"] }))).toBe("private to the sender only");
  });

  it("leaves a public message's visibility unstated", () => {
    expect(describeVisibility(one())).toBeNull();
  });
});

describe("threading", () => {
  it("resolves a quoted message to its visible sequence", () => {
    const stream = buildMessageStream(
      [
        message({ messageId: "msg_root", seq: 1 }),
        message({ messageId: "msg_reply", seq: 2, replyToMessageId: "msg_root" }),
      ],
      NAMES,
    );
    expect(stream[1]?.replyToSeq).toBe(1);
  });

  it("leaves a reference to a message outside the window unresolved", () => {
    // Better than inventing a number: a quote we cannot locate is shown as none
    // rather than as a sequence the reader would chase to the wrong message.
    expect(one({ replyToMessageId: "msg_gone" }).replyToSeq).toBeNull();
  });

  it("reports no quote for an ordinary message", () => {
    expect(one().replyToSeq).toBeNull();
  });
});

describe("ordering", () => {
  it("keeps the stream oldest first", () => {
    const stream = buildMessageStream(
      [
        message({ messageId: "a", seq: 1 }),
        message({ messageId: "b", seq: 2 }),
        message({ messageId: "c", seq: 3 }),
      ],
      NAMES,
    );
    expect(stream.map((entry) => entry.seq)).toEqual([1, 2, 3]);
  });

  it("carries the intent through unchanged", () => {
    // Upstream states that intent never changes routing, so the projection must
    // not branch on it either.
    expect(one({ intent: "request_action" }).intent).toBe("request_action");
  });
});
