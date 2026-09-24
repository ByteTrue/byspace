---
name: planning
description: Plan feature or bug-fix work before implementation. Produce a lean spec with goal, deliverables, acceptance criteria, and an executable runtime todo list. Trigger first for any implementation route.
argument-hint: "<feature, bugfix scope, requirement, or design problem>"
---

# /planning

Distill any feature or design request into a lean, actionable spec — goal, deliverables, acceptance criteria, and the shortest path to done.

## Usage

```
/planning @$1
```

If no description is provided, infer intent from currently available readable
materials and produce a conservative scoped draft.

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                        PLANNING                                 │
├─────────────────────────────────────────────────────────────────┤
│  STANDALONE (always works)                                      │
│  ✓ Clarify requirements with minimal targeted questions         │
│  ✓ Distill a crisp, effect-oriented goal statement              │
│  ✓ Identify concrete, traceable deliverables                    │
│  ✓ Define testable acceptance criteria                          │
│  ✓ Derive the shortest viable implementation path               │
│  ✓ Save the spec to a file for downstream skills to consume     │
├─────────────────────────────────────────────────────────────────┤
│  SUPERCHARGED (when tools connected)                            │
│  + Project tracker: pull requirements from tickets/stories      │
│  + Source control: inspect existing codebase for context        │
│  + Knowledge base: align with team conventions and prior specs  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Step 1 — Independent Requirement Understanding (No User Questions)

Before producing the spec, gather and reconcile requirements using only currently
readable materials:

- user prompt and prior confirmed constraints,
- existing repository artifacts/docs/interfaces/tests,
- surrounding code behavior and contract expectations.

Hard rule:

- Do not ask the user clarification questions in this skill.
- Do not block on missing detail if reasonable inference can be made.

If ambiguity remains:

- state assumptions explicitly,
- choose the safest bounded interpretation,
- continue with a refinable draft instead of pausing for Q&A.

---

## Step 2 — Goal Statement

Write a single sentence (≤ 30 words) that captures the **outcome**, not the action.

Format:

> Enable [who] to [do what] so that [what effect is achieved].

Examples of good goal statements:

> Enable operators to rotate API keys without restarting the daemon so that credentials can be refreshed with zero downtime.

> Allow users to filter the task list by status and assignee so that large projects remain navigable.

Examples of poor goal statements (reject these):

> ~~"Implement a key rotation endpoint."~~ — describes action, not effect.
> ~~"Build the task filter feature."~~ — no actor, no effect.

---

## Step 3 — Deliverables

List **what will exist or change** when the work is done. Each deliverable must:

1. **Be concrete** — name the artifact, API endpoint, UI component, data schema, or behavior change. Not "a package" or "a module".
2. **Trace back to the goal** — if a deliverable cannot be linked to the goal statement, it is out of scope.
3. **Be independently verifiable** — someone should be able to check "does this exist and work correctly?" without reading the full spec.

Format each deliverable as:

```
- [Artifact type]: [Specific description]  →  [How it serves the goal]
```

Examples:

```
- API endpoint: POST /api/credentials/rotate — accepts key ID, invalidates old key, returns new key  →  provides the programmatic rotation surface
- Config field: `credentials.autoRotateIntervalHours` in daemon config  →  enables scheduled rotation without manual operator action
- Event: `credential.rotated` emitted on SSE stream with redacted key ID  →  allows clients to react to rotation without polling
```

**Explicitly exclude** deliverables that are not in scope, if there is a risk of scope creep:

```
Out of scope: UI for key management (to be addressed separately)
```

---

## Step 4 — Acceptance Criteria

Define the minimum set of **testable conditions** that confirm the goal is met. These will be consumed directly by `/testing-strategy`.

Rules:

- Each criterion must be falsifiable — it can pass or fail.
- Describe behavior, not implementation. Write from the perspective of an observer.
- Cover: happy path, primary error paths, and the most important edge case. Skip exhaustive enumeration.
- Do not duplicate deliverable descriptions — acceptance criteria assert behavior, not existence.

Format:

```
AC-1  [Happy path]     Given … When … Then …
AC-2  [Error path]     Given … When … Then …
AC-3  [Edge case]      Given … When … Then …
AC-4  [Non-functional] [Response time / consistency / security constraint]
```

Aim for 3–6 criteria. More than 8 usually signals the scope is too large and should be split.

### 4.1 Refine user-provided tests (do not copy verbatim)

If the user provides test cases/examples:

- treat them as partial hints, not a complete test contract;
- preserve their intent, then expand to cover adjacent behavior;
- add missing happy/error/edge scenarios that are implied by the feature or fix;
- include at least one regression-oriented scenario for high-risk boundaries.

