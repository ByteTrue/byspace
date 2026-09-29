---
name: github-developer-communication
description: Manage GitHub issue communication and workflow status updates during QA execution.
---

# GitHub Developer Communication

This skill handles GitHub-side collaboration, not implementation.

## Trigger

Use immediately when any of the following appears:

- User references a GitHub issue number or URL.
- `GITHUB_ISSUE` is provided.
- User requests issue updates, comments, labels, assignee changes, or completion notifications.

## Responsibilities

1. Read issue context (title/body/comments/labels/assignees).
2. Update workflow labels (for example in-progress / clarification-needed / needs-review).
3. Ask clarifying questions by mentioning issue author when information is insufficient.
4. Publish QA outcomes with evidence summary and links (PR/check logs/screenshots references).
5. Keep comments concise, structured, and professional.

## Required constraints

- Do not implement code fixes in this skill.
- Do not claim completion without test evidence.
- If permissions/auth are blocked, report exact blocker and next `gh` command.

## Common `gh` commands

```bash
gh issue view <number> --json number,title,body,author,assignees,labels,comments,url,state
gh label list --json name,description,color
gh issue edit <number> --add-label "in-progress" --add-assignee "@me"
gh issue comment <number> --body "<status update>"
```
