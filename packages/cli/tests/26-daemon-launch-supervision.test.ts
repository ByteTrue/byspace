#!/usr/bin/env npx tsx

/**
 * Regression: executable daemon launch commands must enter the supervisor.
 * The worker entry remains an implementation detail of supervisor-entrypoint.
 */

import assert from "node:assert";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";

const repoRoot = join(import.meta.dirname, "../../..");
const serverPackagePath = join(repoRoot, "packages/server/package.json");
const appGlobalSetupPath = join(repoRoot, "packages/app/e2e/global-setup.ts");
const serverConnectionOfferE2ePath = join(
  repoRoot,
  "packages/server/src/server/daemon-e2e/connection-offer.e2e.test.ts",
);
const nixPackagePath = join(repoRoot, "nix/package.nix");
const nixModulePath = join(repoRoot, "nix/module.nix");
const flakePath = join(repoRoot, "flake.nix");
const traceDaemonPath = join(repoRoot, "scripts/trace-daemon.mjs");
const execFileAsync = promisify(execFile);

const expectedSkillTracePaths = [
  "packages/server/dist/server/skills/byspace-advisor/SKILL.md",
  "packages/server/dist/server/skills/byspace-committee/SKILL.md",
  "packages/server/dist/server/skills/byspace-handoff/SKILL.md",
  "packages/server/dist/server/skills/byspace-plugin/SKILL.md",
  "packages/server/dist/server/skills/byspace-project-setup/SKILL.md",
  "packages/server/dist/server/skills/byspace-project-setup/references/byspace-json.md",
  "packages/server/dist/server/skills/byspace-project-setup/references/project-readiness.md",
  "packages/server/dist/server/skills/byspace/SKILL.md",
];

async function collectFiles(root: string, directory = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(root, absolutePath)));
    } else {
      files.push(relative(root, absolutePath).split(sep).join("/"));
    }
  }
  return files.sort();
}

function assertNoDirectWorkerLaunch(label: string, command: string): void {
  assert(
    !command.includes("src/server/index.ts"),
    `${label} must not launch src/server/index.ts directly: ${command}`,
  );
  assert(
    !command.includes("dist/server/server/index.js"),
    `${label} must not launch dist/server/server/index.js directly: ${command}`,
  );
  assert(
    !command.includes("src/server/daemon-worker.ts"),
    `${label} must not launch src/server/daemon-worker.ts directly: ${command}`,
  );
  assert(
    !command.includes("dist/server/server/daemon-worker.js"),
    `${label} must not launch dist/server/server/daemon-worker.js directly: ${command}`,
  );
}

