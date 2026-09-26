import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CollabSliceStore } from "./store.js";

const tempDirs: string[] = [];

async function createStore(): Promise<CollabSliceStore> {
  const home = await mkdtemp(join(tmpdir(), "collab-store-"));
  tempDirs.push(home);
  return new CollabSliceStore(home);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("CollabSliceStore", () => {
  it("lists nothing when no file exists yet", async () => {
    const store = await createStore();
    await expect(store.list()).resolves.toEqual([]);
  });

  it("creates a record, persists it, and lists it back", async () => {
    const store = await createStore();
    const record = await store.create({ title: "First" });
    expect(record.title).toBe("First");
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(store.list()).resolves.toEqual([record]);
  });

  it("keeps records across store instances (daemon restart shape)", async () => {
    const home = await mkdtemp(join(tmpdir(), "collab-store-"));
    tempDirs.push(home);
    const first = new CollabSliceStore(home);
    await first.create({ title: "A" });
    await first.create({ title: "B" });

    const second = new CollabSliceStore(home);
    const records = await second.list();
    expect(records.map((record) => record.title)).toEqual(["A", "B"]);
  });

  it("writes the store as pretty-printed JSON under $HOME/collab/slices.json", async () => {
    const home = await mkdtemp(join(tmpdir(), "collab-store-"));
    tempDirs.push(home);
    const store = new CollabSliceStore(home);
    await store.create({ title: "Persisted" });
    const raw = await readFile(join(home, "collab", "slices.json"), "utf8");
    expect(JSON.parse(raw)).toMatchObject({
      records: [{ title: "Persisted" }],
    });
  });

  it("serializes concurrent creates without losing records", async () => {
    const store = await createStore();
    await Promise.all([
      store.create({ title: "one" }),
      store.create({ title: "two" }),
      store.create({ title: "three" }),
    ]);
    const records = await store.list();
    expect(records.map((record) => record.title).sort()).toEqual(["one", "three", "two"]);
  });

  it("fails loudly on unreadable store content instead of resetting data", async () => {
    const home = await mkdtemp(join(tmpdir(), "collab-store-"));
    tempDirs.push(home);
    const store = new CollabSliceStore(home);
    await store.create({ title: "ok" });
    // Corrupt: write invalid shape directly.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(home, "collab", "slices.json"),
      JSON.stringify({ records: [{ nope: true }] }),
    );
    await expect(store.list()).rejects.toThrow(/corrupted/);
    // Create reads before writing, so it refuses to run on a corrupted store
    // rather than silently discarding the unreadable records.
    await expect(store.create({ title: "again" })).rejects.toThrow(/corrupted/);
  });
});
