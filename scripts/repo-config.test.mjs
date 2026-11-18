import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { load as loadYaml } from "js-yaml";
import picomatch from "picomatch";

// Repo configuration names paths: CI routing globs, formatter/linter ignores, hook excludes,
// tsconfig extends. A path that no longer exists is silent — the glob simply never matches, so a
// contract stops running, or an ignore stops protecting a vendored tree, and nothing fails.
// This guard makes the rot loud at CI time.
//
// Only literal path prefixes are checked. A glob's fixed leading segments must exist; the wildcards
// themselves are not resolved (`internal/**` checks `internal/`, `**/*.ts` checks nothing).

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const exists = (relative) => existsSync(join(repoRoot, relative));

// .oxlintrc.json is JSONC (comments inside the overrides), and the repo has no JSONC parser on the
// Node side — the same constraint scripts/relay-worker.test.mjs:26 works around. ignorePatterns is a
// top-level array of quoted strings, which a targeted regex reads without one.
function ignorePatterns(file) {
  const source = readFileSync(join(repoRoot, file), "utf8");
  const match = source.match(/"ignorePatterns"\s*:\s*\[([^\]]*)\]/);
  assert.ok(match, `${file} should declare ignorePatterns`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

// The path a pattern is anchored to: every leading segment without a wildcard. `internal/**` is
// anchored to `internal`, `web/public/schemas/*.json` to `web/public/schemas`, a bare `main.go` to
// itself. A pattern that opens with a wildcard is anchored to nothing and is not checked.
function anchor(pattern) {
  const fixed = [];
  for (const segment of pattern.split("/")) {
    if (/[*?[\]{}!]/.test(segment)) break;
    fixed.push(segment);
  }
  return fixed.join("/");
}

test("ci-paths routing globs name trees that exist", () => {
  const filters = loadYaml(readFileSync(join(repoRoot, ".github/ci-paths.yml"), "utf8"));
  const missing = [];
  for (const [contract, patterns] of Object.entries(filters)) {
    for (const pattern of patterns) {
      const target = anchor(pattern);
      if (target && !exists(target)) missing.push(`${contract}: ${pattern} (missing ${target})`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `ci-paths.yml names paths that do not exist:\n${missing.join("\n")}`,
  );
});

test("every ci-paths contract is consumed by the CI workflow", () => {
  const filters = loadYaml(readFileSync(join(repoRoot, ".github/ci-paths.yml"), "utf8"));
  const workflow = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");
  // A contract is consumed either by a downstream job's gate or inside `changes` itself, where the
  // `full` output folds several contracts into one "run everything" signal.
  const unused = Object.keys(filters).filter(
    (contract) =>
      !workflow.includes(`needs.changes.outputs.${contract}`) &&
      !workflow.includes(`steps.filter.outputs.${contract}`),
  );
  assert.deepEqual(unused, [], `ci-paths contracts nothing reads: ${unused.join(", ")}`);
});

// The other direction is the silent one: a workflow reading a filter output no contract declares
// gets an empty string, and `'' != 'false'` is true — so the gate it guards is permanently open.
test("every filter output the CI workflow reads is declared", () => {
  const filters = loadYaml(readFileSync(join(repoRoot, ".github/ci-paths.yml"), "utf8"));
  const workflow = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");
  const read = [
    ...new Set(
      [...workflow.matchAll(/steps\.filter\.outputs\.([a-zA-Z_]+)/g)].map((match) => match[1]),
    ),
  ];
  const undeclared = read.filter((contract) => !(contract in filters));
  assert.deepEqual(
    undeclared,
    [],
    `ci.yml reads filter outputs with no contract: ${undeclared.join(", ")}`,
  );
});

// oxfmt and oxlint ignore vendored trees; lefthook passes staged paths to them and must exclude the
// same trees, because both tools exit non-zero when every path they receive is ignored. The three
// lists drifting apart is what made staging a shadcn file fail the hook.
test("lefthook excludes cover the formatter and linter ignores", () => {
  const format = ignorePatterns(".oxfmtrc.json");
  const lint = ignorePatterns(".oxlintrc.json");
  const hook = loadYaml(readFileSync(join(repoRoot, "lefthook.yml"), "utf8"));
  const jobs = Object.fromEntries(hook["pre-commit"].jobs.map((job) => [job.name, job]));

  const uncovered = (ignores, jobName) => {
    const excludes = jobs[jobName].exclude ?? [];
    const matchers = excludes.map((pattern) => picomatch(pattern, { dot: true }));
    return ignores.filter((ignored) => {
      // An ignore is covered when some exclude matches a representative file inside it.
      const probe = ignored.replace(/\*\*/g, "probe").replace(/\*/g, "probe");
      return !matchers.some((matches) => matches(probe));
    });
  };

  assert.deepEqual(
    uncovered(format, "format"),
    [],
    "lefthook format exclude misses .oxfmtrc.json ignorePatterns",
  );
  assert.deepEqual(
    uncovered(lint, "lint"),
    [],
    "lefthook lint exclude misses .oxlintrc.json ignorePatterns",
  );
});

// A staged file the job's glob does not match is silently skipped, so the hook passes on a file
// `npm run format` (oxfmt .) and `npm run lint` (oxlint, whole repo) would both process. These sets
// are what each tool accepts, probed by handing it a file of that extension: oxlint answers
// "No files found to lint" for .json, so ci-paths' quality glob is coarser than this list.
const OXFMT_EXTENSIONS = "cjs,css,html,js,json,jsonc,jsx,md,mjs,ts,tsx,yaml,yml".split(",");
const OXLINT_EXTENSIONS = "cjs,js,jsx,mjs,ts,tsx".split(",");

test("lefthook globs cover every extension the tools process", () => {
  const hook = loadYaml(readFileSync(join(repoRoot, "lefthook.yml"), "utf8"));
  const jobs = Object.fromEntries(hook["pre-commit"].jobs.map((job) => [job.name, job]));

  const missing = (extensions, jobName) => {
    const glob = jobs[jobName].glob.match(/\.\{([^}]+)\}$/);
    assert.ok(glob, `lefthook ${jobName} glob should enumerate extensions`);
    const covered = new Set(glob[1].split(","));
    return extensions.filter((extension) => !covered.has(extension));
  };

  assert.deepEqual(
    missing(OXFMT_EXTENSIONS, "format"),
    [],
    "lefthook format glob skips extensions oxfmt processes",
  );
  assert.deepEqual(
    missing(OXLINT_EXTENSIONS, "lint"),
    [],
    "lefthook lint glob skips extensions oxlint processes",
  );
});

// oxfmt handles JS/TS/JSON/MD; Go has its own formatter, and CI's format job runs `gofmt -l` over
// main.go, internal and workers. A hook that only calls oxfmt lets Go changes commit unformatted —
// d5519d14e reached main that way and CI went red on two files nobody had touched in that commit.
test("lefthook checks Go formatting the way CI does", () => {
  const hook = loadYaml(readFileSync(join(repoRoot, "lefthook.yml"), "utf8"));
  const jobs = hook["pre-commit"].jobs;
  const go = jobs.find((job) => /\bgofmt\b/.test(job.run ?? ""));
  assert.ok(go, "no pre-commit job runs gofmt, so Go formatting is only caught in CI");
  assert.match(go.glob ?? "", /\bgo\b/, "the gofmt job should be scoped to Go files");

  // CI checks these roots. The hook only sees staged files, so the contract is that its glob picks
  // up a Go file anywhere CI looks — not that it repeats the root list.
  const ci = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");
  const ciRoots = ci
    .match(/gofmt -l ([^\n"`]+)/)?.[1]
    .trim()
    .split(/\s+/);
  assert.ok(ciRoots, "CI should run gofmt -l over named roots");
  // lefthook matches a slashless glob against the basename (verified: `*.go` picked up
  // internal/zz_gofmt_probe.go), so picomatch needs matchBase to model it.
  const matches = picomatch(go.glob, { dot: true, matchBase: true });
  for (const root of ciRoots) {
    const probe = root.endsWith(".go") ? root : `${root}/probe.go`;
    assert.ok(matches(probe), `the gofmt glob skips ${probe}, which CI checks`);
  }
});

test("formatter and linter ignores name trees that exist", () => {
  const patterns = [...ignorePatterns(".oxfmtrc.json"), ...ignorePatterns(".oxlintrc.json")];
  const missing = [];
  for (const pattern of new Set(patterns)) {
    const target = anchor(pattern);
    if (target && !exists(target)) missing.push(`${pattern} (missing ${target})`);
  }
  assert.deepEqual(missing, [], `formatter/linter ignores name paths that do not exist`);
});

// AGENTS.md is the entry point: its repo map and docs table are how a reader finds anything. A root
// directory or a docs/ file missing from it is invisible — the file exists, nothing points at it.
test("AGENTS.md names every root directory and every doc", () => {
  const agents = readFileSync(join(repoRoot, "AGENTS.md"), "utf8");
  const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

  const roots = new Set(
    tracked.filter((path) => path.includes("/")).map((path) => path.split("/")[0]),
  );
  // Not repo structure: tool state and the vendored PTY's own build dir.
  const skip = new Set([".github", ".agents"]);
  const unnamed = [...roots]
    .filter(
      (root) =>
        !skip.has(root) && !agents.includes(`\`${root}\``) && !agents.includes(`\`${root}/`),
    )
    .sort();
  assert.deepEqual(unnamed, [], `AGENTS.md repo map omits: ${unnamed.join(", ")}`);

  const undocumented = tracked
    .filter((path) => path.startsWith("docs/") && path.endsWith(".md"))
    .filter((path) => !agents.includes(`(${path})`))
    .sort();
  assert.deepEqual(undocumented, [], `AGENTS.md docs table omits: ${undocumented.join(", ")}`);
});

// A gitignore entry for a tree that is *supposed* to be absent (`/relay`, `local.properties`) is the
// point of the entry and stays. One naming a retired workspace is dead weight that reads as if the
// workspace still ships: check every entry under a workspace root against the workspaces list.
test("gitignore does not name retired workspaces", () => {
  const workspaces = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).workspaces;
  const roots = [...new Set(workspaces.map((entry) => entry.split("/")[0]))];
  const stale = readFileSync(join(repoRoot, ".gitignore"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"))
    .map((line) => line.replace(/^\//, ""))
    .filter((line) => {
      if (!roots.some((root) => line.startsWith(`${root}/`))) return false;
      return !workspaces.some(
        (workspace) => line === workspace || line.startsWith(`${workspace}/`),
      );
    });
  assert.deepEqual(
    stale,
    [],
    `.gitignore names paths under retired workspaces:\n${stale.join("\n")}`,
  );
});
