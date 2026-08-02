import { describe, expect, it } from "vitest";
import { TerminalOutputBacklog } from "./terminal-output-backlog.js";

describe("TerminalOutputBacklog", () => {
  it("returns what a client missed after the revision it last received", () => {
    const backlog = new TerminalOutputBacklog({ maxChars: 1_000 });
    backlog.append(1, "one");
    backlog.append(2, "two");
    backlog.append(3, "three");

    expect(backlog.since(1)).toEqual({ data: "twothree", revision: 3 });
  });

  it("reports an up-to-date client as having missed nothing", () => {
    const backlog = new TerminalOutputBacklog({ maxChars: 1_000 });
    backlog.append(4, "tail");

    expect(backlog.since(4)).toEqual({ data: "", revision: 4 });
  });

  it("serves a client that has never received anything while nothing has been evicted", () => {
    const backlog = new TerminalOutputBacklog({ maxChars: 1_000 });
    backlog.append(1, "one");

    expect(backlog.since(0)).toEqual({ data: "one", revision: 1 });
  });

  it("refuses to resume across evicted output instead of sending a gap", () => {
    const backlog = new TerminalOutputBacklog({ maxChars: 8 });
    backlog.append(1, "aaaa");
    backlog.append(2, "bbbb");
    backlog.append(3, "cccc");

    // "aaaa" no longer exists, so a client that stopped at revision 0 cannot be
    // resumed - it has to be told to take a snapshot instead.
    expect(backlog.since(0)).toBeNull();
    expect(backlog.since(1)).toEqual({ data: "bbbbcccc", revision: 3 });
  });

  it("keeps the budget hard when one chunk is larger than all of it", () => {
    const backlog = new TerminalOutputBacklog({ maxChars: 4 });
    backlog.append(1, "aaaa");
    backlog.append(2, "bbbbbbbb");

    // Nothing is retained, so nobody can be resumed — which is the right answer
    // for a burst that large: a snapshot is cheaper than replaying it.
    expect(backlog.since(1)).toBeNull();
    expect(backlog.since(2)).toEqual({ data: "", revision: 2 });
  });

  it("refuses to resume across output that arrived without a revision", () => {
    const backlog = new TerminalOutputBacklog({ maxChars: 1_000 });
    backlog.append(1, "one");
    backlog.append(undefined, "unnumbered");
    backlog.append(5, "five");

    // Everything up to the unnumbered chunk is unaccounted for; only a client
    // that already had revision 4 can be resumed from here.
    expect(backlog.since(1)).toBeNull();
    expect(backlog.since(4)).toEqual({ data: "five", revision: 5 });
  });

  it("refuses to resume a client claiming output the terminal never produced", () => {
    const backlog = new TerminalOutputBacklog({ maxChars: 1_000 });
    backlog.append(2, "two");

    expect(backlog.since(7)).toBeNull();
  });
});
