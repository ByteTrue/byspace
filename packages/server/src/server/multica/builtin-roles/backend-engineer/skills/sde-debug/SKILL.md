---
name: sde-debug
description: Structured debugging session for bug-fix routes — reproduce, isolate, diagnose, and prepare a contract-safe fix. Trigger with an error message or stack trace, "this works in staging but not prod", "something broke after the deploy", or when behavior diverges from expected and the cause isn't obvious.
argument-hint: "<error message or problem description>"
---

# /sde-debug

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../../CONNECTORS.md).

Run a structured debugging session to find and fix issues systematically.

## Usage

```
/sde-debug $ARGUMENTS
```

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                       SDE-DEBUG                                 │
├─────────────────────────────────────────────────────────────────┤
│  Step 0: ENVIRONMENT DETECTION                                  │
│  ✓ Detect available local git tools (git, gh, glab, etc.)      │
│  ✓ Determine if the codebase is a git repository               │
│  ✓ If git repo: create a new branch before touching any code   │
│                                                                 │
│  Step 1: REPRODUCE                                              │
│  ✓ Understand the expected vs. actual behavior                  │
│  ✓ Identify exact reproduction steps                            │
│  ✓ Determine scope (when did it start? who is affected?)        │
│  ✓ Capture contract anchors (existing tests / API expectations) │
│                                                                 │
│  Step 2: ISOLATE                                                │
│  ✓ Narrow down the component, service, or code path             │
│  ✓ Check recent changes (deploys, config changes, dependencies) │
│  ✓ Review logs and error messages                                │
│                                                                   │
│  Step 3: DIAGNOSE                                                 │
│  ✓ Form hypotheses and test them                                 │
│  ✓ Trace the code path                                           │
│  ✓ Identify root cause (not just symptoms)                      │
│  ✓ Determine regression test scope (minimum unit tests needed)  │
│  ✓ Trigger /testing-strategy write for affected path as needed  │
│                                                                   │
│  Step 4: FIX                                                      │
│  ✓ Propose a fix with explanation                                │
│  ✓ Consider side effects and edge cases                          │
│  ✓ Run regression tests to confirm no prior behavior is broken  │
│  ✓ Confirm testing-strategy evidence for happy/error/edge paths │
│  ✓ Prepare implementation-ready fix plan and risk notes          │
│  ✓ Emit handoff for /testing-strategy and downstream stages      │
└─────────────────────────────────────────────────────────────────┘
```

## Environment Detection — Git Repository

Before making any code changes, always run the following checks:

### 1. Detect local git tooling

Probe for available tools in priority order:

```bash
# Check for git
git --version

# Check for GitHub CLI (enables PR creation)
gh --version

# Check for GitLab CLI (enables MR creation)
glab --version
```

Record which tools are available. Prefer local tools over connector-based operations.

### 2. Determine if the working directory is a git repository

```bash
git rev-parse --is-inside-work-tree 2>/dev/null
```

If this returns `true`, the codebase is a git repo and the git workflow below applies.

### 3. Create a fix branch before touching any code

Never commit directly to an existing branch. Always create a dedicated fix branch first:

```bash
# Record the current branch (this is the "buggy working branch")
git rev-parse --abbrev-ref HEAD

