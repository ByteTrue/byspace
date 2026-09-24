/**
 * Tool guard: decides whether a worker's tool call is safe to run, needs a
 * human, or must be refused.
 *
 * This is the second half of the worker domain's permission story. The first
 * half is `assertNotSelfPermissionApproval`, which stops an agent approving its
 * own request. This decides what is worth asking about in the first place.
 *
 * Rule data is ported from QwenPaw (agentscope-ai/QwenPaw, Apache-2.0) rather
 * than written here, because those patterns encode years of shell footguns. See
 * `rules.json` for provenance and `byissue/epics/004-o-worker-domain/` for why.
 *
 * Deliberate scope: this evaluates a command string. It does not parse shell
 * grammar. Quote-aware scanning is approximated faithfully enough to catch the
 * cases the ported rules care about, but a determined evader is out of scope —
 * the approval gate, not this matcher, is the boundary that has to hold.
 */
import { z } from "zod";

import rulesDocument from "./rules.json" with { type: "json" };

export const GUARD_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const;
export type GuardSeverity = (typeof GUARD_SEVERITIES)[number];

/**
 * What the caller should do about a set of findings.
 *
 * `block` and `confirm` are not severity synonyms: `block` is a refusal the
 * worker cannot satisfy by asking, `confirm` means a human may allow it.
 */
export type GuardDecision = "allow" | "confirm" | "block";

const RuleSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  severity: z.enum(GUARD_SEVERITIES),
  patterns: z.array(z.string().min(1)).min(1),
  excludePatterns: z.array(z.string()).optional(),
  description: z.string().min(1),
  remediation: z.string().min(1),
});

const RulesFileSchema = z.object({
  version: z.string(),
  source: z.string(),
  ruleCount: z.number().int().positive(),
  rules: z.array(RuleSchema).min(1),
});

export interface GuardRule {
  id: string;
  category: string;
  severity: GuardSeverity;
  patterns: RegExp[];
  excludePatterns: RegExp[];
  description: string;
  remediation: string;
}

export interface GuardFinding {
  ruleId: string;
  category: string;
  severity: GuardSeverity;
  description: string;
  remediation: string;
  /** The pattern that matched, so a reviewer can see why. */
  matchedPattern: string;
  /** Bounded excerpt, never the whole command: findings get logged and shown. */
  snippet: string;
}

export interface GuardResult {
  decision: GuardDecision;
  findings: GuardFinding[];
  /** Highest severity seen, or null when nothing matched. */
  maxSeverity: GuardSeverity | null;
  /** Rule ids the caller asked to skip, echoed for auditability. */
  disabledRuleIds: string[];
}

export const GUARD_SNIPPET_MAX_LENGTH = 200;

const SEVERITY_RANK: Record<GuardSeverity, number> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFO: 1,
};

/** CRITICAL is refused outright; anything else can still be confirmed by a human. */
const BLOCKING_SEVERITIES: ReadonlySet<GuardSeverity> = new Set<GuardSeverity>(["CRITICAL"]);

export class GuardRulesError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GuardRulesError";
  }
}

/**
 * Compile the ported rule set.
 *
 * Throws rather than degrading: a guard that silently loads zero rules looks
 * exactly like a guard that found nothing wrong, which is the worst possible
 * failure mode for a security control.
 */
export function loadGuardRules(raw: unknown = rulesDocument): GuardRule[] {
  const parsed = RulesFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new GuardRulesError(`Tool guard rules failed validation: ${parsed.error.message}`);
  }
  if (parsed.data.rules.length !== parsed.data.ruleCount) {
    throw new GuardRulesError(
      `Tool guard rules are truncated: file declares ${parsed.data.ruleCount}, contains ${parsed.data.rules.length}.`,
    );
  }

  return parsed.data.rules.map((rule) => {
    let patterns: RegExp[];
    let excludePatterns: RegExp[];
    try {
      patterns = rule.patterns.map((pattern) => new RegExp(pattern));
      excludePatterns = (rule.excludePatterns ?? []).map((pattern) => new RegExp(pattern));
    } catch (error) {
      throw new GuardRulesError(`Tool guard rule '${rule.id}' contains an invalid pattern.`, {
        cause: error,
      });
    }
    return {
      id: rule.id,
      category: rule.category,
      severity: rule.severity,
      patterns,
      excludePatterns,
      description: rule.description,
      remediation: rule.remediation,
    };
  });
}