Do not output a plan that simply mirrors user-listed tests without refinement.

---

## Step 5 — Implementation Path

Derive the **shortest sequence of work steps** that gets from the current state to all acceptance criteria passing. This is not a template — tailor it to the actual task.

### Complexity calibration

Before listing steps, classify the task:

| Signal                                                 | Classification                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Change touches ≤ 2 files, no new interfaces            | **Nano** — skip design, go straight to implement + test                                                |
| New function or method, existing module                | **Small** — brief interface sketch, implement, test                                                    |
| New module, API endpoint, or cross-service interaction | **Medium** — interface definition → implement → integrate → test                                       |
| New subsystem, multi-service, or schema migration      | **Large** — requirements refinement → design → interface contracts → incremental implementation → test |

**Announce the verdict before listing steps.** State the classification and the primary signal that drove it in one sentence, so the user can push back if they disagree:

> **Complexity: Medium** — new module with two consumers; interface must be stable before implementation begins.

Let the classification **actively prune the plan**: a **Nano** task produces a minimal spec (goal + 1–2 ACs + one implementation step). Do not inflate a simple change into a multi-phase plan.

### Step format

List only the steps that apply. Skip any step that adds no value for this specific task.

```
1. [Step name] — [what to produce or decide; why it unblocks the next step]
2. ...
```

**Steps to include only when justified:**

| Step                     | Include when                                                          |
| ------------------------ | --------------------------------------------------------------------- |
| Requirements refinement  | Stakeholder alignment is unclear or scope is contested                |
| Interface / API design   | Multiple consumers, or the shape must be stable before implementation |
| Data model design        | Schema changes, migrations, or cross-service data contracts           |
| Prototype / spike        | Key technical risk that cannot be resolved by analysis alone          |
| Implementation           | Always                                                                |
| Unit / integration tests | Always (feed directly from acceptance criteria)                       |
| Documentation update     | Public API, CLI command, or user-visible behavior changes             |
| Rollout / migration plan | Data migrations, breaking changes, or phased rollouts                 |

**Never include:** "kickoff meeting", "stakeholder review", "sign-off", or any step whose only output is approval. If approval is genuinely required, note it as a constraint, not a step.

---

## Spec File Output

After producing the planning content, **always** save the spec to a Markdown file. Do this unconditionally.

### Required runtime artifact path

```

```

Also produce handoff:

```

```

Do not require users to pre-create these files; create/update them at runtime.

### File format

```markdown
<!--
  Planning Spec
  Generated by: Qoder /planning skill
  Date: <YYYY-MM-DD>
  Status: Draft
-->

# Plan: <Goal Statement>

**Complexity:** <Nano / Small / Medium / Large> — <one-sentence rationale>

## Goal

<Goal statement — one sentence>

## Deliverables

<Deliverable list>

**Out of scope:**
<Exclusions if any, or "None identified.">

## Acceptance Criteria

<AC table>

## Implementation Path

<Numbered step list>

## Open Questions

<Unresolved questions that block progress, or "None.">
```

### After writing the file

Tell the user:

1. The absolute paths of planning artifact and handoff files.
2. The **complexity verdict** and what it implies — e.g., "Nano: one file, straight to implementation" or "Medium: interface design first".
3. The number of acceptance criteria — this directly sets the floor for how many test cases `/testing-strategy` will need to produce.
4. The assumption list used to resolve ambiguity without asking follow-up questions.

Then suggest the next skill:

- If the implementation path includes system/API design: suggest `/architecture`
- If implementation is ready to start: suggest `/testing-strategy` to turn AC into a test plan

---

## If Connectors Available

If **~~project tracker** is connected:

- Pull the ticket or story to pre-fill requirements; cite the ticket ID in the spec.
- Link the saved spec file back to the ticket.

If **~~source control** is connected:

- Inspect the existing codebase to determine what already exists before listing deliverables.
- Avoid listing a deliverable that is already implemented.

If **~~knowledge base** is connected:

- Check for existing specs, ADRs, or design documents that constrain or inform this plan.
- Reference them in the spec under Open Questions or as constraints.

---

## Tips

1. **Effect over action** — "Users can do X" is always a better goal than "implement feature X". The effect defines done; the action just describes work.
2. **Fewer AC is better** — 3 tight acceptance criteria drive cleaner tests than 10 vague ones. If in doubt, ask: "would a failing test here catch a real regression?"
3. **Deliverables ≠ tasks** — A deliverable is something that exists; a task is something you do. Keep them separate.
4. **Nano tasks still need a minimal plan** — keep it compact, but still emit planning artifact + runtime todo/state files.
5. **The spec is a living document** — If reality diverges during implementation, update the spec rather than letting it go stale.
