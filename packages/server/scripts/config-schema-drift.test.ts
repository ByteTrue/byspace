import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { PersistedConfigSchema } from "../src/server/persisted-config.js";

// The generated schema is committed so config-shape changes are reviewable, but
// committed generated files drift the moment someone hand-edits them. This test
// regenerates in memory and compares, so a stale file fails here instead of
// silently shipping a schema that disagrees with the daemon.
const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const schemaPath = path.join(repoRoot, "packages/app/public/schemas/byspace.config.v1.json");

// Git checks this file out with CRLF on Windows, so the comparison is made on
// normalized newlines. Real drift still fails; a platform line ending does not.
function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function generate(): string {
  const schema = z.toJSONSchema(PersistedConfigSchema, {
    target: "draft-07",
    unrepresentable: "any",
    io: "input",
  });
  schema.title = "BySpaceConfigV1";
  return `${JSON.stringify(schema, null, 2)}\n`;
}

describe("generated config schema", () => {
  test("matches the committed file", () => {
    expect(normalizeNewlines(readFileSync(schemaPath, "utf8"))).toBe(generate());
  });

  test("declares the fields the daemon actually accepts", () => {
    const parsed = JSON.parse(readFileSync(schemaPath, "utf8")) as {
      title?: string;
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };

    expect(parsed.title).toBe("BySpaceConfigV1");
    expect(Object.keys(parsed.properties ?? {})).toEqual(
      expect.arrayContaining(["$schema", "version", "daemon", "providers"]),
    );
    // A loose schema would let editors offer fields the daemon rejects.
    expect(parsed.additionalProperties).toBe(false);
  });
});
