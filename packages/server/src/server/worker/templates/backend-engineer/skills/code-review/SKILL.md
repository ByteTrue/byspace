---
name: code-review
description: Review code changes for security, performance, and correctness. Trigger with a PR URL or diff, "review this before I merge", "is this code safe?", or when checking a change for N+1 queries, injection risks, missing edge cases, or error handling gaps. Also supports reviewing all commits on a specific branch within a given time range for a combined review.
argument-hint: "<PR URL, diff, file path, or 'repo=<url> branch=<branch> since=<date> until=<date>'>"
---

# /code-review

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../../CONNECTORS.md).

Review code changes with a structured lens on security, performance, correctness, maintainability, and contract compatibility.

## Usage

```
# Single commit or PR
/code-review <PR URL or file path>

# Combined review of all commits on a branch within a time range
/code-review repo=<repo-url-or-local-path> branch=<branch> since=<YYYY-MM-DD> until=<YYYY-MM-DD>
```

Review the provided code changes: @$1

If no specific file, URL, or parameters are provided, ask what to review.

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                      CODE REVIEW                                   │
├─────────────────────────────────────────────────────────────────┤
│  STANDALONE (always works)                                       │
│  ✓ Infer git clone URL from commit/PR URL and clone locally     │
│  ✓ Use local git tools to extract diff (git show / git diff)    │
│  ✓ Combined review of a branch over a date range               │
│  ✓ Security audit (OWASP top 10, injection, auth)               │
│  ✓ Performance review (N+1, memory leaks, complexity)           │
│  ✓ Correctness (edge cases, error handling, race conditions)    │
│  ✓ Style (naming, structure, readability)                        │
│  ✓ Actionable suggestions with code examples                    │
├─────────────────────────────────────────────────────────────────┤
│  SUPERCHARGED (when you connect your tools)                      │
│  + Source control: Pull PR diff automatically                    │
│  + Project tracker: Link findings to tickets                     │
│  + Knowledge base: Check against team coding standards           │
└─────────────────────────────────────────────────────────────────┘
```

## Obtaining the Diff — Priority Order

When given a URL (commit, PR, MR, etc.), **always attempt the following steps in order** before asking the user for anything\*\*:

### 1. Infer the clone URL from the page URL

Many hosted Git platforms follow predictable URL structures. Parse the given URL to extract
the repo clone address:

- **GitHub** — `https://github.com/<owner>/<repo>/commit/<sha>`  
  → clone `https://github.com/<owner>/<repo>.git`

- **GitLab / self-hosted GitLab** — `https://<host>/<owner>/<repo>/-/commit/<sha>`  
  → clone `https://<host>/<owner>/<repo>.git`

- **Gitee** — `https://gitee.com/<owner>/<repo>/commit/<sha>`  
  → clone `https://gitee.com/<owner>/<repo>.git`

- **Generic three-level path** (`<domain>/<project>/<repo>/...`)  
  → clone `https://<domain>/<project>/<repo>.git`

For PR / MR URLs the repo path is extracted the same way; the PR number is used later to
fetch the diff (see step 3).

### 2. Try to clone using the user's login shell

Run git inside a **login shell** so that credential helpers, SSH agents, and shell profile
configurations (`.bash_profile`, `.zprofile`, etc.) are active:

```bash
bash -l -c "git clone <clone-url> <local-tmp-dir>"
```

If the repo is already cloned locally (path mentioned by the user or visible in the working
directory), skip cloning and use that path directly.

### 3. Extract the diff with local git

| Input type        | Command                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------- |
| Commit SHA        | `bash -l -c "git -C <repo> show <sha>"`                                                 |
| PR / MR number    | `bash -l -c "git -C <repo> fetch origin pull/<n>/head && git show FETCH_HEAD"` (GitHub) |
| Branch comparison | `bash -l -c "git -C <repo> diff <base>..<head>"`                                        |

### 4. Fall back gracefully

Only if all git-based attempts fail (auth error, network unreachable, unsupported platform),
**then** ask the user to paste the diff or provide a `.patch` file. Explain briefly why the
automatic approach failed.

## Branch + Time-Range Combined Review

When the user provides a repository (URL or local path), a branch name, and a date range
(`since` / `until`), collect all matching commits and produce a **single aggregated review**
instead of reviewing each commit individually.

### Step-by-step

**1. Ensure the repo is available locally**

```bash
# Remote repo — clone once into a temp directory
bash -l -c "git clone <repo-url> <tmp-dir>"

# Already local — use the path directly
```

**2. Fetch the target branch**

```bash
bash -l -c "git -C <repo> fetch origin <branch>"
```

**3. List all commits in the time range**

```bash
bash -l -c "git -C <repo> log origin/<branch> \
  --after='<since>' --before='<until>' \
  --format='%H %s' --no-merges"
```

