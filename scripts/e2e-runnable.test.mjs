import assert from "node:assert/strict";
import { test } from "node:test";

// The classifier exists because a hand-written list of "specs that need the Node mock provider" was wrong twice,
// and each wrong version produced ~26 failures that looked exactly like real defects. These cases pin the three
// shapes that were missed.
const { classifyForTest } = await import("./e2e-runnable.mjs?test");

test("direct mock provider reference", () => {
  assert.equal(classifyForTest("x.spec.ts", `provider: "mock"`), "MOCK_PROVIDER");
});

test("mock identified by model name, not by provider", () => {
  // The first list only matched `provider: "mock"` and missed specs that pick a mock model.
  assert.equal(
    classifyForTest("x.spec.ts", `await selectModel(page, "one-minute-stream");`),
    "MOCK_PROVIDER(one-minute-stream)",
  );
});

test("mock reached through a helper import", () => {
  // The second list missed specs that import the helper rather than naming the provider. The file NAME is the
  // evidence: a helper called `mock-agent.ts` cannot be provider-agnostic.
  const mockHelper = [{ name: "mock-agent.ts", path: "/dev/null", text: "" }];
  assert.equal(
    classifyForTest(
      "x.spec.ts",
      `import { seedMockAgentWorkspace } from "../helpers/mock-agent";`,
      mockHelper,
    ),
    "MOCK_PROVIDER",
  );

  const pagination = [{ name: "timeline-pagination.ts", path: "/dev/null", text: "" }];
  assert.equal(
    classifyForTest(
      "x.spec.ts",
      `import { seedLongMockAgentTimeline } from ".../timeline-pagination";`,
      pagination,
    ),
    "MOCK_PROVIDER",
  );
});

test("a helper that merely mentions mock in prose does not count", () => {
  // archive-tab.ts is documented as "unlike the mock provider" while it uses provider: "opencode".
  const helper = [
    {
      name: "archive-tab.ts",
      path: "/dev/null",
      text: `// unlike the mock provider, this one is real\ncreateAgent({ provider: "opencode" })`,
    },
  ];
  assert.equal(classifyForTest("x.spec.ts", "", helper), "EXTERNAL_CLI(opencode)");
});

test("real specs and external CLIs are named separately", () => {
  assert.equal(classifyForTest("x.real.spec.ts", `anything`), "REAL");
  assert.equal(
    classifyForTest("x.spec.ts", "", [
      { name: "h.ts", path: "/dev/null", text: `provider: "codex"` },
    ]),
    "EXTERNAL_CLI(codex)",
  );
});

test("a pi-only spec is runnable", () => {
  assert.equal(classifyForTest("x.spec.ts", `provider: "pi"`), "RUNNABLE");
});
