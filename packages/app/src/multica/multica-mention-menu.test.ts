/**
 * The mention menu's pure rules: tail-only trigger, prefix filtering, and
 * the draft rewrite that turns the @fragment into the source's markup.
 */
import { describe, expect, it } from "vitest";

import { applyMentionChoice, mentionMenuState, tailMention } from "./multica-mention-menu.js";

const roster = {
  agents: [
    { kind: "agent" as const, id: "a-1", name: "Chief of Staff" },
    { kind: "agent" as const, id: "a-2", name: "Writer" },
  ],
  squads: [{ kind: "squad" as const, id: "s-1", name: "Docs crew" }],
};

describe("tail trigger", () => {
  it("a bare @ opens the menu with every candidate", () => {
    expect(tailMention("say hi @")).toBe("");
    expect(mentionMenuState("say hi @", roster)?.candidates).toHaveLength(3);
  });

  it("a fragment filters by prefix, case-insensitively", () => {
    const state = mentionMenuState("@chief", roster);
    expect(state?.candidates.map((candidate) => candidate.name)).toEqual(["Chief of Staff"]);
  });

  it("no tail @ means no menu, and a mid-text @ stays literal", () => {
    expect(mentionMenuState("plain text", roster)).toBeNull();
    expect(mentionMenuState("mail me @host then write", roster)).toBeNull();
  });
});

describe("applying a choice", () => {
  it("the tail fragment becomes markup carrying the id", () => {
    // The menu is open exactly while the @ sits at the tail, so the choice
    // rewrites the tail; the trailing space readies the next word.
    const draft = applyMentionChoice("please @chief", {
      kind: "agent",
      id: "a-1",
      name: "Chief of Staff",
    });
    expect(draft).toBe("please [@Chief of Staff](mention://agent/a-1) ");
  });

  it("a squad choice carries the squad kind", () => {
    const draft = applyMentionChoice("@Docs", { kind: "squad", id: "s-1", name: "Docs crew" });
    expect(draft).toBe("[@Docs crew](mention://squad/s-1) ");
  });

  it("without an open tail the draft is untouched", () => {
    expect(applyMentionChoice("no mention here", roster.agents[0])).toBe("no mention here");
  });
});
