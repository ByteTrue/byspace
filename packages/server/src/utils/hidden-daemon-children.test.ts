import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const serverRoot = fileURLToPath(new URL("../..", import.meta.url));

const CALL_NAMES = [
  "spawn",
  "fork",
  "exec",
  "execFile",
  "execFileSync",
  "execSync",
  "spawnSync",
] as const;

// Only binaries that cannot exist on Windows may be listed: a listed name is
// skipped by the rule below, so a Windows call site hiding behind one would
// re-open the console-window issue 053 removed.
const POSIX_ONLY = new Set(["launchctl", "systemctl", "loginctl", "dscl", "security"]);

const GUARDED_DIRS = ["src"];
const GUARDED_FILES = ["scripts/supervisor.ts", "scripts/supervisor-entrypoint.ts"];

function runtimeSources(): string[] {
  const files: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) files.push(path);
    }
  }
  for (const dir of GUARDED_DIRS) walk(join(serverRoot, dir));
  files.push(...GUARDED_FILES.map((file) => join(serverRoot, file)));
  return files;
}

function importedChildProcessNames(source: string): string[] {
  const runtimeImport = /import\s+(?!type\s)[^;]*?from\s+["'](?:node:)?child_process["'];/g;
  const names: string[] = [];
  for (const match of source.matchAll(runtimeImport)) {
    const braces = match[0].match(/\{([^}]*)\}/);
    for (const part of (braces?.[1] ?? "").split(",")) {
      const trimmed = part.replace(/^\s*type\s+/, "").trim();
      if (!trimmed) continue;
      const local = trimmed
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (local && (CALL_NAMES as readonly string[]).includes(local)) names.push(local);
    }
  }
  // `const execFileAsync = promisify(execFile)` keeps the hiding requirement on the alias.
  for (const alias of source.matchAll(/const\s+(\w+)\s*=\s*promisify\(\s*(\w+)\s*\)/g)) {
    if (names.includes(alias[2] ?? "")) names.push(alias[1] ?? "");
  }
  return names;
}

function argSpans(source: string, openParen: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = "";
  let quote = "";
  for (let i = openParen + 1; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (char === quote && source[i - 1] !== "\\") quote = "";
      current += char;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(" || char === "{" || char === "[") depth++;
    if (char === ")" || char === "}" || char === "]") {
      if (depth === 0) {
        args.push(current);
        return args;
      }
      depth--;
    }
    if (char === "," && depth === 0) {
      args.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  return [];
}

function hidesConsole(source: string, args: string[]): boolean {
  for (const arg of args) {
    if (/windowsHide:\s*true/.test(arg)) return true;
    const identifier = arg.trim();
    if (!/^[A-Za-z_$][\w$]*$/.test(identifier)) continue;
    const declared = source.search(new RegExp(`(?:const|let|var)\\s+${identifier}\\b`));
    if (declared < 0) continue;
    const body = source.slice(declared, declared + 1200);
    const end = body.search(/\n\s*(?:\}|\);)/);
    if (/windowsHide:\s*true/.test(end > 0 ? body.slice(0, end) : body)) return true;
  }
  return false;
}

interface CallSite {
  file: string;
  line: number;
  call: string;
  posixOnly: boolean;
  hidden: boolean;
}

function childProcessCallSites(): CallSite[] {
  const sites: CallSite[] = [];
  for (const path of runtimeSources()) {
    const source = readFileSync(path, "utf8");
    const names = importedChildProcessNames(source);
    if (names.length === 0) continue;
    for (const name of names) {
      const callPattern = new RegExp(`(?:^|[^\\w$.])(${name})\\s*(?=\\()`, "g");
      for (const match of source.matchAll(callPattern)) {
        const at = (match.index ?? 0) + match[0].indexOf(name);
        const lineStart = source.lastIndexOf("\n", at) + 1;
        const before = source.slice(lineStart, at);
        if (before.includes("//") || before.trimStart().startsWith("*")) continue;
        const args = argSpans(source, source.indexOf("(", at));
        if (args.length === 0 || (args.length === 1 && !args[0].trim())) continue;
        const command = args[0].trim().replace(/^["'`]|["'`]$/g, "");
        sites.push({
          file: relative(serverRoot, path).replaceAll("\\", "/"),
          line: source.slice(0, at).split("\n").length,
          call: `${name}(${command.slice(0, 32) || "…"})`,
          command,
          posixOnly: POSIX_ONLY.has(command),
          hidden: hidesConsole(source, args),
        });
      }
    }
  }
  return sites;
}

describe("daemon-side child consoles", () => {
  // The daemon runs detached with no console, so Windows allocates a visible one
  // for any child it starts. docs/qa.md asks for a test that fails on the broken
  // code: dropping any of the `windowsHide: true` flags issue 053 added re-opens it.
  test("every daemon-side child_process call hides its console", () => {
    const unhidden = childProcessCallSites().filter((site) => !site.posixOnly && !site.hidden);
    expect(unhidden).toEqual([]);
  });

  test("scan reaches the call sites issue 053 hid", () => {
    const hidden = childProcessCallSites()
      .filter((site) => site.hidden)
      .map((site) => `${site.file}:${site.call}`);
    expect(hidden).toEqual(
      expect.arrayContaining([
        "scripts/supervisor.ts:spawn(spawnSpec.command)",
        "scripts/supervisor.ts:fork(workerEntry)",
        "src/terminal/worker-terminal-manager.ts:fork(fileURLToPath(resolveWorkerUrl())",
        "src/server/session/daemon/daemon-service-manager.ts:execFileSync(powershell.exe)",
        "src/utils/tree-kill.ts:execFile(taskkill.exe)",
        "src/utils/spawn.ts:spawn(resolvedCommand)",
      ]),
    );
  });

  // The allowlist is what keeps the first test from being weakened by adding a
  // name to it, so both directions are locked: a new exempted call site has to
  // be listed here, and an allowlisted binary nobody calls is a dead exemption.
  test("POSIX-only exemptions stay on the known call sites", () => {
    const sites = childProcessCallSites();
    const exempted = sites.filter((site) => site.posixOnly);
    expect(exempted.map((site) => `${site.file}:${site.call}`).sort()).toEqual([
      "src/server/session/daemon/daemon-service-install.ts:spawnSync(launchctl)",
      "src/server/session/daemon/daemon-service-install.ts:spawnSync(systemctl)",
      "src/server/session/daemon/daemon-service-install.ts:spawnSync(systemctl)",
      "src/server/session/daemon/daemon-service-manager.ts:execFileSync(launchctl)",
      "src/server/session/daemon/daemon-service-manager.ts:execFileSync(loginctl)",
      "src/server/session/daemon/daemon-service-manager.ts:execFileSync(systemctl)",
      "src/services/quota-fetcher/providers/claude.ts:execFileAsync(security)",
      "src/terminal/shell-detect.ts:execFile(dscl)",
    ]);
    for (const binary of POSIX_ONLY) {
      expect(
        exempted.map((site) => site.command),
        `${binary} is exempted but never called`,
      ).toContain(binary);
    }
  });
});
