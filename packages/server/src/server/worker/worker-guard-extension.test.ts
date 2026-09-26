/**
 * Tests for the guard extension a worker's Pi session loads.
 *
 * The extension is generated code carrying compiled rules, so what to pin is
 * what it promises at its boundary: the rules actually embedded, the handler
 * actually blocking what the daemon-side engine blocks, and the file cleaned up
 * afterwards — a temp file left behind is a rule set accumulating in tmpdirs.
 */
import { readFileSync, existsSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { loadGuardRules } from "./tool-guard/tool-guard.js";
import {
  createWorkerGuardExtensionFile,
  type GuardExtensionFile,
} from "./worker-guard-extension.js";

let extension: GuardExtensionFile | null = null;

afterEach(() => {
  extension?.cleanup();
  extension = null;
});

describe("worker guard extension", () => {
  it("embeds every compiled rule", () => {
    // A rule missing from the generated file is a guard that looks armed and
    // isn't, so the count is the contract.
    extension = createWorkerGuardExtensionFile();
    const source = readFileSync(extension.path, "utf8");
    const ruleCount = loadGuardRules().length;
    expect(source.match(/"id": "TOOL_CMD_/g)).toHaveLength(ruleCount);
  });

  it("registers a tool_call handler that can block", () => {
    extension = createWorkerGuardExtensionFile();
    const source = readFileSync(extension.path, "utf8");
    expect(source).toContain('pi.on("tool_call"');
    // The blocking contract of the handler: it returns block, so the file must
    // produce that shape rather than only logging.
    expect(source).toContain("block: true");
  });

  it("is self-contained: no imports of daemon modules", () => {
    // The extension runs inside the Pi process with no access to this package's
    // modules; anything it needs has to be in the file itself.
    extension = createWorkerGuardExtensionFile();
    const source = readFileSync(extension.path, "utf8");
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/require\(/);
  });

  it("removes its file on cleanup", () => {
    const file = createWorkerGuardExtensionFile();
    const path = file.path;
    expect(existsSync(path)).toBe(true);
    file.cleanup();
    expect(existsSync(path)).toBe(false);
  });

  it("ignores single-quoted spans the way the engine does", () => {
    // The daemon-side engine does not match inside single quotes; a guard that
    // did would fire on prose and teach workers to route around it with quotes.
    extension = createWorkerGuardExtensionFile();
    const source = readFileSync(extension.path, "utf8");
    expect(source).toContain("stripSingleQuotedSpans");
  });

  it("says what to do about a HIGH rule, not only that it blocked", () => {
    // HIGH maps to "confirm with a human", and no human is attached to a worker
    // session, so the reason must carry the remediation rather than a bare
    // refusal — a blocked worker that does not know the safe path is stuck.
    extension = createWorkerGuardExtensionFile();
    const source = readFileSync(extension.path, "utf8");
    expect(source).toContain("remediation");
    expect(source).toContain("no human is attached to a worker session");
  });
});
