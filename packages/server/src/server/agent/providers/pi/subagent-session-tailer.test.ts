import { mkdir, mkdtemp, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SubagentObservation } from "../../provider-subagents/observation.js";
import {
  locatePiSubagentSessionFile,
  parsePiSubagentTailerSnapshot,
  PiSubagentSessionTailers,
} from "./subagent-session-tailer.js";

function sessionEntry(sessionId: string, cwd: string): string {
  return JSON.stringify({
    type: "session",
    id: sessionId,
    cwd,
    timestamp: "2026-01-01T00:00:00.000Z",
  });
}

function messageEntry(message: unknown, timestamp = "2026-01-01T00:00:01.000Z"): string {
  return JSON.stringify({ type: "message", timestamp, message });
}

describe("parsePiSubagentTailerSnapshot", () => {
  it("returns null for non-objects and records without an id", () => {
    expect(parsePiSubagentTailerSnapshot(null)).toBeNull();
    expect(parsePiSubagentTailerSnapshot("nope")).toBeNull();
    expect(parsePiSubagentTailerSnapshot({ status: "running" })).toBeNull();
    expect(parsePiSubagentTailerSnapshot({ id: "" })).toBeNull();
  });

  it("extracts id plus tailer fields and skips unrelated ones", () => {
    expect(
      parsePiSubagentTailerSnapshot({
        id: "sub_abc",
        sessionId: "s1",
        sessionFile: "/tmp/s1.jsonl",
        cwd: "/repo",
        status: "running",
        output: "noise",
      }),
    ).toEqual({
      subagentId: "sub_abc",
      sessionId: "s1",
      sessionFile: "/tmp/s1.jsonl",
      cwd: "/repo",
      status: "running",
    });
  });

  it("accepts a status-only record and rejects an id with no relevant fields", () => {
    expect(parsePiSubagentTailerSnapshot({ id: "sub_abc", status: "failed" })).toEqual({
      subagentId: "sub_abc",
      status: "failed",
    });
    expect(parsePiSubagentTailerSnapshot({ id: "sub_abc", output: "x" })).toBeNull();
  });
});

describe("locatePiSubagentSessionFile", () => {
  let root = "";

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "pi-tailer-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("finds the session file by suffix inside a nested sessions dir", async () => {
    const dir = path.join(root, "repo-slug");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "1000_abc123.jsonl"), "", "utf8");
    await writeFile(path.join(dir, "1000_other.jsonl"), "", "utf8");
    expect(
      await locatePiSubagentSessionFile("abc123", { env: { PI_CODING_AGENT_SESSION_DIR: root } }),
    ).toBe(path.join(dir, "1000_abc123.jsonl"));
  });

  it("returns null when nothing matches", async () => {
    expect(
      await locatePiSubagentSessionFile("missing", { env: { PI_CODING_AGENT_SESSION_DIR: root } }),
    ).toBeNull();
  });
});

describe("PiSubagentSessionTailers", () => {
  let root = "";

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "pi-tailers-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function createTailers(extra: Record<string, unknown> = {}) {
    const emitted: Array<{ agentId: string; observation: SubagentObservation }> = [];
    const tailers = new PiSubagentSessionTailers({
      emit: (agentId, observation) => {
        emitted.push({ agentId, observation });
      },
      autoStart: false,
      ...extra,
    });
    return { tailers, emitted };
  }

  it("replays an existing child session into timeline observations", async () => {
    const file = path.join(root, "1000_abc.jsonl");
    await writeFile(
      file,
      [
        sessionEntry("abc", "/repo"),
        messageEntry({ role: "user", content: "do the thing" }),
        messageEntry({ role: "assistant", content: [{ type: "text", text: "done" }] }),
      ].join("\n") + "\n",
      "utf8",
    );
    const { tailers, emitted } = createTailers();
    tailers.update("agent-1", { subagentId: "sub_1", sessionFile: file });
    await tailers.tick();

    expect(emitted).toHaveLength(2);
    expect(emitted[0].agentId).toBe("agent-1");
    expect(emitted[0].observation).toEqual({
      kind: "timeline",
      id: "sub_1",
      item: { type: "user_message", text: "do the thing" },
      timestamp: "2026-01-01T00:00:01.000Z",
    });
    expect(emitted[1].observation).toMatchObject({
      kind: "timeline",
      id: "sub_1",
      item: { type: "assistant_message", text: "done" },
    });
  });

  it("tails appended lines without duplicating earlier rows", async () => {
    const file = path.join(root, "1000_abc.jsonl");
    await writeFile(file, messageEntry({ role: "user", content: "first" }) + "\n", "utf8");
    const { tailers, emitted } = createTailers();
    tailers.update("agent-1", { subagentId: "sub_1", sessionFile: file });
    await tailers.tick();
    expect(emitted).toHaveLength(1);

    await appendFile(file, messageEntry({ role: "user", content: "second" }) + "\n", "utf8");
    await tailers.tick();
    await tailers.tick();

    expect(emitted).toHaveLength(2);
    expect(emitted[1].observation).toMatchObject({
      kind: "timeline",
      id: "sub_1",
      item: { type: "user_message", text: "second" },
    });
  });

  it("stops after a terminal status and ignores later appends", async () => {
    const file = path.join(root, "1000_abc.jsonl");
    await writeFile(file, messageEntry({ role: "user", content: "work" }) + "\n", "utf8");
    const { tailers, emitted } = createTailers({ terminalGraceMs: 0 });
    tailers.update("agent-1", { subagentId: "sub_1", sessionFile: file, status: "succeeded" });
    await tailers.tick();
    expect(emitted).toHaveLength(1);

    await appendFile(file, messageEntry({ role: "user", content: "late" }) + "\n", "utf8");
    await tailers.tick();
    expect(emitted).toHaveLength(1);
  });

  it("locates the child file from a sessionId via the sessions dir", async () => {
    const dir = path.join(root, "repo");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, "1000_sess42.jsonl");
    await writeFile(file, messageEntry({ role: "user", content: "via lookup" }) + "\n", "utf8");
    const { tailers, emitted } = createTailers({ env: { PI_CODING_AGENT_SESSION_DIR: root } });
    tailers.update("agent-1", { subagentId: "sub_1", sessionId: "sess42" });
    await tailers.tick();

    expect(emitted).toHaveLength(1);
    expect(emitted[0].observation).toMatchObject({
      item: { type: "user_message", text: "via lookup" },
    });
  });

  it("removeAgent drops pending entries", async () => {
    const file = path.join(root, "1000_abc.jsonl");
    await writeFile(file, messageEntry({ role: "user", content: "gone" }) + "\n", "utf8");
    const { tailers, emitted } = createTailers();
    tailers.update("agent-1", { subagentId: "sub_1", sessionFile: file });
    tailers.removeAgent("agent-1");
    await tailers.tick();
    expect(emitted).toHaveLength(0);
  });
});
