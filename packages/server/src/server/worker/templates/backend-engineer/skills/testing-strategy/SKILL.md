---
name: testing-strategy
description: Design test strategies and test plans, write and run tests, and review newly added tests against a plan. Trigger with "how should we test", "test strategy for", "write tests for", "test plan", "what tests do we need", "review the tests I added", or when behavior-changing code is added/modified and evidence is needed.
argument-hint: "<component, file, feature, or 'review' to audit existing tests>"
---

# /testing-strategy

Design effective testing strategies, write and execute tests, and audit newly added tests against a plan — without modifying production code.

## Usage

```
# Design a test strategy for a component or feature
/testing-strategy <component or feature description>

# Write and run tests for a specific file or module
/testing-strategy write <file or module path>

# Review newly added tests and match them against a test plan
/testing-strategy review @$1
```

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                   TESTING STRATEGY                             │
├─────────────────────────────────────────────────────────────────┤
│  STANDALONE (always works)                                      │
│  ✓ Analyze codebase to build a test plan                       │
│  ✓ Write new tests aligned with the plan                       │
│  ✓ Run tests and classify results                               │
│  ✓ Review added tests vs. plan coverage                        │
│  ✓ Report gaps, environment failures, and test failures        │
├─────────────────────────────────────────────────────────────────┤
│  SUPERCHARGED (when tools connected)                             │
│  + Source control: diff newly added tests automatically         │
│  + Project tracker: link coverage gaps to tickets               │
│  + Knowledge base: validate tests against team standards        │
└─────────────────────────────────────────────────────────────────┘
```

## Testing Pyramid

```
        /  E2E  \         Few, slow, high confidence
       / Integration \     Some, medium speed
      /    Unit Tests  \   Many, fast, focused
