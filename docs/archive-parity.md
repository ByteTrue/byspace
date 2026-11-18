# Reading the archived Node daemon

The Go daemon in `internal/` is a port of the Node daemon that shipped before it. That daemon's
source is no longer in the working tree: it lives in the git tag **`v0.20.0`**, the last release
that shipped `packages/server/` (the daemon) and `packages/cli/` (the command line). Read it with
`git show`, the same way [AGENTS.md](../AGENTS.md) reads the retired Expo app from `archive/expo-app`.

It exists to answer one question, which comes up on almost every bug report: **did the port break
this, or was it always like this?**

## When to read it

Read the archived source before you change Go behaviour, in these cases:

- A test fails and you cannot tell whether the expectation describes the product or describes the
  old implementation.
- A field is missing from a response and you are about to add it.
- A limit, timeout, retry count or truncation length looks arbitrary.
- A user reports something the app does not do, and you are deciding whether it is a regression.

## How to read it

The port kept file-for-file, function-for-function correspondence wherever it could. Find the Go
call site first, then open the archived file with the same path: `internal/server/ws_git_system.go`
came from `packages/server/src/server/session.ts` (grep for the RPC name, not the filename — that
file is one of the big ones), `internal/workspace/git.go` from
`packages/server/src/utils/checkout-git.ts`, `internal/cli/main.go` from `packages/cli/src/cli.ts`.

Comments in the Go source cite the archived file and line when the behaviour is non-obvious
(`node daemon: checkout-git.ts:2727`). Search the tagged tree for the quoted constant or message
string; that lands faster than reading either file top to bottom.

```bash
git show v0.20.0:packages/server/src/server/persisted-config.ts
git grep -n "Cannot rewind before the provider" v0.20.0 -- packages/
git grep -n "PORT_SCRIPT_TIMEOUT_MS" v0.20.0 -- packages/server/src
```

## What the archive settles, and what it does not

**It settles intent.** A surprising timeout, an ordering rule, a field that looks redundant — the
archived code shows what the value was chosen for. A `git` call with `--numstat --raw -M` is there
because the diff panel needs renames; the Go port that dropped the flag was wrong, and only the
archived source makes that legible.

**It does not settle correctness.** The Node daemon has its own bugs, and several were fixed in the
Go port on purpose. When the two disagree, decide which behaviour you want and say so in a comment
next to the Go code — "node did X because Y; this does Z because Y no longer holds". A silent
divergence is what the next reader cannot afford.

**It is not a reference for anything else.** Do not check it out into the working tree to import
from it, copy its tests into the Go suite, or point `package.json` at it.

## The parity guards

Four scripts compare the Node surface against the Go one, so a name a client can type cannot
disappear quietly:

| Guard                         | Compares                                                    |
| ----------------------------- | ----------------------------------------------------------- |
| `scripts/cli-surface.mjs`     | every CLI command and subcommand                            |
| `scripts/parity-surface.mjs`  | MCP tools, HTTP routes, `BYSPACE_*` environment inputs      |
| `scripts/go-emit-parity.mjs`  | every field a wire response declares, against what Go sends |
| `scripts/go-parity-audit.mjs` | every inbound wire field, against what Go parses            |

All four run in CI. They read the expected Node surface from `scripts/node-surface-snapshot.json`,
which is checked in — that is what lets the archive leave the working tree. Each script still
prefers a real `archive/packages/` checkout when one exists, so you can restore the tag locally to
regenerate the snapshot; with no checkout they use the snapshot and nothing needs the tag to run.

Adding a guard is worth it when a name crosses a boundary a user can see: a command, a tool, a
route, an environment variable, a wire field. Adding one for an internal function is not.

## Deleting the tag

The guards no longer need it, so only debugging does. Keep `v0.20.0` reachable while anyone still
asks "what did the old one do" — a tag costs nothing, and reconstructing the answer from scratch
costs an afternoon. If you do drop it, drop the `archive/packages/` branches in the four scripts at
the same time, so no reader is sent looking for a tree that cannot be restored.