/**
 * Remove single-quoted spans before matching.
 *
 * Single quotes suppress shell expansion, so `echo 'rm -rf /'` prints text and
 * runs nothing. Double quotes still expand, so their contents are kept.
 */
export function stripSingleQuotedSpans(command: string): string {
  let inSingle = false;
  let escaped = false;
  let out = "";
  for (const char of command) {
    if (escaped) {
      escaped = false;
      if (!inSingle) out += char;
      continue;
    }
    if (char === "\\" && !inSingle) {
      escaped = true;
      out += char;
      continue;
    }
    if (char === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle) out += char;
  }
  return out;
}

function truncate(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length <= GUARD_SNIPPET_MAX_LENGTH
    ? collapsed
    : `${collapsed.slice(0, GUARD_SNIPPET_MAX_LENGTH)}…`;
}

export interface EvaluateToolCallInput {
  toolName: string;
  input: unknown;
  rules: readonly GuardRule[];
  /** Rule ids to skip, from the worker's permission config. */
  disabledRuleIds?: readonly string[];
  /** Tools whose `command`/`cmd` argument should be scanned. Defaults to shell tools. */
  shellToolNames?: readonly string[];
}

export const DEFAULT_SHELL_TOOL_NAMES: readonly string[] = [
  "Bash",
  "bash",
  "execute_shell_command",
];

function extractCommand(toolName: string, input: unknown): string | null {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  for (const key of ["command", "cmd"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  void toolName;
  return null;
}

/**
 * Evaluate one tool call.
 *
 * Findings are collected from every rule that matches (not just the first), so
 * a reviewer sees the whole picture rather than whichever rule happened to run
 * first. Only `command` is inspected: the ported rules are shell rules, and
 * pretending to judge other arguments would imply coverage that does not exist.
 */
export function evaluateToolCall(input: EvaluateToolCallInput): GuardResult {
  const shellTools = input.shellToolNames ?? DEFAULT_SHELL_TOOL_NAMES;
  const disabled = new Set(input.disabledRuleIds ?? []);

  if (!shellTools.includes(input.toolName)) {
    return { decision: "allow", findings: [], maxSeverity: null, disabledRuleIds: [...disabled] };
  }

  const command = extractCommand(input.toolName, input.input);
  if (command === null) {
    return { decision: "allow", findings: [], maxSeverity: null, disabledRuleIds: [...disabled] };
  }

  const scannable = stripSingleQuotedSpans(command);
  const findings: GuardFinding[] = [];

  for (const rule of input.rules) {
    if (disabled.has(rule.id)) continue;
    if (rule.excludePatterns.some((pattern) => pattern.test(scannable))) continue;

    for (const pattern of rule.patterns) {
      if (!pattern.test(scannable)) continue;
      findings.push({
        ruleId: rule.id,
        category: rule.category,
        severity: rule.severity,
        description: rule.description,
        remediation: rule.remediation,
        matchedPattern: pattern.source,
        snippet: truncate(command),
      });
      break; // one finding per rule; the rest of its patterns add no information
    }
  }

  if (findings.length === 0) {
    return { decision: "allow", findings, maxSeverity: null, disabledRuleIds: [...disabled] };
  }

  const maxSeverity = findings.reduce<GuardSeverity>(
    (highest, finding) =>
      SEVERITY_RANK[finding.severity] > SEVERITY_RANK[highest] ? finding.severity : highest,
    "INFO",
  );

  return {
    decision: BLOCKING_SEVERITIES.has(maxSeverity) ? "block" : "confirm",
    findings,
    maxSeverity,
    disabledRuleIds: [...disabled],
  };
}
