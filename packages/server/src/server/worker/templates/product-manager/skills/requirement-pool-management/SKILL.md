---
name: requirement-pool-management
description: Manage the full product requirement lifecycle: brainstorm, submit, evaluate backlog, synchronize status with issue tracker, review progress, and trigger release/freeze reminders.
version: 1.0.0
---

# Requirement Pool Management

## When To Use

Use this skill when the user asks to:

- 需求脑暴讨论、提交需求、录入需求池
- 评估 Backlog、调整优先级、按团队配置的分类体系归类
- 同步需求到 通用 backlog
- 双向同步需求库和 issue tracker 状态
- 审查需求进度、输出管道风险
- 封版/发版提醒和发版清单汇总

## Core Workflow

### 1. Intake

Collect the original idea, target user, problem, scenario, expected value, urgency, and source. If the user only gives a vague idea, ask only the minimum clarifying questions needed to create a useful draft.

Output:

- Requirement title
- Problem statement
- Target users
- Scenario and trigger
- Expected outcome
- Source and requester
- Open questions

### 2. Deduplicate

Search the requirement repository and issue tracker when connectors are available. Match by product area, problem statement, user segment, and expected behavior.

Rules:

- If a likely duplicate exists, propose merge/update instead of creating a new record.
- If the connector is unavailable, mark deduplication as "not verified" and keep the artifact local.

### 3. Structure and Classify

Normalize the requirement into fields:

- Category or product area according to the team's taxonomy
- Subcategory when available
- Priority according to the team's priority scheme
- Status according to the team's lifecycle states
- Owner and stakeholders
- Acceptance criteria
- Document link and work item link when available

### 4. Backlog Evaluation

Evaluate impact, urgency, strategic fit, effort uncertainty, dependency, and risk.

Output a recommendation:

```markdown
## Backlog Evaluation

- Recommendation: [priority/status/category]
- Rationale:
- Evidence:
- Risks:
- Open questions:
- Suggested next action:
```

### 5. Sync to issue tracker

Only sync after explicit user approval or when the user directly requested sync as the current action.

Required mapping:

- Requirement title -> issue-tracker work item title
- Problem/scenario/acceptance criteria -> issue-tracker description
- Priority -> issue-tracker priority field
- Pipeline/category -> tags or configured fields
- Requirement source -> source field
- Requirement pool record link -> reference link

After sync, write back the work item link to the requirement repository when permitted.

### 6. Status Sync

Compare requirement repository status and issue-tracker status. Detect:

- issue-tracker status changed but requirement repository is stale
- Requirement priority changed but the issue tracker is not updated
- Missing or broken work item link
- Completed work item without changelog/release note candidate

Do not overwrite conflicting status silently. Present a diff and ask for approval when data conflicts.

### 7. Progress Review

Group by configured category and status:

Report:

- Status distribution
- Priority distribution
- Aging/overdue items
- issue-tracker sync rate
- Blocked items and owner
- Recommended interventions

### 8. Release and Freeze Reminders

When release cadence is configured, prepare:

- Freeze-day list: unfinished committed requirements, owner, risk, next action
- Release-day list: shipped requirements, user-facing summary, changelog candidate

Sending messages requires approval.

## Connector Use

Preferred connectors:

- shared spreadsheet connector for requirement pool read/write; if unavailable, ask the user to authorize at `the connector setup page` and configure the connector
- shared document connector for requirement/PRD document creation; if unavailable, ask the user to authorize at `the connector setup page` and configure the connector
- issue tracker Coop for work item creation, status, iteration, member lookup
- team chat for approved team notifications

If any connector is unavailable, produce a local Markdown/table artifact and include exact fields needed for later sync.

## Permission Gates

Explicit approval is required before:

- Creating or updating shared requirement pool records
- Creating or updating issue tracker work items
- Sending group notifications
- Changing release/freeze reminder schedules

## Anti-Patterns

- Creating duplicate requirements without checking existing backlog.
- Marking vague ideas as ready for scheduling before problem validation.
- Assigning top priority without urgency and impact evidence.
- Silently resolving issue-tracker/requirement-repository status conflicts.
- Treating release reminders as spam instead of targeted owner actions.