# Create and switch to a new fix branch
git checkout -b fix/<short-issue-description>
```

Use a branch name that reflects the issue (e.g., `fix/null-pointer-on-empty-input`). If the user supplies an issue/ticket ID, include it: `fix/PROJ-123-login-crash`.

---

## What I Need From You

Tell me about the problem. Any of these help:

- Error message or stack trace
- Steps to reproduce
- What changed recently
- Logs or screenshots
- Expected vs. actual behavior

## Contract Baseline Check

Before declaring any failure as "pre-existing", you must gather baseline evidence:

1. Identify the contract-bearing checks (existing failing test, target assertion, API behavior).
2. Run those checks in the cleanest possible state you can achieve.
3. Record exact command + output snippet proving baseline status.

If baseline cannot be established due to environment issues, state this explicitly and do not infer conclusions from guesswork.

## Deliverable Artifact Check

If the task declares deliverable artifacts, validate artifact contract before closing:

- Required file name/path exists at the declared destination.
- Startup command or entrypoint is executable from expected working directory.
- Output contract (format/field/default semantics) is aligned with existing assertions.

## Failure Loop Guard (P0)

To prevent turn burn from repeated blind retries:

1. Track the failure signature (error class + key message + command context).
2. If the same environment/dependency/build signature appears twice, stop repeating the same high-cost command and switch to alternative strategies.
3. Run at least two distinct alternatives before declaring blocked:
   - Scoped verification instead of full-suite rerun (single module/test or compile-only).
   - Dependency/environment validation (artifact availability, repo source, runtime/toolchain version).
   - Deliverable contract preflight checks (required artifact path/name/entrypoint).
   - Narrower diagnostics (focused log extraction or minimal reproducer command).
4. Switch to an **environment-blocked branch** only if alternatives still produce no new evidence or no code-level progress:
   - Capture minimal reproducible evidence (command + key stderr lines).
   - State why code-level progress is blocked.
   - Provide concrete unblock actions.
5. Before any high-cost rerun, state the new evidence/hypothesis that justifies rerun. If no new evidence exists, do not rerun.

## Regression Test Scope

While diagnosing, identify the **minimum set of tests** that cover the affected code path. The goal is a focused safety net — not a full test suite run — that proves the fix does not break prior behavior.

### How to determine scope

1. **Trace the call path** of the buggy code: which functions, modules, or services are touched by the fix?
2. **Search for existing tests** that exercise those entry points:
   ```bash
   # Example: find test files related to the affected module
   grep -r "<affected-function-or-module>" --include="*.test.*" --include="*.spec.*" -l
   ```
3. **Prefer unit tests** over integration tests for regression validation — they run faster and isolate the fix cleanly.
4. **Run the identified tests before and after the fix** to confirm:
   - They pass before the fix (or fail in the expected way that proves the bug).
   - They all pass after the fix.
   - Existing contract tests did not regress while new tests were added.

```bash
# Run only the identified test files (example with common runners)
npx jest <test-file>          # Jest
bun test <test-file>          # Bun
pytest <test-file>            # Python
go test ./path/to/package/... # Go
```

If no tests cover the affected path, note this in the SDE Debug Report and suggest a minimal test to add as part of the fix.

## Mandatory Handoff to `/testing-strategy`

Use `/testing-strategy` as the default testing executor once debug reaches actionable diagnosis.

Trigger `/testing-strategy` when any of these occur:

1. Root cause is confirmed for a bug that changes observable behavior.
2. You are about to verify a fix and lack reproduction test or baseline-equivalent evidence.
3. The affected path has no existing tests.
4. Pre-delivery verification needs explicit happy/error/edge regression coverage.

Recommended command:

```bash
/testing-strategy write <affected-file-or-module>
```

If test execution is environment-blocked, still require `/testing-strategy` output with:

- test plan,
- blocked evidence (command + failure signature),
- concrete next-step commands for unblock.

## Safe Workspace Practices

- Prefer targeted verification over broad workspace mutation.
- Avoid destructive context switching during diagnosis.
- If you must temporarily shelve local changes for baseline checks, document exactly what was stashed and confirm restoration immediately after.
- Do not leave unresolved stashed state or implicit workspace side effects.
- Prefer focused test/module commands before full-suite reruns.

---

## Post-Debug Handoff Workflow

Once root cause and fix direction are clear:

1. Emit concise fix strategy and changed-surface list.
2. Trigger `/testing-strategy` with affected path for regression evidence planning.
3. Provide downstream handoff that includes:
   - reproduction signature,
   - root cause statement,
   - contract anchors,
   - minimum test scope.

---

## Output

```markdown
## SDE Debug Report: [Issue Summary]

### Environment

- **Git repo**: [Yes / No]
- **Fix branch**: [branch name, or N/A]
- **Git tools available**: [git, gh, glab, ...]

### Reproduction

- **Expected**: [What should happen]
- **Actual**: [What happens instead]
- **Steps**: [How to reproduce]

### Root Cause

[Explanation of why the bug occurs]

### Contract Anchors

- [Existing tests / API behavior / defaults used as truth source]

### Fix

[Code changes or configuration fixes needed]

### Regression Tests Run

| Test file | Result before fix | Result after fix |
| --------- | ----------------- | ---------------- |
| [file]    | [FAIL / PASS]     | PASS             |

### Testing Strategy Handoff

- **Invoked**: [Yes / No]
- **Command**: [`/testing-strategy write <path>` or rationale]
- **Coverage evidence**: [happy / error / edge]
- **Blocked status**: [No / Yes, with failure signature]

### Artifact Contract Verification

- **Required artifacts**: [file/path/entrypoint list]
- **Verification result**: [pass/fail with evidence]

### Failure Loop Guard

- **Repeated signature detected**: [yes/no]
- **Signature summary**: [error class + key message]
- **Alternative strategies attempted**: [strategy 1 result; strategy 2 result; ...]
- **Decision**: [continue targeted retry / switch to environment-blocked]
- **New evidence for rerun**: [what changed since last attempt]

### Prevention

- [Test to add if no existing coverage found]
- [Guard to put in place]

### Stage State Update
```

## If Connectors Available

If **~~monitoring** is connected:

- Pull logs, error rates, and metrics around the time of the issue
- Show recent deploys and config changes that may correlate

If **~~source control** is connected:

- Identify recent commits and PRs that touched affected code paths
- Check if the issue correlates with a specific change
- After root-cause and fix direction are confirmed, analyze branch history to identify likely integration surface and contract impact.
- Provide context for downstream review instead of opening PR/MR directly from this skill.

If **~~project tracker** is connected:

- Search for related bug reports or known issues
- Create a ticket for the fix once identified

## Tips

1. **Share error messages exactly** — Don't paraphrase. The exact text matters.
2. **Mention what changed** — Recent deploys, dependency updates, and config changes are top suspects.
3. **Include context** — "This works in staging but not prod" or "Only affects large payloads" narrows things fast.
