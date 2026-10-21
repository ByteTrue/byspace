import assert from "node:assert/strict";
import test from "node:test";

import { auditFromSources, parseSchemas, runAudit } from "./go-emit-parity.mjs";

// The audit is only useful if its parser agrees with the protocol file. A silently empty
// schema would report "0 problems" for a broken daemon, which is worse than no check.
test("parses optional and nullable independently of order", () => {
  const source = `
export const ThingSchema = z.object({
  type: z.literal("thing"),
  payload: z.object({
    a: z.string().nullable().optional(),
    b: z.string().optional(),
    c: z.string().nullable(),
  }),
});
`;
  const schemas = parseSchemas(source);
  const thing = schemas.get("ThingSchema");
  assert.deepEqual([...thing.fields].sort(), ["a", "b", "c"]);
  assert.deepEqual([...thing.optional].sort(), ["a", "b"]);
  assert.deepEqual([...thing.nullable].sort(), ["a", "c"]);
});

// Sending null to an optional-not-nullable field fails the whole response, which is how
// projectIconRevision and runtimeInfo each broke the agent list once.
test("flags null sent to an optional-but-not-nullable field", () => {
  const protocolSource = `
export const GreetResponseSchema = z.object({
  type: z.literal("greet_response"),
  payload: z.object({
    requestId: z.string(),
    note: z.string().optional(),
    detail: z.string().nullable().optional(),
  }),
});
`;
  const { nulledOptional } = runAuditWith(
    protocolSource,
    `
      _ = sendSessionMsg(ctx, sink, "greet_response", map[string]any{
          "requestId": req.RequestID,
          "note":      nil,
          "detail":    nil,
      })
  `,
  );
  assert.deepEqual(
    nulledOptional.map((row) => `${row.type}.${row.field}`),
    ["greet_response.note"],
    "note is optional-not-nullable and must be flagged; detail is nullable and must not be",
  );
});

// The real repository must stay clean on this check.
test("the repository sends no null for optional-not-nullable fields", async () => {
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync(process.execPath, ["scripts/go-emit-parity.mjs", "--json"], {
    encoding: "utf8",
    cwd: new URL("..", import.meta.url).pathname,
  });
  const report = JSON.parse(out);
  assert.deepEqual(report.nulledOptional, []);
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.neverSent, []);
});

function runAuditWith(protocolSource, goSnippet) {
  return auditFromSources({ protocolSource, goSource: goSnippet });
}