```

## Strategy by Component Type

- **API endpoints**: Unit tests for business logic, integration tests for HTTP layer, contract tests for consumers
- **Data pipelines**: Input validation, transformation correctness, idempotency tests
- **Frontend**: Component tests, interaction tests, visual regression, accessibility
- **Infrastructure**: Smoke tests, chaos engineering, load tests

## What to Cover

Focus on: business-critical paths, error handling, edge cases, security boundaries, data integrity.

Skip: trivial getters/setters, framework code, one-off scripts.

## Trigger and Evidence Contract (TDD Optional)

Use this skill by default for behavior-affecting changes, while keeping execution style flexible:

- **Default trigger**: New logic, bug fixes, behavior changes, parser/format/default-semantics changes, and non-trivial refactors.
- **Not a strict TDD mandate**: RED-GREEN-REFACTOR is preferred when practical, but not required for every task.
- **Required proof regardless of order**: Delivery must include test evidence that demonstrates expected behavior, error handling, and at least one relevant edge case.
- **Execution policy**: Test-first is preferred, not mandatory; regression evidence is mandatory.

For bug fixes, apply the **Prove-It pattern** by default:

1. Add a reproduction test that demonstrates the bug (preferably failing before fix).
2. After the fix, show that the same test now passes.
3. If deterministic reproduction is not possible, explicitly document why and provide equivalent baseline evidence.

**Tiny-change exemption**:

- For clearly non-behavioral edits (docs/comments/static text), you may skip new tests.
- If skipped, state the reason explicitly in the report.

## Debug Escalation Triggers (High Priority)

When `/sde-debug` is in use, treat these as high-priority triggers for `/testing-strategy`:

1. **Root cause confirmed + behavior regression**  
   Trigger immediately: `/testing-strategy write <affected-path>`.
2. **Fix verification is about to start**  
   Do not close verification without either a reproduction test or explicit baseline-equivalent evidence.
3. **Fix implemented, pre-delivery stage**  
   Produce a regression matrix that covers happy path, primary error path, and at least one high-risk edge path.
4. **No existing tests for affected path**  
   Write the minimal regression-oriented tests for the changed behavior rather than skipping test evidence.
5. **Environment-blocked test execution**  
   Still produce test plan, blocked evidence, and next-step commands for human follow-up.

These triggers are mandatory unless a tiny-change exemption explicitly applies.

## Contract and Compatibility Guardrails

For bug-fix and contract-sensitive scenarios, apply these rules before writing new tests:

1. Run the relevant existing target tests first and capture baseline pass/fail status.
2. Treat existing assertions as behavioral contracts unless the user explicitly approves a contract change.
3. Do not "fix" failing existing tests by weakening expectations to fit new code.
4. Add tests to close coverage gaps, especially default-value semantics, output format, and edge-case parsing.
5. If the task has deliverable contract constraints, include at least one test/assertion for required file path/name/entrypoint behavior.
6. If this run is part of a regression-sensitive bug-fix chain, produce evidence suitable for delivery gate review (baseline, regression matrix, remaining risks).
7. Prefer a bug reproduction test before writing any additional scenario tests.
8. If skipping test-first flow, record why and show equivalent confidence evidence.
9. Do not mark coverage "sufficient" unless happy/error/edge evidence is explicit.

---

## Writing Tests

When asked to write tests for a component or feature:

### 1. Build the test plan first

Before writing any test code, produce a structured plan:

- Identify the component's public surface (functions, methods, endpoints, events).
- Map each entry point to test cases: happy path, error path, edge cases, security boundaries.
- Assign a test type to each case (unit / integration / e2e).
- Prioritize by risk: business-critical paths and error handling come first.
- **If a planning spec (`plan-*.md`) or inline acceptance criteria were provided** (from `/planning`), treat each AC as a required test case. Extract any stated success signal and record it separately — the test plan must include at least one test that directly verifies each AC and, where possible, the success signal as an observable outcome.
- **Calibrate test plan depth to the complexity verdict**: read the `**Complexity:**` field from the planning spec, or infer it from the scope of the change. Let complexity bound both the number of test cases and the infrastructure investment:

  | Complexity | Test plan guidance                                                                        |
  | ---------- | ----------------------------------------------------------------------------------------- |
  | **Nano**   | 1–3 focused tests; no elaborate fixtures or mocking needed                                |
  | **Small**  | Unit tests for the new function/method; one error-path case                               |
  | **Medium** | Unit + integration tests; cover the public interface and at least one cross-boundary case |
  | **Large**  | Full pyramid; include contract tests for cross-service boundaries                         |

  **Do not write a Large-complexity test suite for a Nano change.** Simpler changes deserve leaner test plans.

### 1.1 Choose test order strategy explicitly

Before writing tests, declare one strategy:

- **Test-first (preferred)**: Use for bug fixes and behavior-sensitive changes when reproduction is feasible.
- **Mixed**: Use when part of the behavior is easy to specify first, and part requires exploratory setup.
- **Code-first with evidence**: Allowed when legacy constraints or tooling limitations block practical test-first flow.

Regardless of strategy, your report must include confidence evidence that would catch a regression in the changed behavior.

### 2. Write tests incrementally, one case at a time

- Write the simplest test first; verify it compiles and runs before proceeding.
- Keep each test independent — no shared mutable state between cases.
- Prefer existing test helpers, fixtures, and runner conventions already present in the codebase.
- Do **not** modify production code as part of this skill. If a test cannot be written without changing production code, note it as a gap.
- For bug fixes, start with a reproduction test unless explicitly blocked (and documented).

### 2.1 Edge-Case Matrix (required for parser/format/default-semantics changes)

When the change touches parsing, formatting, masking, or default parameter behavior, include this minimum matrix:

- Base happy path
- Existing contract behavior (legacy/default behavior)
- At least one nested/escaped/complex input case
- One negative or malformed input case

### 3. Detect the test runner

Inspect the project to determine how tests are run before executing anything:

```bash
# Check for common runner config files
ls package.json jest.config.* vitest.config.* pytest.ini setup.cfg go.mod bun.lockb 2>/dev/null

