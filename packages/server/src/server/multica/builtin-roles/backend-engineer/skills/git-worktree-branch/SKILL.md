---
name: git-worktree-branch
description: Manage Git repository discovery, temporary worktree branch setup, commit status, push, and PR publication evidence for repository-changing work. Use before editing files in a Git repo, when nested repositories may exist, when changes span multiple repositories, or before final delivery needs branch/PR status.
argument-hint: "<setup|status|publish|recover> [scope or changed files]"
---

# /git-worktree-branch

Own the Git worktree and publication discipline for repository-changing work.

## Usage

```text
/git-worktree-branch setup <scope>
/git-worktree-branch status
/git-worktree-branch publish
/git-worktree-branch recover <blocker>
```

## Core Rules

- Do not edit `main`, `master`, or the repository default branch directly.
- If already on a non-trunk task branch or inside a suitable temporary worktree, continue there and report the branch/path.
- If changes span multiple repositories, run this workflow separately for each repository.
- Never use destructive Git commands or force push unless the user explicitly requests that action.
- A nested repository is still a repository; do not bypass this workflow because the workspace root is not a Git checkout.

## Repository Discovery

Before declaring "no Git repository", check in this order:

1. Current location: `git status` or `git rev-parse --show-toplevel`.
2. Known target files: run `git rev-parse --show-toplevel` from each changed file's directory.
3. Fallback search: `find . -maxdepth 3 -type d -name .git 2>/dev/null`.

Record every affected repository root. If no repository is found, report the no-Git exception and continue without worktree setup.

## Setup Flow

For each affected repository:

1. Identify trunk: prefer the repository default branch, then `main`, then `master`.
2. Pick the **worktree base ref**: if the current working directory is inside the same Git repository and `git -C <work-dir> rev-parse --abbrev-ref HEAD` returns a non-`HEAD` branch, use that branch as the base ref so the worktree starts from where the user is actually working; otherwise fall back to trunk.
3. In the primary checkout, make sure the chosen base ref is current enough for the task; pull the latest base ref when network/credentials allow.
4. Create a timestamped branch and worktree from the chosen base ref:
   ```bash
   git worktree add -b task/<short-topic>-YYYYMMDD-HHMMSS ../<repo>-<short-topic>-YYYYMMDD-HHMMSS <base-ref>
   ```
   `<base-ref>` is the working-dir branch when available, otherwise trunk.
5. After `git worktree add` succeeds, resolve the worktree's **absolute path** and surface it to the user as the active working location:
   ```bash
   WORKTREE_ABS=$(cd ../<repo>-<short-topic>-YYYYMMDD-HHMMSS && pwd)
   echo "✅ Worktree ready at: $WORKTREE_ABS"
   ```
   The absolute path must be reported back to the user before any edits begin.
6. Move all repository edits, tests, generated artifacts, and docs changes into that worktree.
7. If `git worktree` is unavailable or blocked, report the exact command and error before using any fallback.

Required status record:

```text
Git workflow:
- repository:
- trunk:
- working-dir branch (detected):
- base ref used:
- primary checkout:
- worktree path (absolute):
- branch:
- PR target:
- blocker:
```

## Commit And Publish

After verification:

1. Commit the verified diff on the task/worktree branch.
2. Attempt publication only when credentials, remotes, and user authorization allow:
   ```bash
   git push -u origin <temporary-branch-name>
   gh pr create --title "<title>" --body "<body>" --base <trunk> --head <temporary-branch-name>
   ```
3. If `gh` is unavailable, use the repository hosting URL from `git remote get-url origin` and report the manual PR path.
4. Do not claim a PR exists unless there is a PR URL/reference. If publication fails, report the exact failed command, error output, current branch, and commit.

Publication failures after a verified local diff are delivery notes unless the user explicitly makes PR creation a blocking requirement.

## Output

```text
### Git Worktree Status
- Repository:
- Working-dir branch (detected):
- Base ref used:
- Branch:
- Worktree (absolute path):
- Trunk:
- Commit:
- Push command:
- PR command:
- PR URL:
- Blocker / next command:
```
