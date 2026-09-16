import { describe, expect, it } from "vitest";
import { parseNotificationMessage } from "./message-notification-parser";

describe("parseNotificationMessage", () => {
  it("handles empty or whitespace-only messages", () => {
    expect(parseNotificationMessage("")).toEqual({ title: null, body: null });
    expect(parseNotificationMessage("   \n\n  ")).toEqual({ title: null, body: null });
  });

  it("extracts markdown h2 heading with body (Historian recovery case)", () => {
    const raw = `## Historian recovery

Historian previously failed 3 time(s), so Magic Context is retrying history comparting immediately after restart.`;
    expect(parseNotificationMessage(raw)).toEqual({
      title: "Historian recovery",
      body: "Historian previously failed 3 time(s), so Magic Context is retrying history comparting immediately after restart.",
    });
  });

  it("extracts markdown h1-h6 headings and strips trailing hashes", () => {
    expect(parseNotificationMessage("# Important Notice #\n\nPlease read carefully.")).toEqual({
      title: "Important Notice",
      body: "Please read carefully.",
    });

    expect(parseNotificationMessage("### Warning\n\nDisk almost full")).toEqual({
      title: "Warning",
      body: "Disk almost full",
    });

    expect(parseNotificationMessage("## Title Only")).toEqual({
      title: "Title Only",
      body: null,
    });
  });

  it("extracts bold first-line headings", () => {
    const raw = `**Context full**

/ctx-flush or /clear to continue.`;
    expect(parseNotificationMessage(raw)).toEqual({
      title: "Context full",
      body: "/ctx-flush or /clear to continue.",
    });
  });

  it("extracts short first paragraph separated by blank line", () => {
    const raw = `Attention Required

Agent requested confirmation to execute bash command.`;
    expect(parseNotificationMessage(raw)).toEqual({
      title: "Attention Required",
      body: "Agent requested confirmation to execute bash command.",
    });
  });

  it("treats single-line messages as title", () => {
    expect(parseNotificationMessage("Search finished")).toEqual({
      title: "Search finished",
      body: null,
    });
    expect(parseNotificationMessage("Context full — /ctx-flush or /clear to continue.")).toEqual({
      title: "Context full — /ctx-flush or /clear to continue.",
      body: null,
    });
  });

  it("treats multi-line messages without clear heading as body", () => {
    const raw = `line 1 of stack trace\nline 2 of stack trace\nline 3 of stack trace`;
    expect(parseNotificationMessage(raw)).toEqual({
      title: null,
      body: raw,
    });
  });
});
