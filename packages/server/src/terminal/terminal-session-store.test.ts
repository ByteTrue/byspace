import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TerminalSessionStore } from "./terminal-session-store.js";

const temporaryDirs: string[] = [];

afterAll(() => {
  while (temporaryDirs.length > 0) {
    const dir = temporaryDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createStore(): { store: TerminalSessionStore; filePath: string } {
  const dir = mkdtempSync(join(tmpdir(), "byspace-terminal-store-"));
  temporaryDirs.push(dir);
  const filePath = join(dir, "terminals.json");
  return { store: new TerminalSessionStore(filePath), filePath };
}

const sampleRecord = {
  id: "terminal-1",
  cwd: "/tmp/workspace",
  workspaceId: "ws-1",
  name: "Terminal 1",
};

describe("TerminalSessionStore", () => {
  it("returns empty for a missing file", async () => {
    const { store } = createStore();
    await expect(store.load()).resolves.toEqual([]);
  });

  it("round-trips records through an atomic write", async () => {
    const { store, filePath } = createStore();
    await store.replace([sampleRecord]);
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual([sampleRecord]);
    await expect(store.load()).resolves.toEqual([sampleRecord]);
  });

  it("serializes concurrent replace calls to one intact payload", async () => {
    const { store, filePath } = createStore();
    const first = [sampleRecord];
    const second = [{ ...sampleRecord, id: "terminal-2" }];
    await Promise.all([store.replace(first), store.replace(second)]);
    const raw = JSON.parse(readFileSync(filePath, "utf8"));
    expect(raw === first || JSON.stringify(raw) === JSON.stringify(second)).toBe(true);
    await expect(store.load()).resolves.toEqual(raw);
  });

  it("keeps accepting writes after a failed write", async () => {
    const dir = mkdtempSync(join(tmpdir(), "byspace-terminal-store-"));
    temporaryDirs.push(dir);
    const filePath = join(dir, "terminals.json");
    const store = new TerminalSessionStore(filePath);
    // A directory at the target path makes the atomic rename fail.
    mkdirSync(filePath);

    await expect(store.replace([sampleRecord])).rejects.toThrow();
    rmSync(filePath, { recursive: true, force: true });
    await store.replace([{ ...sampleRecord, id: "terminal-2" }]);
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual([
      { ...sampleRecord, id: "terminal-2" },
    ]);
  });

  it("rejects malformed payloads on load", async () => {
    const { store, filePath } = createStore();
    writeFileSync(filePath, JSON.stringify([{ id: "terminal-1" }]));
    await expect(store.load()).rejects.toThrow();
  });
});
