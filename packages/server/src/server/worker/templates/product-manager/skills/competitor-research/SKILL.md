---
name: competitor-research
description: Collect competitor and community signals from public channels, summarize product implications, and convert strong signals into hypotheses or requirement suggestions.
version: 1.0.0
---

# Competitor Research

## When To Use

Use this skill when the user says:

- 竞品调研、社区调研、Reddit 监控
- 产品/竞品对比、社区讨论监控
- 分析竞品更新、GitHub Release、官网内容、X/LinkedIn 动态
- 找产品机会点或功能差距

## Source Plan

Choose sources based on the question:

- Official website and blog
- GitHub Releases and changelog
- Reddit/community discussion
- X/LinkedIn posts
- Product Hunt or launch directories
- Existing internal research docs

Record:

- Search terms
- Time window
- Source coverage
- Source gaps
- Access blockers

## Workflow

### 1. Scope

Define the competitor, feature area, time window, and decision this research should support.

### 2. Collect Signals

For each relevant source, capture:

- URL/source
- Publish or observation date
- Exact product change or user claim
- Engagement or discussion context when available
- Confidence level

If using `browser-harness`, handle login/CAPTCHA manually with user assistance rather than bypassing.

### 3. Normalize Findings

Classify each signal:

- New feature
- UX/workflow change
- Pricing/package change
- Positioning/message change
- User pain/complaint
- Adoption/traction signal
- Noise or low-confidence mention

### 4. Analyze Product Implication

For each strong signal:

- Why it matters
- Which user segment it affects
- Whether it creates threat, parity gap, or opportunity
- Suggested product response
- Evidence strength

### 5. Produce Report

Default report:

```markdown
# Competitor Research Report

## Scope

## Source Coverage

## Executive Summary

## Key Signals

## User Pain Points

## Feature/Positioning Comparison

## Product Implications

## Requirement Suggestions

## Open Questions and Next Sources
```

## Requirement Suggestion Rule

Only convert a competitor signal into a requirement suggestion when:

- It maps to a real target user or product strategy.
- There is evidence beyond a single weak mention, or the strategic risk is high enough to track.
- The suggested action includes a hypothesis and validation path.

## Publication

Publishing research to team chat Docs / 共享文档 requires approval. If the team chat document connector is unavailable, ask the user to authorize at `the connector setup page` and configure the connector; otherwise save/report as Markdown and include source links.

## Anti-Patterns

- Treating competitor announcements as proof of customer value.
- Hiding source gaps.
- Copying competitor features without user/problem fit.
- Mixing facts and speculation.
- Producing a report without a product implication.
