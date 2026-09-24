---
name: prd-generation
description: Generate product requirement documents from goals, discussions, user feedback, code/docs context, and prototype expectations.
version: 1.0.0
---

# PRD Generation

## When To Use

Use this skill when the user asks for:

- PRD、产品需求文档、方案文档
- 需求澄清和范围定义
- 用户故事、验收标准、非目标
- Demo/原型方向
- 将反馈、竞品信号或需求池记录转成可研发执行的文档

## Inputs

Required:

- Product goal or problem statement
- Target user or scenario

Optional:

- Existing requirement record
- User feedback or chat discussion
- Competitor signal
- Product analytics
- Code/docs context
- Design references or UI constraints

If key inputs are missing, proceed with assumptions and mark them explicitly.

## Workflow

### 1. Frame the Problem

Write:

- Background
- Target users
- Current pain
- Desired outcome
- Business/user value
- Evidence and source links

### 2. Define Scope

Separate:

- In scope
- Out of scope
- Non-goals
- Dependencies
- Assumptions

Never allow a PRD to hide scope uncertainty. If the boundary is unclear, create an explicit decision point.

### 3. Design User Flow

Describe the intended journey:

- Entry point
- Primary path
- Empty/loading/error states
- Permissions and role differences
- Notifications or external side effects
- Data created/updated

For UI-heavy work, include a demo/prototype direction and what engineering/design must validate.

### 4. Specify Requirements

Use structured user stories:

```markdown
### Requirement R1: [Title]

- User story:
- Scenario:
- Functional behavior:
- Data/field changes:
- Edge cases:
- Acceptance criteria:
- Priority:
```

### 5. Define Acceptance Criteria

Criteria must be testable:

- Happy path
- Primary error path
- Permission/edge path
- Data consistency path
- Observability or audit requirement when relevant

### 6. Risk Review

Call out:

- User experience risk
- Technical feasibility risk
- Data/privacy/security risk
- Rollout/migration risk
- Dependency and owner risk

### 7. Output PRD

Default PRD structure:

```markdown
# PRD: [Title]

## 1. Summary

## 2. Background and Evidence

## 3. Goal and Success Criteria

## 4. Users and Scenarios

## 5. Scope

## 6. Non-Goals

## 7. User Flow

## 8. Functional Requirements

## 9. Data and Permission Requirements

## 10. Acceptance Criteria

## 11. Rollout and Changelog Notes

## 12. Risks and Open Questions
```

## Publication

Create a shared document only after approval or direct user request. If the team chat document connector is unavailable, ask the user to authorize at `the connector setup page` and configure the connector; otherwise return Markdown and a proposed document title.

## Anti-Patterns

- Starting with a feature list before defining the problem.
- Missing non-goals.
- Writing acceptance criteria that QA cannot execute.
- Hiding assumptions inside confident language.
- Publishing a shared PRD before the user has reviewed the draft.