# Read the test script from package.json if present
cat package.json | grep -A5 '"scripts"'
```

| Runner detected | Command to run a single file                        |
| --------------- | --------------------------------------------------- |
| Jest            | `npx jest <test-file> --no-coverage`                |
| Vitest          | `npx vitest run <test-file>`                        |
| Bun test        | `bun test <test-file>`                              |
| pytest          | `pytest <test-file> -v`                             |
| Go test         | `go test ./path/to/pkg/... -v -run <TestName>`      |
| Other           | Read `scripts.test` in `package.json` or `Makefile` |

Always run **a single test file at a time** during the write-run loop to get focused feedback.

---

## Running Tests and Classifying Results

After running a test, classify the outcome into exactly one of three categories:

### Category A — Infrastructure / Environment Failure

**Definition**: The test process cannot start or crashes before the test logic executes. Causes include:

- Missing dependencies, import errors, or unresolvable modules.
- Configuration errors (missing env vars, wrong config file path, etc.).
- Incompatible runtime version.
- Timeout during test setup/teardown (not the test assertion itself).
- Repeated runner crashes with no meaningful assertion output.

**Action**:

1. Attempt to fix the environment issue **once** (e.g., install a missing package, correct a path).
2. If the failure persists after one fix attempt, or the fix requires out-of-scope changes, mark the test as **blocked by environment**.
3. Record the blocked test in the `⚠️ Needs Human Attention` section of the output.
4. Continue with remaining tests — do not abort the whole session.

**Important**: Do not delete existing tests to make the suite green.

**Threshold**: If more than **3 consecutive tests** in the same file hit Category A failures, stop writing new tests for that file entirely and escalate the whole file to the attention report.

### Category B — Test Passes

**Definition**: The test runner executes the test, all assertions pass.

**Action**: Mark as ✅ in the results table. No further action needed.

### Category C — Test Fails (Assertion Failure)

**Definition**: The test runner executes the test and one or more assertions fail. The test logic ran correctly; the production code did not meet the expectation.

**Action**:

1. Record the failure in the `❌ Test Failures` section of the output with the exact assertion message.
2. **Do not attempt to fix the production code.** This is outside the scope of this skill.
3. Optionally verify that the test itself is logically correct (correct expected value, correct assertion method). If the test has a bug, fix the test — but only the test.

---

## Reviewing Newly Added Tests

When asked to review tests that were added during a coding session:

### 1. Collect the added tests

**If ~~source control is connected**: Pull the diff of test files automatically.

**Otherwise**: Ask the user which test files were added or changed, or inspect git diff locally:

```bash
git diff --name-only HEAD | grep -E '\.(test|spec)\.(ts|js|tsx|jsx|py|go)$'
git diff HEAD -- '*.test.*' '*.spec.*'
```

### 2. Reconstruct or receive the test plan

- If the user provides a test plan (document, ticket, or description), use it directly.
- If no plan exists, infer one from the PR/commit description and the changed production files.
- State the inferred plan explicitly before proceeding so the user can correct it.
- **If a planning spec was used**, extract the **success signal** stated during `/planning` Step 1 ("How will the user know this is done?") and the acceptance criteria from Step 4. List them explicitly at the top of the review — the goal is not only to measure coverage but to confirm whether passing tests demonstrate that the success signal is actually met.

### 3. Match tests against the plan

For each item in the test plan, determine:

- **Covered**: At least one added test exercises this case.
- **Partially covered**: A test exists but does not cover all variants (e.g., missing error path).
- **Not covered**: No test addresses this plan item.

### 4. Run the added tests

Apply the same write-run loop and result classification (Category A / B / C) described above.

---

## Output

```markdown
## Testing Strategy Report: [Component / Feature]

### Test Order Strategy

- **Strategy**: Test-first / Mixed / Code-first with evidence
- **Reason**: [why this strategy fits the current change]
- **Bug reproduction evidence**: [test name + fail-before/pass-after], or [exception note]

### Test Plan

| #   | Area                      | Test Type                | Priority         |
| --- | ------------------------- | ------------------------ | ---------------- |
| 1   | [entry point or behavior] | Unit / Integration / E2E | High / Med / Low |

### Coverage Match (Review Mode)

| Plan Item   | Status                                   | Added Test(s)      |
| ----------- | ---------------------------------------- | ------------------ |
| [plan item] | ✅ Covered / 🔶 Partial / ❌ Not covered | [test name or N/A] |

### Test Execution Results

| Test        | File   | Result                         | Category  |
| ----------- | ------ | ------------------------------ | --------- |
| [test name] | [file] | ✅ Pass / ❌ Fail / ⚠️ Removed | B / C / A |

