import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compilePlugin } from "./compiler.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("plugin author module externals", () => {
  it("leaves the Plugin SDK external in both bundles", async () => {
    const sdk = "@bytetrue/byspace/plugin";
    const directory = await mkdtemp(path.join(tmpdir(), "byspace-plugin-compiler-"));
    temporaryDirectories.push(directory);
    const entryPath = path.join(directory, "index.ts");
    await writeFile(
      entryPath,
      `import type { PluginContext } from "${sdk}";
import { defineRpc } from "${sdk}/server";
import { z } from "zod";

const ping = defineRpc({
  name: "ping",
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
});

export default function contribute(plugin: PluginContext) {
  plugin.handle(ping, async () => ({ ok: true }));
  return () => undefined;
}
`,
    );

    const { clientBundle, serverBundle } = await compilePlugin(entryPath);
    expect(clientBundle).toContain(`${sdk}/server`);
    expect(serverBundle).toContain(`${sdk}/server`);
    expect(clientBundle).not.toContain("Invalid plugin RPC method");
    expect(serverBundle).not.toContain("Invalid plugin RPC method");
  });
});
