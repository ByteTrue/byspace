---
name: user-feedback-analysis
description: Analyze user feedback from issue tracker, chats, support channels, and documents; cluster themes; estimate urgency; and propose requirement or research actions.
version: 1.0.0
---

# User Feedback Analysis

## When To Use

Use this skill when the user asks to:

- 分析用户反馈、客户声音、issue tracker 反馈
- 聚合投诉、缺陷、需求建议
- 判断反馈优先级、紧急度、影响面
- 从反馈生成需求建议
- 找高价值用户访谈对象或跟进问题

## Inputs

Preferred sources:

- Issue-tracker feedback or defects
- team chat conversations
- Support tickets or customer success notes
- Existing requirement pool records
- Product analytics or analytics reports

If sources are unavailable, analyze provided text and mark coverage limitations.

## Workflow

### 1. Collect and Normalize

Normalize every feedback item:

- Source
- User/account/segment if allowed
- Date
- Product area
- Raw feedback summary
- Sentiment
- Severity
- Frequency
- Related requirement/defect if known

Protect privacy. Do not expose sensitive user identifiers in public artifacts.

### 2. Cluster Themes

Group by:

- Problem type
- Product area
- User segment
- Job-to-be-done
- Severity and frequency
- Current workaround

Mark duplicates and near-duplicates.

### 3. Prioritize

Use a transparent model:

- Impact: number/value of affected users
- Urgency: blocking, time-sensitive, or repeated escalation
- Strategic fit: alignment with product direction
- Effort uncertainty: engineering/design/data unknowns
- Confidence: source quality and sample size

Priority recommendation must include rationale, not only a label.

### 4. Link to Product Actions

For each theme, decide:

- Existing requirement: update/raise priority
- New requirement: create draft
- Defect: route to QA/engineering
- Research needed: interview/survey/data analysis
- No product action: explain why

### 5. Output Report

```markdown
# User Feedback Analysis

## Source Coverage

## Executive Summary

## Theme Clusters

## Priority Recommendations

## Linked Requirements and Defects

## Suggested New Requirements

## Interview Candidates or Follow-up Questions

## Risks, Unknowns, and Next Actions
```

## Interview Trigger

Recommend a deep interview when:

- Feedback is high-value but ambiguous.
- Multiple users hit the same workflow failure.
- The cost of building the wrong solution is high.

Outreach requires explicit approval and approved message copy.

## Anti-Patterns

- Counting duplicate feedback as independent demand.
- Prioritizing only by loudest user.
- Ignoring negative evidence or low sample size.
- Creating requirements without linking source feedback.
- Exposing private feedback in broad/public reports.