### ❌ Test Failures (Category C — Needs Investigation)

> These tests ran correctly but the assertions did not pass.
> **Do not attempt to fix production code as part of this skill.**

- **[test name]** in `[file]`
  - Assertion: `[exact failure message]`
  - Expected: `[value]` / Actual: `[value]`

### ⚠️ Needs Human Attention (Category A — Environment / Infrastructure)

> These tests could not run due to environment or configuration issues.
> They remain in the suite and require environment fixes before reliable verification.

- **[test name]** in `[file]`
  - Reason: `[error or failure description]`
  - Suggested next step: `[e.g., install missing dep, configure env var X]`

### Success Signal Confirmation

> Populate this section only when a success signal or acceptance criteria were provided (e.g., from a `/planning` spec).
> A success signal is confirmed when every AC it depends on has at least one passing test.

**Success signal:** "[Restate verbatim from the planning spec, or '— not provided']"  
**Verdict:** ✅ Confirmed / ❌ Not confirmed / — Not provided

| AC   | Description   | Test covering it   | Passes?     |
| ---- | ------------- | ------------------ | ----------- |
| AC-1 | [description] | [test name or N/A] | ✅ / ❌ / — |

### Coverage Gaps

- [Plan items not covered by any test, with suggested test approach]

### Deliverable Contract Checks

- [Path/name/entrypoint checks relevant to stated delivery contract, if applicable]

### Skill Chain Evidence (for regression-sensitive bug fixes)

- **Baseline evidence reference**: [from sde-debug step]
- **Regression matrix status**: [happy/error/edge pass/fail]
- **Hand-off to code-review**: [key risk notes to be audited]

### Stage State Update

### Summary

- Tests written: [N]
- Tests passing: [N]
- Tests failing (Category C): [N]
- Tests blocked by environment (Category A): [N]
- Plan coverage: [N/N items covered]
- Success signal: ✅ Confirmed / ❌ Not confirmed / — Not provided
```

## If Connectors Available

If **~~source control** is connected:

- Pull the diff of test files from the PR/commit automatically without asking the user.
- Use the PR description to infer the test plan if none is provided.

If **~~project tracker** is connected:

- Link coverage gaps and Category C failures to related tickets.
- Create follow-up tasks for uncovered plan items.

If **~~knowledge base** is connected:

- Validate written tests against team testing standards and naming conventions.

## Behavior-First Quality Rules

- **Test state, not internals**: Prefer validating outputs and observable side effects over fragile call-sequence assertions.
- **DAMP over excessive DRY**: Keep tests readable and self-explanatory, even with some acceptable duplication.
- **Real > fake > stub > mock**: Prefer higher-confidence dependencies unless speed or determinism requires doubles.
- **AAA structure by default**: Arrange, Act, Assert with explicit intent.
- **Name behavior, not implementation**: Test names should read like executable specs.

## Red Flags (Gate Blockers)

Treat these as blocking unless explicitly justified:

- Behavior changes with no corresponding tests.
- Bug-fix testing with no reproduction evidence and no exception note.
- Claiming "all tests pass" without runnable command evidence.
- Coverage report omits happy path, primary error path, or high-risk edge path.
- Existing assertions were weakened without explicit contract-change approval.

## Tips

1. **Provide the test plan** — A ticket, spec, or description of expected behavior helps produce a more accurate coverage match.
2. **One file at a time** — Running a single test file gives faster, cleaner feedback than running the full suite.
3. **Category A is not a test failure** — Environment failures mean the test infrastructure needs attention, not that the code is broken.
4. **Category C findings are handoffs** — Failing assertions are signals for developers, not things this skill will fix.
5. **Partial coverage counts** — A test that covers the happy path but not the error path will show as 🔶 Partial, prompting a targeted addition.
6. **Echo the success signal** — If a success signal was stated during planning, restate it verbatim in the report and explicitly confirm or deny whether the passing tests demonstrate it. Coverage percentages alone do not answer "is this done?"
7. **Honor existing contracts first** — New tests should extend coverage, not redefine existing expected behavior without explicit approval.
8. **Prefer Prove-It for bug fixes** — Reproduction-first gives the strongest evidence, but document justified exceptions when necessary.
