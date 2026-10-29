// Extracts the CLI surface the node build shipped, and the surface the Go build offers now.
//
// The port is a rewrite, not a redesign: every command and subcommand the node CLI accepted has to
// still exist, because they are in scripts, in docs, and in people's fingers. This comparison is a
// guard against the failure mode that actually happened — four commands quietly went missing and
// nobody noticed until someone typed one of them.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith(".ts") && !path.endsWith(".test.ts") && !path.endsWith(".d.ts")) {
      out.push(path);
    }
  }
  return out;
}

// nodeSurface reads `archive/packages/cli`: top-level commands come from cli.ts, and each command
// group registers its own subcommands in commands/<group>/index.ts.
export function nodeSurface(root = repoRoot) {
  const cliDir = join(root, "archive", "packages", "cli", "src");
  if (!existsSync(cliDir)) {
    const snap = JSON.parse(
      readFileSync(join(repoRoot, "scripts", "node-surface-snapshot.json"), "utf8"),
    );
    return snap.cli;
  }
  const cliSource = readFileSync(join(cliDir, "cli.ts"), "utf8");

  const topLevel = new Set();
  for (const match of cliSource.matchAll(/program\s*\.\s*command\(\s*["']([a-z][a-z0-9-]*)/g)) {
    topLevel.add(match[1]);
  }
  // `program.addCommand(daemonStartCommand())` registers a command whose name lives in the
  // builder, not in this file. Both are real top-level commands in the node CLI.
  for (const name of ["daemon", "onboard"]) topLevel.add(name);

  const groups = {};
  for (const file of walk(join(cliDir, "commands"))) {
    // paths look like .../src/commands/<group>/<file>.ts; split on the separator, not on a
    // path fragment, or every file lands in one unnamed group.
    const segments = file.split(/[\\/]/);
    const marker = segments.lastIndexOf("commands");
    if (marker < 0 || segments.length < marker + 3) continue;
    const group = segments[marker + 1];
    const source = readFileSync(file, "utf8");
    const pattern = new RegExp(`\\b${group}\\s*\\.\\s*command\\(\\s*["']([a-z][a-z0-9-]*)`, "g");
    for (const match of source.matchAll(pattern)) {
      groups[group] ??= new Set();
      groups[group].add(match[1]);
    }
  }

  return {
    topLevel: [...topLevel].sort(),
    groups: Object.fromEntries(
      Object.keys(groups)
        .sort()
        .map((group) => [group, [...groups[group]].sort()]),
    ),
  };
}

// goSurface reads `internal/cli/main.go`. Only the dispatch switch counts: the usage text is a
// summary that drifts, and reading it is how the first audit produced a false report.
export function goSurface(root = repoRoot) {
  const source = readFileSync(join(root, "internal", "cli", "main.go"), "utf8");
  const dispatch = source.match(/func Main\([\s\S]*?\n\}/);
  if (!dispatch) throw new Error("internal/cli/main.go: could not find func Main");

  const topLevel = new Set();
  // A case may list several literals: `case "heartbeat", "schedule":`.
  for (const match of dispatch[0].matchAll(/case\s+((?:"[^"]*"\s*,\s*)*"[^"]*")\s*:/g)) {
    for (const literal of match[1].matchAll(/"([^"]*)"/g)) {
      // Flags are dispatched before the switch and handled as top-level cases.
      if (literal[1].startsWith("-")) continue;
      topLevel.add(literal[1]);
    }
  }

  // The command groups live in several files (commands_extra.go, commands_parity.go, ...), so the
  // dispatch tables are collected across the whole package. Reading only main.go reported every
  // group as empty, which is the same false-negative as reading the usage text.
  const cliDir = join(root, "internal", "cli");
  const packageSource = readdirSync(cliDir)
    .filter((name) => name.endsWith(".go") && !name.endsWith("_test.go"))
    .map((name) => readFileSync(join(cliDir, name), "utf8"))
    .join("\n");
  const groups = {};
  for (const [group, names] of Object.entries(groupDispatchTables(packageSource))) {
    groups[group] = [...names].sort();
  }

  return { topLevel: [...topLevel].sort(), groups };
}

// groupDispatchTables finds the switch inside each `run<Group>Cmd` function.
//
// Every command group in internal/cli is one function with a `switch sub` inside it. Reading those
// switches is the only way to know what a group accepts — the same mistake as reading only
// single-literal cases would report a group as missing commands it has.
export function groupDispatchTables(source) {
  const tables = {};
  const functions = source.matchAll(/func run(\w+?)(?:Group)?Cmd\([\s\S]*?\n\}\n/g);
  for (const fn of functions) {
    const name = fn[1].toLowerCase();
    const body = fn[0];
    const names = new Set();
    for (const match of body.matchAll(/case\s+((?:"[^"]*"\s*,\s*)*"[^"]*")\s*:/g)) {
      for (const literal of match[1].matchAll(/"([^"]*)"/g)) {
        if (literal[1].startsWith("-")) continue;
        names.add(literal[1]);
      }
    }
    if (names.size > 0) tables[name] = names;
  }
  // The agent commands live in runAgentGroupCmd, which the regex above catches as "agent".
  // heartbeat and schedule share one function; both names map to the same table.
  if (tables.heartbeat) tables.schedule ??= tables.heartbeat;
  return tables;
}

// surfaceGaps reports what the node CLI accepted and the Go CLI does not.
export function surfaceGaps(root = repoRoot) {
  const node = nodeSurface(root);
  const go = goSurface(root);

  const missingTopLevel = node.topLevel.filter((name) => !go.topLevel.includes(name));
  const missingSubcommands = {};
  for (const [group, names] of Object.entries(node.groups)) {
    const available = go.groups[group] ?? [];
    const missing = names.filter((name) => !available.includes(name));
    if (missing.length > 0) missingSubcommands[group] = missing;
  }
  return { missingTopLevel, missingSubcommands };
}
