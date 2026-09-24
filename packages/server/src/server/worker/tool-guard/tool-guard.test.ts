/**
 * Tests for the worker tool guard.
 *
 * The rule data is ported from another project, so these tests check two
 * different things: that the port itself did not lose or corrupt rules, and
 * that the engine's decisions match what a reviewer would expect for the four
 * threat categories the epic commits to catching.
 */
import { describe, expect, it } from "vitest";

import {
  GuardRulesError,
  GUARD_SEVERITIES,
  evaluateToolCall,
  loadGuardRules,
  stripSingleQuotedSpans,
} from "./tool-guard.js";

const rules = loadGuardRules();

function evaluate(command: string, toolName = "Bash") {
  return evaluateToolCall({ toolName, input: { command }, rules });
}

describe("guard rule loading", () => {
  it("loads every rule declared in the file", () => {
    expect(rules.length).toBeGreaterThanOrEqual(21);
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
  });

  it("compiles patterns rather than keeping them as strings", () => {
    for (const rule of rules) {
      expect(rule.patterns.length, rule.id).toBeGreaterThan(0);
      for (const pattern of rule.patterns) {
        expect(pattern, rule.id).toBeInstanceOf(RegExp);
      }
    }
  });

  it("refuses to run on a truncated rule set", () => {
    // Zero rules would make the guard approve everything, which is worse than
    // failing: the caller must not be able to tell that apart from "nothing found".
    expect(() => loadGuardRules({ version: "1", source: "x", ruleCount: 5, rules: [] })).toThrow(
      GuardRulesError,
    );
  });

  it("refuses a rule file whose declared count does not match its contents", () => {
    const one = {
      id: "R",
      category: "c",
      severity: "HIGH",
      patterns: ["x"],
      description: "d",
      remediation: "r",
    };
    expect(() => loadGuardRules({ version: "1", source: "x", ruleCount: 2, rules: [one] })).toThrow(
      /truncated/,
    );
  });

  it("refuses an invalid pattern instead of skipping the rule", () => {
    expect(() =>
      loadGuardRules({
        version: "1",
        source: "x",
        ruleCount: 1,
        rules: [
          {
            id: "BAD",
            category: "c",
            severity: "HIGH",
            patterns: ["([unclosed"],
            description: "d",
            remediation: "r",
          },
        ],
      }),
    ).toThrow(GuardRulesError);
  });

  it("only uses known severities", () => {
    for (const rule of rules) {
      expect(GUARD_SEVERITIES, rule.id).toContain(rule.severity);
    }
  });
});

describe("guard decisions by threat category", () => {
  it("blocks disk destruction", () => {
    const result = evaluate("mkfs.ext4 /dev/sda1");
    expect(result.decision).toBe("block");
    expect(result.maxSeverity).toBe("CRITICAL");
    expect(result.findings.map((f) => f.category)).toContain("command_injection");
  });

  it("blocks a fork bomb", () => {
    const result = evaluate(":(){ :|:& };:");
    expect(result.decision).toBe("block");
    expect(result.findings.map((f) => f.category)).toContain("resource_abuse");
  });

  it("blocks privilege escalation", () => {
    const result = evaluate("sudo chmod 777 /etc/shadow");
    expect(result.decision).toBe("block");
    expect(result.findings.map((f) => f.category)).toContain("privilege_escalation");
  });

  it("asks before a destructive file removal rather than blocking outright", () => {
    const result = evaluate("rm -rf ./build");
    expect(result.decision).toBe("confirm");
    expect(result.maxSeverity).toBe("HIGH");
  });

  it("asks before an unexpected move", () => {
    const result = evaluate("mv src/a.ts src/b.ts");
    expect(result.decision).toBe("confirm");
    expect(result.findings.map((f) => f.ruleId)).toContain("TOOL_CMD_DANGEROUS_MV");
  });

  it("reports every matching rule, not just the first", () => {
    const result = evaluate("rm -rf /var && mv /etc/hosts /tmp/hosts");
    expect(result.findings.map((f) => f.ruleId)).toContain("TOOL_CMD_DANGEROUS_RM");
    expect(result.findings.map((f) => f.ruleId)).toContain("TOOL_CMD_DANGEROUS_MV");
  });

  it("allows an ordinary command", () => {
    const result = evaluate("npm test -- --bail=1");
    expect(result.decision).toBe("allow");
    expect(result.findings).toEqual([]);
    expect(result.maxSeverity).toBeNull();
  });
});

describe("guard scoping", () => {
  it("ignores tools it has no rules for", () => {
    const result = evaluateToolCall({
      toolName: "Read",
      input: { file_path: "/etc/shadow" },
      rules,
    });
    expect(result.decision).toBe("allow");
  });

  it("allows a shell call with no command argument", () => {
    const result = evaluateToolCall({ toolName: "Bash", input: {}, rules });
    expect(result.decision).toBe("allow");
  });

  it("honours disabled rules, including on a would-be block", () => {
    const result = evaluateToolCall({
      toolName: "Bash",
      input: { command: "mkfs.ext4 /dev/sda1" },
      rules,
      disabledRuleIds: ["TOOL_CMD_FS_DESTRUCTION"],
    });
    expect(result.decision).toBe("allow");
    // The caller's choice is echoed back so an audit trail can show it.
    expect(result.disabledRuleIds).toEqual(["TOOL_CMD_FS_DESTRUCTION"]);
  });
});

describe("quote handling", () => {
  it("does not flag destruction quoted as literal text", () => {
    // `echo 'rm -rf /'` prints a string; it runs nothing.
    expect(evaluate("echo 'rm -rf /'").decision).toBe("allow");
  });

  it("still scans inside double quotes, because the shell expands there", () => {
    const result = evaluate('bash -c "rm -rf /tmp/x"');
    expect(result.decision).toBe("confirm");
  });

  it("keeps single-quoted content out of the scanned text", () => {
    expect(stripSingleQuotedSpans("a 'b rm -rf c' d")).toBe("a  d");
  });

  it("does not treat an escaped quote as a quote delimiter", () => {
    expect(stripSingleQuotedSpans("echo \\'not a quote")).toContain("not a quote");
  });
});

describe("findings are safe to log", () => {
  it("bounds the snippet so a huge command cannot flood the log", () => {
    const result = evaluate(`rm ${"x".repeat(5000)}`);
    expect(result.findings[0]!.snippet.length).toBeLessThanOrEqual(201);
  });

  it("always carries the remediation and matched pattern for a finding", () => {
    const result = evaluate("rm -rf /tmp/x");
    const finding = result.findings[0]!;
    expect(finding.remediation.length).toBeGreaterThan(0);
    expect(finding.matchedPattern.length).toBeGreaterThan(0);
    expect(finding.description.length).toBeGreaterThan(0);
  });
});
