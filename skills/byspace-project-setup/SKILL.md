---
name: byspace-project-setup
description: Assess and configure a repository for productive BySpace worktrees and agents. Use whenever the user asks to set up, configure, generate, improve, or review byspace.json; prepare a project for BySpace; fix weak worktree setup; expose dev servers or common project commands; or asks what project infrastructure is missing for parallel agent work. Proactively discover readiness gaps instead of waiting for the user to name them.
user-invocable: true
argument-hint: "[project goal or constraint]"
---

# BySpace Project Setup

Make the repository easy to use from a clean, parallel BySpace worktree. Do more than translate existing commands into `byspace.json`: find evidence-backed gaps the user may not know to ask about, recommend the smallest useful fixes, and apply only what they approve.

**User's request:** $ARGUMENTS

## Outcome

A good result answers three questions:

1. Can a clean worktree become usable repeatably?
2. Are the project's common commands and long-running services easy for people and agents to run?
3. Can multiple worktrees run without colliding or damaging shared resources?

This is local development readiness, not a generic DevOps audit. Do not expand into CI/CD, production deployment, monitoring, release engineering, or framework scaffolding unless the user explicitly asks for that separate work.

## Read before acting

Read:

- [Project readiness](references/project-readiness.md) for the cross-language assessment model.
- [byspace.json](references/byspace-json.md) before proposing or editing BySpace configuration.

Then inspect the repository's own instructions and evidence. Prefer, in order:

- `AGENTS.md` / `CLAUDE.md`, README, contributing and development docs
- existing `byspace.json`
- manifests, lockfiles, workspace definitions, task runners, and compose files
- project scripts and config files
- `.gitignore` plus example environment/config files
- CI commands and repository conventions

Check `git status` before editing. Preserve unrelated user changes.

Do not read secret files merely because they exist. File names, ignore rules, examples, and documented requirements are usually enough. Read a secret only when the user explicitly authorizes it and its contents are genuinely required.

## Workflow

### 1. Inspect without changing files

Build a concise model of:

- dependency restoration and package/tool selection
- required local-only files and environment inputs
- bootstrap, generation, build, migration, or seed steps
- frequent one-off commands
- long-running processes, ports, and service dependencies
- worktree-specific resource names and cleanup risks
- existing branch, commit, and pull-request conventions

Do not infer project type from language alone. Infer behavior from commands, configs, imports, docs, and runtime entry points.

### 2. Turn evidence into recommendations

Every recommendation must have this chain:

```text
repository evidence
  → observable clean-worktree friction or parallelism risk
  → recommendation
  → exact proposed change
```

No evidence means no recommendation. Do not fill the report with generic best practices.

Treat existing valid configuration as user intent. Do not recommend deleting a harmless existing field solely because the current repository makes it a no-op; propose removal only when it causes observable friction or risk, or when the user explicitly asks for cleanup.

Prefer existing project commands. If the repository lacks a stable command, recommend a minimal project-native script only when it removes real repeated setup or hides necessary cross-platform/environment complexity. Use the standard library or existing dependencies; do not add a tool just to create a wrapper.

### 3. Present the readiness report

Respond in the user's language. Use only the sections that contain findings:

```markdown
## Project readiness

### Needs attention

1. **Finding**
   - Evidence: ...
   - Why it matters: ...
   - Proposed change: ...

### Worth adding

...

### Not recommended

- ... because ...

### Needs your decision

1. ...

### Proposed files

- `byspace.json`: ...
- `path/to/project-script`: ...
```

Use **Needs attention** for a clean-worktree failure or concrete collision/data risk. Use **Worth adding** for high-leverage convenience grounded in repeated project behavior. Use **Not recommended** sparingly to make an important omission explicit. Use **Needs your decision** for secrets, shared resources, destructive cleanup, competing service choices, or genuine product preference.

If the project is already ready, say so and recommend no change.

### 4. Get approval before editing

A fresh invocation authorizes inspection and recommendations, not file changes. Ask the user to approve all or selected items. Do not repeat questions the repository already answers.

A prior explicit approval of the exact proposed changes is sufficient. Even with broad approval, separately confirm creating ignored local environment/config files, copying secrets, creating or deleting data, mutating shared infrastructure, or adding destructive teardown.

### 5. Apply the approved minimum

Implement only approved recommendations:

- edit existing project-native commands rather than creating parallel entry points
- add the smallest script that makes a real multi-step or cross-platform operation stable
- merge into an existing valid `byspace.json`; never replace unknown fields or unrelated entries
- stop and report an invalid existing `byspace.json` rather than overwriting it
- omit empty sections and speculative configuration
- never commit, push, deploy, or run destructive cleanup unless separately requested

For services, adapt the real command to BySpace's dynamic port and peer-service environment instead of merely labeling an incompatible fixed-port command as a service.

### 6. Validate and report

At minimum:

- parse the final JSON
- inspect the final diff for unrelated changes and preserved existing configuration
- verify referenced commands/scripts exist
- run the narrowest safe, non-destructive check that proves a new helper works

Do not run teardown, migrations against shared data, or long-lived services merely to claim validation. Ask before expensive or side-effectful checks.

Finish with:

```markdown
## Applied

- ...

## Validation

- `command` — result

## Deferred

- ... and why
```

If nothing was changed, say that directly.

## Guardrails

- Active does not mean indiscriminate: useful omissions are part of good setup.
- A lockfile may justify deterministic dependency restoration; a language name does not.
- An ignored `.env` may justify a question. Creating one from a checked-in example requires exact approval; copying machine-local secrets additionally requires explicit authorization to read/copy them.
- A command named `dev` is not automatically a service; confirm that it is long-running and how it binds.
- A teardown command must remove only resources owned by that worktree. If ownership cannot be proven, omit it.
- Fixed ports, database names, container names, volumes, sockets, and cache paths are parallelism risks. Recommend isolation only when the repository shows the risk.
- Metadata instructions should reflect documented or clearly established conventions, not preferences invented by the skill.
