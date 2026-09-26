/**
 * Building the tool-guard extension a worker's Pi session loads.
 *
 * The guard rules existed as data with an engine and zero callers, for a
 * structural reason found rather than guessed at: a worker's shell commands
 * never pass through the daemon. Pi executes them itself, and the daemon's
 * permission path only sees Pi's interactive questions — by the time
 * `tool_execution_start` arrives, the command is already running. There is
 * nothing upstream of the shell on this side of the process boundary to hook.
 *
 * The one place upstream of execution is inside the Pi process, as an
 * extension: a `tool_call` handler that returns `{ block, reason }` stops the
 * tool before it runs. So the guard ships as generated extension code carrying
 * the compiled rules, and is loaded only for sessions launched with a worker
 * identity, which arrives as `BYSPACE_WORKER_ID` in the launch environment —
 * the same signal the runner already uses to mark a session as a worker's.
 *
 * Both severities block in this first wiring. CRITICAL blocks by the engine's
 * contract; HIGH maps to "confirm with a human", and inside a worker session
 * there is no human to ask, so it blocks with the reason saying what to do
 * rather than blocking silently or letting the command run unconfirmed. The
 * reason is returned to the model as a tool result it can act on — the rules
 * carry a remediation line precisely so a blocked worker knows the safe path.
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadGuardRules } from "./tool-guard/tool-guard.js";

/** A temp extension file plus the cleanup that removes it. */
export interface GuardExtensionFile {
  path: string;
  cleanup: () => void;
}

/**
 * Write the guard extension and return its path.
 *
 * The rules are embedded as JSON at generation time rather than read at session
 * start: the file is self-contained, so a session cannot end up running guard
 * code against rules that drifted since the daemon booted. A rule-load failure
 * is raised here, at daemon startup — an extension with silently missing rules
 * is a guard that looks armed and isn't.
 */
export function createWorkerGuardExtensionFile(): GuardExtensionFile {
  const rules = loadGuardRules();
  const dir = mkdtempSync(path.join(tmpdir(), "byspace-worker-guard-"));
  const filePath = path.join(dir, "worker-tool-guard.mjs");

  writeFileSync(filePath, extensionSource(rules), {
    encoding: "utf8",
    mode: 0o600,
  });

  return {
    path: filePath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

interface SerializableRule {
  id: string;
  severity: string;
  patterns: string[];
  excludePatterns: string[];
  description: string;
  remediation: string;
}

function extensionSource(rules: ReturnType<typeof loadGuardRules>): string {
  const serializable: SerializableRule[] = rules.map((rule) => ({
    id: rule.id,
    severity: rule.severity,
    patterns: rule.patterns.map((pattern) => pattern.source),
    excludePatterns: rule.excludePatterns.map((pattern) => pattern.source),
    description: rule.description,
    remediation: rule.remediation,
  }));

  return `const RULES = ${JSON.stringify(serializable, null, 2)};

function commandFor(toolName, input) {
  if (toolName !== "bash" && toolName !== "powershell") return null;
  const command = typeof input?.command === "string" ? input.command : input?.cmd;
  return typeof command === "string" ? command : null;
}

// Single-quoted spans are ignored when matching, mirroring the daemon-side
// engine: quoting is the shell's quoting, and a guard that matched inside it
// would fire on prose.
function stripSingleQuotedSpans(command) {
  let out = "";
  let inSingle = false;
  for (const ch of command) {
    if (ch === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle) out += ch;
  }
  return out;
}

export default function workerToolGuard(pi) {
  pi.on("tool_call", (event) => {
    const command = commandFor(event.toolName, event.input);
    if (command === null) return;

    const scannable = stripSingleQuotedSpans(command);
    const compiled = RULES.map((rule) => ({
      id: rule.id,
      severity: rule.severity,
      description: rule.description,
      remediation: rule.remediation,
      patterns: rule.patterns.map((source) => new RegExp(source)),
      excludes: rule.excludePatterns.map((source) => new RegExp(source)),
    }));

    const findings = [];
    for (const rule of compiled) {
      if (rule.excludes.some((pattern) => pattern.test(scannable))) continue;
      if (rule.patterns.some((pattern) => pattern.test(scannable))) {
        findings.push(rule);
      }
    }
    if (findings.length === 0) return;

    const worst = findings.find((finding) => finding.severity === "CRITICAL") ?? findings[0];
    const critical = worst.severity === "CRITICAL";
    const listing = findings
      .map((finding) => \`- [\${finding.severity}] \${finding.id}: \${finding.description}\`)
      .join("\\n");
    const remediation = findings[0].remediation;

    return {
      block: true,
      terminate: false,
      reason:
        \`Blocked by the worker tool guard.\n\n\${listing}\n\n\` +
        \`\${remediation}\n\n\` +
        (critical
          ? "This command is refused outright by the daemon's guard rules."
          : "This command needs a human's confirmation, and no human is attached to a worker session, so it is refused. Report what you were trying to do and let the operator run it."),
    };
  });
}
`;
}
