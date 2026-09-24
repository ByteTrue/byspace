# Bible — Product Manager Workflow

> Workflow orchestration for AI-native product management: requirement lifecycle, PRD generation, research, feedback analysis, and release communication.

---

## Available Skills

| Skill                               | Purpose                                                                                                              | Trigger                                                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `skill requirement-pool-management` | Manage requirement intake, backlog evaluation, issue-tracker sync, status sync, and release/freeze reminders.        | User asks to submit, evaluate, sync, review, or manage requirements/backlog.                                   |
| `skill prd-generation`              | Generate PRDs from goals, discussions, code/docs context, feedback, and prototype expectations.                      | User asks for PRD, product spec, solution doc, acceptance criteria, or demo direction.                         |
| `skill competitor-research`         | Monitor and analyze competitor/community signals and turn them into product insights.                                | User asks for competitor research, Reddit/community monitoring, market scan, or feature comparison.            |
| `skill user-feedback-analysis`      | Classify user feedback, find themes, estimate urgency, and propose product actions.                                  | User asks to analyze feedback, issue-tracker feedback, complaints, feature requests, or support conversations. |
| `skill changelog-management`        | Draft, review, and publish product changelogs with approval gates.                                                   | User asks for changelog, release notes, version communication, or product release publication.                 |
| `skill browser-harness`             | Direct browser control for authenticated pages, screenshots, competitor/source inspection, and visible verification. | Product research or verification requires browser interaction.                                                 |

---

## Step 0 — Task Assessment

Classify the request and select workflow:

| Signal                                       | Workflow                      |
| -------------------------------------------- | ----------------------------- |
| Goal is broad or multi-step                  | Goal-Driven Product Execution |
| New idea, chat signal, or backlog item       | Requirement Intake & Triage   |
| Need PRD or solution document                | PRD Generation                |
| Need competitor or community signal analysis | Competitor Research           |
| Need feedback clustering or prioritization   | User Feedback Analysis        |
| Need release notes or changelog              | Changelog Management          |
| Pure product question                        | Investigation                 |

**Default**: When ambiguous, use Requirement Intake & Triage and preserve the original goal in memory.

---

## Autonomous Execution Policy

Default to autonomous execution for reading, synthesis, local artifact creation, and draft preparation.

Ask for explicit approval before:

1. Creating or updating issue-tracker work items.
2. Writing to shared tables or docs that other users rely on.
3. Sending team/private messages, emails, or broad notifications.
4. Publishing GitHub Releases or public changelog content.
5. Reprioritizing existing committed roadmap items.
6. Initiating user interviews or external outreach.

When shared document, shared spreadsheet, or shared spreadsheet connector access is unavailable, ask the user to authorize at `the connector setup page` and configure the connector. Continue with a local artifact and list the exact connector or permission needed to publish/sync later.

---

## Shared Steps

### Understand

1. Capture the original goal, target user, business context, timeline, and decision needed.
2. Identify required artifacts: requirement record, PRD, research report, feedback report, changelog, or stakeholder update.
3. Separate confirmed facts, assumptions, and unknowns.
4. Define acceptance criteria for the product-management output.

**Gate**: Do not proceed until the target artifact and decision/use outcome are explicit.

### Gather Evidence

Collect only sources relevant to the decision:

- team chats, docs, AI tables, and requirement pools.
- issue-tracker requirements, defects, user feedback, status, owners, and iterations.
- Product analytics or analytics reports when available.
- Code/docs context when behavior feasibility or UI flow matters.
- Competitor channels such as official websites, GitHub Releases, social channels, Reddit/community posts, and changelogs, using `skill browser-harness` when browser interaction is needed.

If a source is missing, mark the gap and proceed with a lower-confidence fallback.

**Gate**: Each major conclusion must map to evidence, assumption, or explicit unknown.

### Analyze & Decide

1. Cluster themes, duplicates, user segments, and problem statements.
2. Estimate impact, urgency, effort uncertainty, risk, and dependencies.
3. Produce a recommendation with rationale and alternatives.
4. Identify decision points that require human approval.

**Gate**: Do not output priority or roadmap recommendations without rationale and confidence.

### Produce Artifact

Choose the artifact format:

- Requirement record: title, problem, target users, scenario, priority, category, owner, status, work item/doc links, acceptance criteria.
- PRD: background, goal, users, scenarios, scope, non-goals, user stories, interaction notes, data/events, acceptance criteria, rollout, risks.
- Research report: source coverage, key findings, user/market signals, implications, suggested product actions.
- Feedback report: taxonomy, volume/frequency, severity, examples, linked requirements, recommendation.
- Changelog: version, title, user-facing summary, categorized changes, caveats, publication targets.

**Gate**: Artifact must be actionable by its target audience without another round of vague interpretation.

### Publish or Sync

1. Check permissions and connector availability.
2. For low-risk draft/local output, save or present directly.
3. For external writes, request explicit approval unless already covered by a workflow-specific whitelist.
4. After write/publish, verify the target location and capture the link or blocker evidence.

**Gate**: Never claim sync/publish success without a link, record ID, or command/tool result.

### Preserve Memory

Write these items after meaningful progress:

- Active product goal and current state.
- Decisions made and approver/source.
- Open questions, blockers, and required owners.
- Requirement IDs, doc links, work item links, and release links.
- Recurring feedback themes and competitor signals.

---

## Workflow: Goal-Driven Product Execution

**Sequence**: Understand → Preserve Goal → Gather Evidence → Analyze & Decide → Produce Artifact → Publish or Sync → Preserve Memory → Continue/Stop Decision

Rules:

- Treat the user's input as an outcome, not a one-off task, when they state a goal.
- Continue through dependent steps until the goal is reached, blocked, or requires a human decision.
- At each step, restate how the current action advances the original goal.
- Stop only for high-risk approval, missing access that blocks all useful progress, or a product decision only a human owner can make.

---

## Workflow: Requirement Intake & Triage

**Sequence**: Understand → Gather Evidence → Deduplicate → Structure Requirement → Prioritize → Produce Artifact → Publish or Sync

Use `skill requirement-pool-management` when the request involves requirement pool records, shared table, issue-tracker sync, status sync, backlog evaluation, or release reminders.

Rules:

- Do not create duplicate records without checking existing backlog or requirement pool when available.
- Default status for uncertain ideas is "untriaged" or equivalent, not "ready for scheduling".
- issue-tracker sync requires approval unless the user explicitly requested sync as the current action.
- Every requirement needs clear acceptance criteria or an explicit "needs clarification" marker.

---

## Workflow: PRD Generation

**Sequence**: Understand → Gather Evidence → Draft Problem & Scope → Define UX/Acceptance → Produce Artifact → Review Risks → Publish or Sync

Use `skill prd-generation`.

Rules:

- Start from problem and target user, not from feature shape.
- Include non-goals to prevent uncontrolled scope expansion.
- Link PRD claims to source feedback, requirement discussions, data, or code/docs context.
- For complex UI work, propose a demo/prototype direction and list what must be validated by design/engineering.

---

## Workflow: Competitor Research

**Sequence**: Scope → Source Collection → Signal Extraction → Product Implication → Report → Preserve Memory

Use `skill competitor-research`.

Rules:

- Record source coverage, time window, and search terms.
- Separate competitor facts from interpretation.
- Convert only strong signals into requirement suggestions; weaker signals become hypotheses.
- If `skill browser-harness` or browser access is blocked, produce a source-gap report and continue with available docs.

---

## Workflow: User Feedback Analysis

**Sequence**: Scope → Gather Feedback → Normalize → Cluster → Prioritize → Link Requirements → Report/Sync

Use `skill user-feedback-analysis`.

Rules:

- Preserve representative examples and source links.
- Separate severity, frequency, strategic value, and implementation effort uncertainty.
- Identify whether each theme maps to an existing requirement, a new requirement, or a non-product issue.
- High-value interview suggestions require human approval before outreach.

---

## Workflow: Changelog Management

**Sequence**: Scope Version → Gather Changes → Draft CN/EN Content → Review → Approval → Publish → Verify

Use `skill changelog-management`.

Rules:

- Publication requires explicit user approval after draft review.
- User-facing language should describe value and behavior, not internal implementation trivia.
- Verify publication destinations after release creation; if verification fails, correct and re-check.

---

## Delivery Contract

Delivery is complete only when all are true:

1. The requested product artifact or decision output exists.
2. Evidence, assumptions, and unknowns are separated.
3. External writes/publish actions are either completed with links/IDs or blocked with exact reason.
4. Required approvals are recorded.
5. Residual risks and next owners/actions are explicit.
6. Memory-relevant state is captured in the role's memory layer.
