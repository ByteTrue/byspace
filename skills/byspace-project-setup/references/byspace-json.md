# byspace.json reference

`byspace.json` lives at the repository root. BySpace reads project configuration from the committed base branch when creating worktrees, so a new or changed file affects future worktrees after the change reaches that branch.

Keep configuration minimal and preserve fields you do not own. Existing files may contain newer fields than this skill knows.

## Shape

```json
{
  "worktree": {
    "setup": ["command one", "command two"],
    "teardown": "one command or multiline script",
    "terminals": [{ "name": "logs", "command": "tail -f dev.log" }],
    "servicePorts": {
      "range": "3000-3999"
    }
  },
  "scripts": {
    "check": {
      "command": "project check command"
    },
    "web": {
      "type": "service",
      "command": "project dev command using $BYSPACE_PORT"
    }
  },
  "metadataGeneration": {
    "title": { "instructions": "Project-established title convention." },
    "branchName": { "instructions": "Project-established branch convention." },
    "commitMessage": { "instructions": "Project-established commit convention." },
    "pullRequest": { "instructions": "Project-established pull-request convention." }
  }
}
```

All sections and entries are optional. Omit empty sections.

## Worktree lifecycle

`worktree.setup` and `worktree.teardown` accept either one string or an array of strings. Commands run sequentially with the worktree as the working directory.

Lifecycle commands run through Bash on macOS/Linux and PowerShell on Windows. For a project that supports both, do not assume POSIX-only inline environment assignment, `$VAR` expansion, `cp`, or shell scripts. Put environment-sensitive logic in an existing cross-platform task or a small project-native script when necessary.

Use setup for work every clean worktree requires. Keep optional or expensive tasks on demand.

Use teardown only for resources owned and precisely identified by this worktree. Never add broad deletion as a convenience.

## Scripts

A plain script is an on-demand command:

```json
{
  "scripts": {
    "typecheck": { "command": "npm run typecheck" }
  }
}
```

A service is a supervised long-running process:

```json
{
  "scripts": {
    "web": {
      "type": "service",
      "command": "npm run dev -- --port $BYSPACE_PORT"
    }
  }
}
```

Omit a service `port` to let BySpace allocate one. An explicit numeric `port` is an override, not the preferred parallel-worktree default.

Services receive:

- `BYSPACE_PORT` — this service's assigned port
- `BYSPACE_URL` — this service's proxied URL
- `BYSPACE_SERVICE_<NAME>_PORT` — a peer service's current port
- `BYSPACE_SERVICE_<NAME>_URL` — a peer service's stable proxied URL
- `HOST` — bind host chosen for the daemon context

Script names are upper-cased for peer variables and runs of non-alphanumeric characters become `_`. Prefer peer `_URL` values when the application accepts URLs; they remain stable across peer restarts.

A command is not ready to become a service until the underlying process actually binds to the assigned host/port. Inspect the project's real CLI/configuration rather than guessing a framework flag.

## Worktree environment

Lifecycle commands, scripts, and services receive:

- `BYSPACE_SOURCE_CHECKOUT_PATH` — original repository root
- `BYSPACE_WORKTREE_PATH` — created worktree directory
- `BYSPACE_BRANCH_NAME` — worktree branch

Use `BYSPACE_SOURCE_CHECKOUT_PATH` only when the project truly needs machine-local state from the source checkout. Ask before copying ignored files that may contain secrets.

## Terminals and service port policy

`worktree.terminals` opens commands automatically after worktree creation. Each item requires `command`; `name` is optional. Prefer services or on-demand scripts unless automatic interactive/observation behavior is useful for every worktree.

`worktree.servicePorts` may contain either:

```json
{ "range": "3000-3999" }
```

or:

```json
{ "portScript": "path/to/allocator" }
```

Do not add a port policy without a repository-specific reason; default automatic allocation is usually sufficient.

## Metadata instructions

Each `metadataGeneration` instruction replaces BySpace's default style for that metadata kind. Keep the functional request intact and describe only repository-established wording or naming conventions.

## Editing rules

- Parse the existing file before editing.
- If it is invalid, report the parse problem; do not replace it.
- Preserve unknown top-level, worktree, script, and metadata fields.
- Preserve existing string-vs-array lifecycle representation when practical.
- Add only approved entries and remove only entries the user approved removing.
- Format as ordinary readable JSON and inspect the final diff.