function assertNoSpawnedWorkerEntrypoint(label: string, source: string): void {
  assertNoDirectWorkerLaunch(label, source);
  assert(
    !/spawn\([^)]*["'`][^"'`]*\.\.\/index\.ts["'`]/s.test(source),
    `${label} must not spawn ../index.ts directly`,
  );
}

console.log("=== Daemon Launch Supervision Regression ===\n");

console.log("Test 1: server package scripts launch supervisor-entrypoint");
const serverPackage = JSON.parse(await readFile(serverPackagePath, "utf-8")) as {
  scripts?: Record<string, string>;
};
const startScript = serverPackage.scripts?.start ?? "";
const devScript = serverPackage.scripts?.dev ?? "";
const devTsxScript = serverPackage.scripts?.["dev:tsx"] ?? "";

assert(startScript.includes("dist/scripts/supervisor-entrypoint.js"), startScript);
assertNoDirectWorkerLaunch("server start script", startScript);
assert(devScript.includes("scripts/dev-runner.ts"), devScript);
assertNoDirectWorkerLaunch("server dev script", devScript);
assert(devTsxScript.includes("scripts/dev-runner.ts"), devTsxScript);
assertNoDirectWorkerLaunch("server dev:tsx script", devTsxScript);
console.log("✓ server package scripts enter supervisor\n");

console.log("Test 2: app e2e global setup launches supervisor-entrypoint in dev mode");
const appGlobalSetup = await readFile(appGlobalSetupPath, "utf-8");
assert(
  appGlobalSetup.includes('spawn(tsxBin, ["scripts/supervisor-entrypoint.ts", "--dev"]'),
  "app e2e setup should spawn supervisor-entrypoint.ts with --dev",
);
assertNoSpawnedWorkerEntrypoint("app e2e global setup", appGlobalSetup);
console.log("✓ app e2e setup enters supervisor\n");

console.log("Test 3: server daemon e2e process launch enters supervisor");
const serverConnectionOfferE2e = await readFile(serverConnectionOfferE2ePath, "utf-8");
assert(
  serverConnectionOfferE2e.includes("scripts/supervisor-entrypoint.ts"),
  "server daemon e2e process launch should use supervisor-entrypoint.ts",
);
assertNoSpawnedWorkerEntrypoint("server daemon e2e process launch", serverConnectionOfferE2e);
console.log("✓ server daemon e2e process launch enters supervisor\n");

console.log("Test 4: Nix wrapper points at supervisor-entrypoint without leaking runtime env");
const nixPackage = await readFile(nixPackagePath, "utf-8");
assert(
  nixPackage.includes("dist/scripts/supervisor-entrypoint.js"),
  "Nix byspace-server wrapper should use dist/scripts/supervisor-entrypoint.js",
);
assertNoDirectWorkerLaunch("Nix package wrapper", nixPackage);
assert(
  nixPackage.includes("--set BYSPACE_NODE_ENV production"),
  "Nix byspace-server wrapper should keep daemon runtime mode BySpace-scoped",
);
assert(
  !/--set(-default)?\s+NODE_ENV\b/.test(nixPackage),
  "Nix byspace-server wrapper must not set generic NODE_ENV",
);

const nixModule = await readFile(nixModulePath, "utf-8");
assert(!/\bNODE_ENV\b\s*=/.test(nixModule), "NixOS module must not set generic NODE_ENV");
assert(
  !/\bBYSPACE_NODE_ENV\b/.test(nixModule),
  "NixOS module must not duplicate the packaged daemon runtime mode",
);
console.log("✓ Nix wrapper enters supervisor without leaking runtime env\n");

console.log("Test 5: Nix source filter has included/excluded path checks");
for (const excludedPrefix of ["docs", ".github", ".agents", ".claude", ".codex", "docker"]) {
  assert(
    nixPackage.includes(`lib.hasPrefix "/${excludedPrefix}" relPath`),
    `Nix source filter should exclude ${excludedPrefix}`,
  );
}
assert(
  nixPackage.includes('builtins.match "/[^/]+\\\\.md" relPath == null'),
  "Nix source filter should exclude only top-level Markdown",
);

const flake = await readFile(flakePath, "utf-8");
assert(flake.includes('source-filter = pkgs.runCommand "byspace-nix-source-filter"'));
assert(flake.includes("package = byspace;"), "Nix flake checks should build the filtered package");
for (const includedPath of [
  "package-lock.json",
  "scripts/build-daemon-web-ui.mjs",
  "scripts/trace-daemon.mjs",
  "skills/byspace/SKILL.md",
  "packages/app/public/index.html",
  "packages/app/src/app/_layout.tsx",
  "packages/server/src/server/orchestration-skills.ts",
]) {
  assert(flake.includes(includedPath), `Nix source check should require ${includedPath}`);
}
for (const excludedPath of ["docs", ".github", ".agents", ".claude", ".codex", "docker"]) {
  assert(flake.includes(excludedPath), `Nix source check should reject ${excludedPath}`);
}
console.log("✓ Nix source filter has included/excluded path checks\n");

console.log("Test 6: daemon trace installs the exact bundled skill file set");
const tracePrerequisite = join(repoRoot, "packages/server/dist/scripts/supervisor-entrypoint.js");
await stat(tracePrerequisite).catch(() => {
  throw new Error("Daemon trace test requires `npm run build:server` first");
});
const { stdout: traceOutput } = await execFileAsync(process.execPath, [traceDaemonPath], {
  cwd: repoRoot,
  maxBuffer: 16 * 1024 * 1024,
});
const tracedPaths = traceOutput.trim().split("\n");
assert.strictEqual(
  new Set(tracedPaths).size,
  tracedPaths.length,
  "Daemon trace must not contain duplicate paths",
);
for (const file of tracedPaths) {
  const entry = await lstat(join(repoRoot, file));
  assert(
    entry.isFile() || entry.isSymbolicLink(),
    `Daemon trace entries must be files or preserved symlinks, never directories: ${file}`,
  );
}
const skillTracePaths = tracedPaths
  .filter((file) => file.startsWith("packages/server/dist/server/skills/"))
  .sort();
assert.deepStrictEqual(
  skillTracePaths,
  expectedSkillTracePaths,
  "Daemon trace should contain exactly the eight bundled skill files",
);
for (const file of skillTracePaths) {
  assert(
    (await stat(join(repoRoot, file))).isFile(),
    `Daemon trace skill entry must resolve to a regular file: ${file}`,
  );
}

const installRoot = await mkdtemp(join(tmpdir(), "byspace-trace-install-"));
try {
  for (const file of skillTracePaths) {
    const destination = join(installRoot, file);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(repoRoot, file), destination, { recursive: true, preserveTimestamps: true });
  }
  const installedPaths = await collectFiles(installRoot);
  assert.deepStrictEqual(
    installedPaths,
    skillTracePaths,
    "Install copy loop should preserve the traced skill paths one-to-one",
  );
  assert(
    !installedPaths.some((file) => file.includes("/references/references/")),
    "Install copy loop must not create nested references/references paths",
  );
} finally {
  await rm(installRoot, { recursive: true, force: true });
}
console.log("✓ daemon trace installs exactly eight bundled skill files without nesting\n");

console.log("=== Daemon launch supervision regression test passed ===");
