import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readPluginManifest } from "./manifest.js";

const directories: string[] = [];

async function createPluginDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "byspace-plugin-manifest-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("plugin manifest", () => {
  it("reads byspace-plugin.json", async () => {
    const directory = await createPluginDirectory();
    await writeFile(path.join(directory, "byspace-plugin.json"), JSON.stringify({ id: "current" }));

    await expect(readPluginManifest(directory)).resolves.toEqual({ id: "current" });
  });

  it("reads legacy paseo-plugin.json", async () => {
    const directory = await createPluginDirectory();
    await writeFile(path.join(directory, "paseo-plugin.json"), JSON.stringify({ id: "legacy" }));

    await expect(readPluginManifest(directory)).resolves.toEqual({ id: "legacy" });
  });

  it("rejects directories containing both manifest filenames", async () => {
    const directory = await createPluginDirectory();
    await Promise.all([
      writeFile(path.join(directory, "byspace-plugin.json"), JSON.stringify({ id: "current" })),
      writeFile(path.join(directory, "paseo-plugin.json"), JSON.stringify({ id: "legacy" })),
    ]);

    await expect(readPluginManifest(directory)).rejects.toThrow("Keep only one plugin manifest");
  });

  it("reports the canonical filename when no manifest exists", async () => {
    const directory = await createPluginDirectory();

    await expect(readPluginManifest(directory)).rejects.toThrow("byspace-plugin.json");
  });

  it("accepts only non-empty argv arrays for build commands", async () => {
    const directory = await createPluginDirectory();
    const manifest = path.join(directory, "byspace-plugin.json");

    await writeFile(
      manifest,
      JSON.stringify({ id: "prepared", build: [["pnpm", "install", "--frozen-lockfile"]] }),
    );
    await expect(readPluginManifest(directory)).resolves.toMatchObject({
      build: [["pnpm", "install", "--frozen-lockfile"]],
    });

    for (const build of [[], [[]], [["pnpm", ""]], [["pnpm", 1]], "pnpm install"]) {
      await writeFile(manifest, JSON.stringify({ id: "prepared", build }));
      await expect(readPluginManifest(directory)).rejects.toThrow();
    }
  });
});
