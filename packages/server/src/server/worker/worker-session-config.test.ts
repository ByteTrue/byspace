/**
 * Tests for the worker -> session config mapping.
 *
 * This is the seam where a role becomes a runtime session, so the assertions
 * are about what the provider will actually receive.
 */
import { describe, expect, it } from "vitest";

import { buildWorkerSessionConfig } from "./worker-session-config.js";
import type { WorkerTemplate } from "./worker-template.js";

const TEMPLATE: WorkerTemplate = {
  id: "frontend-developer",
  title: "Frontend Developer",
  parts: {
    IDENTITY: "# Identity — Frontend Developer\n\nYou build interfaces.",
    PERSONA: "# Persona\n\nDirect and evidence-led.",
    BIBLE: "# Bible\n\nDesign before code.",
  },
  skills: [],
};

describe("worker session config", () => {
  it("runs workers on pi and nothing else", () => {
    const { config } = buildWorkerSessionConfig({ template: TEMPLATE, cwd: "/repo" });
    expect(config.provider).toBe("pi");
  });

  it("puts the assembled role in the system prompt", () => {
    const { config, rolePrompt } = buildWorkerSessionConfig({ template: TEMPLATE, cwd: "/repo" });

    expect(config.systemPrompt).toBe(rolePrompt);
    expect(rolePrompt).toContain("You build interfaces.");
    expect(rolePrompt).toContain("Direct and evidence-led.");
    expect(rolePrompt).toContain("Design before code.");
  });

  it("does not set the daemon-level prompt, which is not a worker's business", () => {
    const { config } = buildWorkerSessionConfig({ template: TEMPLATE, cwd: "/repo" });
    expect(config.daemonAppendSystemPrompt).toBeUndefined();
  });

  it("uses the task workspace as cwd, not the worker's home", () => {
    const { config } = buildWorkerSessionConfig({ template: TEMPLATE, cwd: "/worktrees/task-1" });
    expect(config.cwd).toBe("/worktrees/task-1");
  });

  it("appends a per-task prompt after the role without displacing it", () => {
    const { config, rolePrompt } = buildWorkerSessionConfig({
      template: TEMPLATE,
      cwd: "/repo",
      taskPrompt: "  Build the pricing table.  ",
    });

    expect(config.systemPrompt).toBe(`${rolePrompt}\n\n---\n\nBuild the pricing table.`);
    // The role must still come first: the task is framed by who is doing it.
    expect(config.systemPrompt?.indexOf(rolePrompt)).toBe(0);
  });

  it("omits optional fields rather than passing empty strings", () => {
    const { config } = buildWorkerSessionConfig({ template: TEMPLATE, cwd: "/repo" });
    expect(config.model).toBeUndefined();
    expect(config.title).toBeUndefined();
  });

  it("passes through a title when explicitly set, including null", () => {
    const untitled = buildWorkerSessionConfig({ template: TEMPLATE, cwd: "/repo", title: null });
    expect(untitled.config.title).toBeNull();

    const titled = buildWorkerSessionConfig({
      template: TEMPLATE,
      cwd: "/repo",
      title: "Add table",
    });
    expect(titled.config.title).toBe("Add table");
  });

  it("refuses to start a session from an empty role", () => {
    const empty: WorkerTemplate = {
      id: "blank",
      title: "Blank",
      parts: { IDENTITY: "", PERSONA: "", BIBLE: "" },
      skills: [],
    };
    expect(() => buildWorkerSessionConfig({ template: empty, cwd: "/repo" })).toThrow(
      /empty role prompt/,
    );
  });

  it("does not leak template bookkeeping into the prompt", () => {
    const { config } = buildWorkerSessionConfig({ template: TEMPLATE, cwd: "/repo" });
    // The id and title are catalog metadata, not instructions.
    expect(config.systemPrompt).not.toContain("frontend-developer");
  });
});
