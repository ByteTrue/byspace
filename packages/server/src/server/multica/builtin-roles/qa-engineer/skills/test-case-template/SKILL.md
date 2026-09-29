---
name: test-case-template
description: Standard template for designing traceable QA test cases from documents, web pages, and code. Use when the user asks for test case design, a test case template, requirement-to-case mapping, or a structured test matrix for CLI/Web E2E validation.
---

# test-case-template

Use this skill to produce consistent, executable, and traceable test cases.

## When to use

- User asks to "design test cases" from docs, web pages, code, issues, or specs.
- User asks for a "standard test case template".
- You need requirement-to-test-case traceability.
- You need a reusable case format for CLI and Web E2E scope.

## Workflow

1. Collect source materials (docs/web/code/issues).
2. Extract testable requirements and constraints.
3. Group by scenario and risk priority.
4. Produce test cases with the template below.
5. Build a traceability matrix.

## Standard Test Case Template

Use this format for each case:

```markdown
### TC-<ID> <Case title>

- **Source**: <doc/web/code reference>
- **Requirement**: <testable statement from source>
- **Priority**: P0 | P1 | P2
- **Type**: CLI | Web E2E | Mixed
- **Preconditions**:
  - <environment/account/data prerequisites>
- **Test Steps**:
  1. <step 1>
  2. <step 2>
- **Expected Result**:
  - <observable expected behavior>
- **Evidence to Capture**:
  - <stdout/stderr, screenshot, logs, etc.>
- **Pass/Fail Criteria**:
  - Pass: <condition>
  - Fail: <condition>
- **Residual Risk / Notes**:
  - <remaining uncertainty or dependency>
```

## Traceability Matrix Template

```markdown
| TC-ID  | Source   | Requirement | Scenario | Priority | Evidence Type     |
| ------ | -------- | ----------- | -------- | -------- | ----------------- |
| TC-001 | docs/... | ...         | ...      | P0       | screenshot + logs |
```

## Quality Gate

A case set is acceptable only when:

1. Every case maps to a clear source.
2. Steps are executable without hidden assumptions.
3. Expected results are observable and measurable.
4. Evidence requirements are explicit.
5. Residual risk is stated for partial/blocked scenarios.

## Anti-Patterns

- Vague case text like "verify it works".
- Cases without source traceability.
- Expected results that cannot be observed.
- Missing prerequisites or missing evidence instructions.
