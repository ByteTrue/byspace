# Reading the archived Node daemon

The Go daemon in `internal/` is a port of the Node daemon that shipped before it. That daemon's
source is kept, read-only and never built, under `archive/packages/` — `server/` for the daemon,
`cli/` for the command line. Nothing in the build or the test suite loads it.

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
came from `archive/packages/server/src/server/session.ts` (grep for the RPC name, not the filename —
that file is one of the big ones), `internal/workspace/git.go` from
`archive/packages/server/src/utils/checkout-git.ts`, `internal/cli/main.go` from
`archive/packages/cli/src/cli.ts`.

Comments in the Go source cite the archived file and line when the behaviour is non-obvious
(`node daemon: checkout-git.ts:2727`). Grep the archived tree for the quoted constant or message
string; that lands faster than reading either file top to bottom.

```bash
rg -n "Cannot rewind before the provider" archive/packages/
rg -n "PORT_SCRIPT_TIMEOUT_MS" archive/packages/server/src
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

**It is not a reference for anything else.** `archive/` is not a workspaces member, not typechecked,
not linted, not formatted, not run by CI. Do not import from it, do not copy its tests into the Go
suite, do not point `package.json` at it.

## The parity guards

Three scripts compare the archived surface against the Go one, so a name a client can type cannot
disappear quietly:

| Guard                         | Compares                                                    |
| ----------------------------- | ----------------------------------------------------------- |
| `scripts/cli-surface.mjs`     | every CLI command and subcommand                            |
| `scripts/parity-surface.mjs`  | MCP tools, HTTP routes, `BYSPACE_*` environment inputs      |
| `scripts/go-emit-parity.mjs`  | every field a wire response declares, against what Go sends |
| `scripts/go-parity-audit.mjs` | every inbound wire field, against what Go parses            |

All four run in CI. They read the archived source, which is why the archive cannot be deleted while
they exist — removing it means regenerating the expected surfaces into checked-in snapshots first.

Adding a guard is worth it when a name crosses a boundary a user can see: a command, a tool, a
route, an environment variable, a wire field. Adding one for an internal function is not.

## Deleting the archive

Two things hold it in place: the parity guards read it, and people read it while debugging. The
second is the reason it is still here after the port finished.

When the guards are migrated to snapshots and the daemon has run in production long enough that
nobody asks "what did the old one do", delete `archive/` in one commit and say so in the changelog.
Until then, leave it alone — an unbuilt tree that answers questions is cheaper than an investigation
that reconstructs the answer from scratch.
