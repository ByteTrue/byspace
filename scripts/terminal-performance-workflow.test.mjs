import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";

const repoRoot = new URL("../", import.meta.url);
const workflowPath = new URL(".github/workflows/ci.yml", repoRoot);
const standaloneWorkflowPath = new URL(
  ".github/workflows/terminal-performance-windows.yml",
  repoRoot,
);

function jobBlock(workflow, jobId, nextJobId) {
  const start = workflow.indexOf(`  ${jobId}:`);
  assert.notEqual(start, -1, `missing ${jobId} job`);
  const end =
    nextJobId === undefined ? workflow.length : workflow.indexOf(`\n  ${nextJobId}:`, start);
  assert.notEqual(end, -1, `missing next job boundary for ${jobId}`);
  return workflow.slice(start, end);
}

test("Windows terminal performance is an opt-in CI job with centralized gating", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const changes = jobBlock(workflow, "changes", "terminal-performance-windows");
  const performance = jobBlock(workflow, "terminal-performance-windows", "format");

  assert.match(workflow, /workflow_dispatch:\n    inputs:\n      terminal_performance:/);
  assert.match(
    workflow,
    /terminal_performance:\n        description: .*\n        required: false\n        type: boolean\n        default: false/,
  );
  assert.match(
    changes,
    /terminal_performance:\s*\$\{\{\s*github\.event_name == 'workflow_dispatch' && inputs\.terminal_performance == true\s*\}\}/,
  );
  for (const output of [
    "full",
    "format",
    "quality",
    "hub",
    "server",
    "desktop",
    "app",
    "sdk",
    "browser",
    "relay",
    "cli",
  ]) {
    assert.match(
      changes,
      new RegExp(`${output}: \\$\\{\\{ inputs\\.terminal_performance != true &&`),
      `${output} is not disabled by terminal_performance`,
    );
  }
  assert.match(performance, /needs\.changes\.outputs\.terminal_performance == 'true'/);
  assert.match(performance, /runs-on:\s+windows-latest/);
  assert.match(performance, /node-version:\s+["']?22\.20\.0["']?/);
  assert.match(performance, /E2E_WORKERS:\s+["']1["']/);
  assert.match(performance, /--workers=1 --retries=0/);
  assert.doesNotMatch(performance, /secrets\.|deploy/i);

  const nodeBenchmark = performance.indexOf("Run Node daemon and PTY benchmark");
  const chromium = performance.indexOf("Install Chromium");
  const direct = performance.indexOf("PASEO_TERMINAL_TRANSPORT: direct");
  const relay = performance.indexOf("PASEO_TERMINAL_TRANSPORT: relay");
  assert.ok(nodeBenchmark >= 0 && nodeBenchmark < chromium);
  assert.ok(chromium < direct && direct < relay);
  assert.match(performance, /run: node --import tsx scripts\/benchmark-terminal-latency\.ts/);
  assert.match(performance, /PASEO_TERMINAL_TRANSPORT: direct/);
  assert.match(performance, /PASEO_TERMINAL_TRANSPORT: relay/);
  assert.equal(performance.match(/e2e\/browser\/terminal-clipboard\.spec\.ts/g)?.length, 2);
  assert.equal(performance.match(/--reporter=line,json/g)?.length, 2);
  assert.match(
    performance,
    /PLAYWRIGHT_JSON_OUTPUT_FILE: \$\{\{ runner\.temp \}\}\/terminal-performance\/direct\/results\.json/,
  );
  assert.match(
    performance,
    /PLAYWRIGHT_JSON_OUTPUT_FILE: \$\{\{ runner\.temp \}\}\/terminal-performance\/relay\/results\.json/,
  );
  assert.match(performance, /upload-artifact@v4/);
  assert.match(performance, /if: always\(\)/);
  assert.match(performance, /--output="\$\{\{ runner\.temp \}\}\/terminal-performance\/direct"/);
  assert.match(performance, /--output="\$\{\{ runner\.temp \}\}\/terminal-performance\/relay"/);
  assert.match(performance, /\$\{\{ runner\.temp \}\}\/paseo-terminal-bench\/\*\*/);
  assert.match(performance, /\$\{\{ runner\.temp \}\}\/terminal-performance\/\*\*/);
  assert.doesNotMatch(performance, /packages\/app\/(?:test-results|playwright-report)\/\*\*/);
  assert.doesNotMatch(performance, /\*\*\/\*\.(?:log|json)/);

  await assert.rejects(access(standaloneWorkflowPath), { code: "ENOENT" });
});
