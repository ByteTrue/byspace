import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDaemonTestContext, type DaemonTestContext } from "../server/test-utils/index.js";
import { DaemonClient } from "../server/test-utils/daemon-client.js";
import type { CollabSliceRecord } from "@bytetrue/protocol/messages";

let ctx: DaemonTestContext;
let byspaceHomeRoot: string | null = null;
const tempRoots: string[] = [];

beforeEach(async () => {
  byspaceHomeRoot = await mkdtemp(join(tmpdir(), "collab-e2e-home-"));
  tempRoots.push(byspaceHomeRoot);
  ctx = await createDaemonTestContext({ byspaceHomeRoot, cleanup: false });
});

afterEach(async () => {
  await ctx.cleanup();
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  byspaceHomeRoot = null;
});

async function restartDaemonOnSameHome(): Promise<void> {
  await ctx.cleanup();
  // Keep the same home directory so the daemon reloads the persisted store.
  ctx = await createDaemonTestContext({ byspaceHomeRoot: byspaceHomeRoot!, cleanup: false });
}

describe("collab slice RPC end to end", () => {
  it("creates a record over RPC, persists it to disk, and survives a daemon restart", async () => {
    const created = await ctx.client.collabSliceCreate({ title: "Survives restart" });
    expect(created.error).toBeNull();
    expect(created.record).toMatchObject({ title: "Survives restart" });

    // The record is on disk under the daemon home, in the store's own file.
    const raw = await readFile(join(byspaceHomeRoot!, ".byspace", "collab", "slices.json"), "utf8");
    const stored = JSON.parse(raw) as { records: CollabSliceRecord[] };
    expect(stored.records).toHaveLength(1);
    expect(stored.records[0]!.id).toBe(created.record!.id);

    // A second client-visible read returns the same record.
    const listed = await ctx.client.collabSliceList();
    expect(listed.error).toBeNull();
    expect(listed.records.map((record) => record.id)).toEqual([created.record!.id]);

    // Restart the daemon on the same home; the record is still there.
    await restartDaemonOnSameHome();
    const afterRestart = await ctx.client.collabSliceList();
    expect(afterRestart.error).toBeNull();
    expect(afterRestart.records.map((record) => record.id)).toEqual([created.record!.id]);
    expect(afterRestart.records[0]!.title).toBe("Survives restart");
  });

  it("lists an empty store without error on a fresh home", async () => {
    const listed = await ctx.client.collabSliceList();
    expect(listed.error).toBeNull();
    expect(listed.records).toEqual([]);
  });

  it("persists two creates from overlapping callers", async () => {
    const [a, b] = await Promise.all([
      ctx.client.collabSliceCreate({ title: "A" }),
      ctx.client.collabSliceCreate({ title: "B" }),
    ]);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    const listed = await ctx.client.collabSliceList();
    expect(listed.records.map((record) => record.title).sort()).toEqual(["A", "B"]);
  });

  it("serializes creates across two concurrent connections (one store instance)", async () => {
    // A second WebSocket connection gets its own Session; both sessions must
    // share the daemon-wide store, otherwise a read-modify-write race could
    // silently drop one connection's record.
    const second = new DaemonClient({ url: `ws://127.0.0.1:${ctx.daemon.port}/ws` });
    await second.connect();
    try {
      const [a, b] = await Promise.all([
        ctx.client.collabSliceCreate({ title: "from-first" }),
        second.collabSliceCreate({ title: "from-second" }),
      ]);
      expect(a.error).toBeNull();
      expect(b.error).toBeNull();
      const listed = await second.collabSliceList();
      expect(listed.records.map((record) => record.title).sort()).toEqual([
        "from-first",
        "from-second",
      ]);
    } finally {
      await second.close();
    }
  });

  it("reports a corrupted store as rpc_error instead of crashing the handler", async () => {
    await ctx.client.collabSliceCreate({ title: "before-corruption" });
    await writeFile(
      join(byspaceHomeRoot!, ".byspace", "collab", "slices.json"),
      JSON.stringify({ records: [{ nope: true }] }),
    );
    await expect(ctx.client.collabSliceList()).rejects.toMatchObject({
      code: "collab_request_failed",
    });
  });
});
