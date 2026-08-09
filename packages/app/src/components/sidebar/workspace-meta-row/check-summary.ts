import { mapCheckStatus } from "@/git/pull-request-panel/check-status";
import type { PrHint } from "@/git/pr-hint";

export type CheckSummaryState = "passed" | "failed" | "running";

export interface CheckSummary {
  state: CheckSummaryState;
  completed: number;
  total: number;
}

export function selectCheckSummary(hint: PrHint | null): CheckSummary | null {
  if (!hint) return null;
  return summarizeChecks(hint.checks) ?? summarizeChecksStatus(hint.checksStatus);
}

function summarizeChecks(checks: PrHint["checks"]): CheckSummary | null {
  if (!checks || checks.length === 0) return null;

  let completed = 0;
  let failed = false;
  for (const check of checks) {
    const status = mapCheckStatus(check.status);
    if (status === "failure") failed = true;
    if (status !== "pending") completed += 1;
  }

  const total = checks.length;
  if (failed) return { state: "failed", completed: total, total };
  if (completed === total) return { state: "passed", completed: total, total };
  return { state: "running", completed, total };
}

function summarizeChecksStatus(checksStatus: PrHint["checksStatus"]): CheckSummary | null {
  switch (checksStatus) {
    case "success":
      return { state: "passed", completed: 1, total: 1 };
    case "failure":
      return { state: "failed", completed: 1, total: 1 };
    case "pending":
      return { state: "running", completed: 0, total: 1 };
    default:
      return null;
  }
}
