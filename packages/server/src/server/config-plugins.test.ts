import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadConfig } from "./config.js";

const roots: string[] = [];

async function createBySpaceHome(config: unknown): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "byspace-config-plugins-"));
  roots.push(root);
  const byspaceHome = path.join(root, ".byspace");
  await mkdir(byspaceHome, { recursive: true });
  await writeFile(path.join(byspaceHome, "config.json"), JSON.stringify(config, null, 2));
  return byspaceHome;
}

describe("daemon plugin config", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("defaults plugins off when config is absent", async () => {
    const home = await createBySpaceHome({ version: 1 });

    expect(loadConfig(home, { env: {} }).pluginsEnabled).toBe(false);
  });

  test("loads the explicit plugin opt-in", async () => {
    const home = await createBySpaceHome({ version: 1, pluginsEnabled: true });

    expect(loadConfig(home, { env: {} }).pluginsEnabled).toBe(true);
  });
});