- `--after` / `--before` accept `YYYY-MM-DD` or any date Git understands.
- Omit `--no-merges` if the user explicitly wants merge commits included.
- If no commits are found, report that and stop.

**4. Obtain the combined diff**

```bash
# Get the oldest and newest commit SHA from step 3, then:
bash -l -c "git -C <repo> diff <oldest-sha>^..<newest-sha>"
```

If only one commit exists in the range, fall back to `git show <sha>`.

**5. Build context: per-commit summary**

```bash
bash -l -c "git -C <repo> log origin/<branch> \
  --after='<since>' --before='<until>' \
  --format='%H %ad %an %s' --date=short --no-merges"
```

Use this list as the "Commit History" section in your review output (see below).

### Parameter inference

| User says                           | Interpretation                          |
| ----------------------------------- | --------------------------------------- |
| `since=2024-01-01` only             | `until` defaults to today               |
| `until=2024-06-30` only             | `since` defaults to repo's first commit |
| `branch` omitted                    | Use the repo's default branch           |
| relative dates (`since=1 week ago`) | Pass directly to `git log --after`      |

## Review Dimensions

### Security

- SQL injection, XSS, CSRF
- Authentication and authorization flaws
- Secrets or credentials in code
- Insecure deserialization
- Path traversal
- SSRF

### Performance

- N+1 queries
- Unnecessary memory allocations
- Algorithmic complexity (O(n²) in hot paths)
- Missing database indexes
- Unbounded queries or loops
- Resource leaks

### Correctness

- Edge cases (empty input, null, overflow)
- Race conditions and concurrency issues
- Error handling and propagation
- Off-by-one errors
- Type safety

### Contract Compatibility

- Backward compatibility of function/API behavior
- Default-value semantics (`undefined` vs empty object, null handling, optional args)
- Output shape/format stability (field names, masking format, ordering-sensitive behavior)
- Side effects and call sequencing expected by existing tests or consumers
- Declared deliverable contract (required file path/name/entrypoint)

### Maintainability

- Naming clarity
- Single responsibility
- Duplication
- Test coverage
- Documentation for non-obvious logic

### Existing-Test Integrity

- Check whether existing tests were weakened, deleted, or rewritten to fit new behavior.
- Flag any expectation changes that alter legacy contract without explicit requirement.
- If this review is part of a regression-sensitive bug-fix chain, return an explicit delivery-gate recommendation.

### Delivery Contract Gate Audit

- Validate deliverable path/name/entrypoint alignment with the declared contract.
- Check whether at least one target acceptance command/result is present in evidence.
- Require failure-closure evidence format for fixes: `before signature -> command -> after result`.
- Block delivery recommendation if the contract check block is incomplete.

## Output

For a **single commit / PR**:

```markdown
## Code Review: [PR title or file]

### Summary

[1-2 sentence overview of the changes and overall quality]

### Critical Issues

| #   | File   | Line   | Issue         | Severity    |
| --- | ------ | ------ | ------------- | ----------- |
| 1   | [file] | [line] | [description] | 🔴 Critical |

### Contract & Regression Risks

| #   | File   | Contract Surface                        | Risk            | Evidence                      |
| --- | ------ | --------------------------------------- | --------------- | ----------------------------- |
| 1   | [file] | [API/test expectation/default semantic] | [breakage risk] | [existing test/diff evidence] |

### Suggestions

| #   | File   | Line   | Suggestion    | Category    |
| --- | ------ | ------ | ------------- | ----------- |
| 1   | [file] | [line] | [description] | Performance |

### Existing-Test Integrity Check

| Test file | Change type                 | Risk                  | Recommendation |
| --------- | --------------------------- | --------------------- | -------------- |
| [file]    | [weakened/deleted/reframed] | [contract drift risk] | [action]       |

### Delivery Contract Gate Check

| Gate                              | Status  | Evidence                     | Blocking note |
| --------------------------------- | ------- | ---------------------------- | ------------- |
| Path/filename contract            | ✅ / ❌ | [write/readback/path proof]  | [if blocked]  |
| Target acceptance check           | ✅ / ❌ | [target command + result]    | [if blocked]  |
| Verification closure              | ✅ / ❌ | [before -> command -> after] | [if blocked]  |
| Contract check block completeness | ✅ / ❌ | [fields present/missing]     | [if blocked]  |

### What Looks Good

- [Positive observations]

### Verdict

[Approve / Request Changes / Needs Discussion]

### Delivery Gate Recommendation (Regression-Sensitive Bug Fix)

- **Recommendation**: [Pass / Block]
- **Blocking reasons**: [contract/regression risks that must be fixed before delivery]
- **Gate verdict summary**: [which delivery contract gates failed, if any]

### Stage State Update
```

For a **branch + time-range combined review**:

```markdown
## Code Review: [repo] · [branch] · [since] → [until]

### Commit History ([N] commits)

| SHA     | Date       | Author | Message                  |
| ------- | ---------- | ------ | ------------------------ |
| abc1234 | 2024-03-01 | Alice  | feat: add login endpoint |

### Summary

[Overview of what this batch of commits achieves and overall quality]

### Critical Issues

| #   | File   | Line   | Issue         | Severity    | Commit  |
| --- | ------ | ------ | ------------- | ----------- | ------- |
| 1   | [file] | [line] | [description] | 🔴 Critical | abc1234 |

### Contract & Regression Risks

| #   | File   | Contract Surface                        | Risk            | Commit  | Evidence    |
| --- | ------ | --------------------------------------- | --------------- | ------- | ----------- |
| 1   | [file] | [API/test expectation/default semantic] | [breakage risk] | abc1234 | [reference] |

### Suggestions

| #   | File   | Line   | Suggestion    | Category    | Commit  |
| --- | ------ | ------ | ------------- | ----------- | ------- |
| 1   | [file] | [line] | [description] | Performance | def5678 |

### Existing-Test Integrity Check

| Test file | Change type                 | Risk                  | Commit  | Recommendation |
| --------- | --------------------------- | --------------------- | ------- | -------------- |
| [file]    | [weakened/deleted/reframed] | [contract drift risk] | abc1234 | [action]       |

### Delivery Contract Gate Check

| Gate                              | Status  | Evidence                     | Commit  | Blocking note |
| --------------------------------- | ------- | ---------------------------- | ------- | ------------- |
| Path/filename contract            | ✅ / ❌ | [write/readback/path proof]  | abc1234 | [if blocked]  |
| Target acceptance check           | ✅ / ❌ | [target command + result]    | abc1234 | [if blocked]  |
| Verification closure              | ✅ / ❌ | [before -> command -> after] | abc1234 | [if blocked]  |
| Contract check block completeness | ✅ / ❌ | [fields present/missing]     | abc1234 | [if blocked]  |

### Cross-Commit Observations

- [Patterns, inconsistencies, or concerns that span multiple commits]

### What Looks Good

- [Positive observations]

### Verdict

[Approve / Request Changes / Needs Discussion]

### Delivery Gate Recommendation (Regression-Sensitive Bug Fix)

- **Recommendation**: [Pass / Block]
- **Blocking reasons**: [cross-commit contract/regression blockers]
- **Gate verdict summary**: [which delivery contract gates failed, if any]
```

## Report File Output

After producing the review content, **always** save the complete review to a Markdown report file. Do this unconditionally — it is not optional.

### File naming

| Review type         | Filename pattern                                    |
| ------------------- | --------------------------------------------------- |
| Single commit / PR  | `code-review-<repo>-<short-sha-or-pr>.md`           |
| Branch + time-range | `code-review-<repo>-<branch>-<since>-to-<until>.md` |

Use only lowercase letters, digits, and hyphens. Truncate repo name to its last path segment (e.g. `qoder-cloud-cli`). Example: `code-review-qoder-cloud-cli-main-2026-04-16-to-2026-04-16.md`.

Save the file in the **current working directory** unless the user specifies otherwise.

### Report file format

The file must open with a metadata header that clearly identifies it as a code review artifact:

```markdown
<!--
  Code Review Report
  Generated by: Qoder /code-review skill
  Date: <YYYY-MM-DD>
  Repository: <repo URL or local path>
  Branch / Ref: <branch or commit range>
  Period: <since> → <until>  (omit for single-commit reviews)
  Verdict: <Approve | Request Changes | Needs Discussion>
-->

# Code Review Report

> **This file is the output of an automated code review.**
> Repository: `<repo>` · Branch: `<branch>` · Date: `<YYYY-MM-DD>`

---
```

Then append the full review content (Commit History, Summary, Critical Issues, Suggestions, Cross-Commit Observations, What Looks Good, Verdict) exactly as it appears in the conversation output.

### After writing the file

Tell the user the absolute path of the saved report file so they can locate it immediately.

## If Connectors Available

If **~~source control** is connected:

- Pull the PR diff automatically from the URL
- Check CI status and test results

If **~~project tracker** is connected:

- Link findings to related tickets
- Verify the PR addresses the stated requirements

If **~~knowledge base** is connected:

- Check changes against team coding standards and style guides

## Tips

1. **Provide context** — "This is a hot path" or "This handles PII" helps me focus.
2. **Specify concerns** — "Focus on security" narrows the review.
3. **Include tests** — I'll check test coverage and quality too.
4. **Branch review shorthand** — `repo=./myapp branch=main since=2024-01-01` reviews all commits on `main` since January 2024 in one pass.
5. **Relative dates work** — `since="1 week ago"` or `since="last monday"` are valid.
