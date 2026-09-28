/**
 * The multica CLI surface: the operator's and the agents' terminal face for
 * the replica. Pinned so a renamed or dropped subcommand fails here rather
 * than in a run that suddenly cannot operate.
 */
import { describe, expect, it } from "vitest";

import { createMulticaCommand } from "./multica.js";

describe("multica CLI surface", () => {
  const command = () => createMulticaCommand();

  it("offers the four core groups", () => {
    const names = command().commands.map((sub) => sub.name());
    expect(names).toEqual(expect.arrayContaining(["issue", "agent", "comment", "inbox"]));
  });

  it("offers the issue verbs the domain needs", () => {
    const issue = command().commands.find((sub) => sub.name() === "issue");
    const names = issue?.commands.map((sub) => sub.name()) ?? [];
    expect(names).toEqual(expect.arrayContaining(["ls", "create", "wakeup"]));
  });

  it("offers wakeup registration and retirement", () => {
    const issue = command().commands.find((sub) => sub.name() === "issue");
    const wakeup = issue?.commands.find((sub) => sub.name() === "wakeup");
    const names = wakeup?.commands.map((sub) => sub.name()) ?? [];
    expect(names).toEqual(expect.arrayContaining(["ls", "create", "disable"]));
  });

  it("offers the autopilot verbs", () => {
    const autopilot = command().commands.find((sub) => sub.name() === "autopilot");
    const names = autopilot?.commands.map((sub) => sub.name()) ?? [];
    expect(names).toEqual(
      expect.arrayContaining(["ls", "create", "trigger", "runs", "pause", "enable", "archive"]),
    );
  });

  it("offers the inbox reading and filing verbs", () => {
    const inbox = command().commands.find((sub) => sub.name() === "inbox");
    const names = inbox?.commands.map((sub) => sub.name()) ?? [];
    expect(names).toEqual(expect.arrayContaining(["ls", "read", "archive", "read-all", "create"]));
  });
});
