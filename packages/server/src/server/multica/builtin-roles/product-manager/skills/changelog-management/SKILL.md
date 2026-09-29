---
name: changelog-management
description: Draft, review, publish, and verify product changelogs and release notes with approval gates.
version: 1.0.0
---

# Changelog Management

## When To Use

Use this skill when the user asks to:

- 生成 Changelog、Release Notes、发版说明
- 从代码提交或需求状态生成产品变更日志
- 发布中英文 GitHub Release 或其他产品发布说明
- 检查官方 changelog 页面展示

## Workflow

### 1. Scope Version

Confirm:

- Version number
- Release date
- Target repositories or publication destinations
- Source of truth for shipped changes
- Whether images/videos are needed

If the version is unclear, ask once before drafting.

### 2. Gather Changes

Sources may include:

- shared changelog document
- Requirement pool records marked completed/released
- Completed work items
- Git commit summaries
- Product owner notes

Classify changes:

- New features
- Improvements
- Fixes
- Enterprise/admin changes
- Known limitations

### 3. Draft User-Facing Content

Write for users, not for internal implementation logs.

Recommended format:

```markdown
[1-2 sentence release summary]

**[emoji] [Category]**

- **[Feature title]**
  [One-line user value description]

**[emoji] Fixes**

- [Fix description]
```

For bilingual releases, maintain semantic equivalence between Chinese and English rather than literal translation.

### 4. Review Gate

Present the exact Markdown that will be published. Ask whether there are images or hosted media links to embed.

Do not publish until the user explicitly approves.

### 5. Publish

After approval:

- Create/update Chinese release target.
- Create/update English release target.
- Use the approved title, tag, body, and media links.
- Record release URLs.

### 6. Verify

Open and inspect publication targets:

- Chinese GitHub Release
- English GitHub Release
- Official changelog page if configured

Check:

- New version appears in the expected position.
- Markdown renders correctly.
- Images/videos load.
- CN/EN content matches the approved draft.

If verification fails, correct only the changelog draft, release metadata, or publication content and re-verify. Do not modify formal business code or product source as part of changelog work.

## Permission Gates

Publishing requires explicit approval. Public release changes are never low-risk drafts.

## Anti-Patterns

- Publishing from unreviewed text.
- Describing only internal implementation instead of user value.
- Losing parity between Chinese and English release notes.
- Skipping post-publish verification.
- Using unhosted or temporary media links in release notes.
