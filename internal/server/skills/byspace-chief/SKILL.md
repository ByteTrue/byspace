---
name: byspace-chief
description: Extended reference for Chief mission orchestration, adaptive L0/L1/L2 tiering, role routing, and `byspace chief` CLI workflows. Use when coordinating multi-step coding work with independent verification or parallel worktree threads.
---

# BySpace Chief

Chief runs as the single user conversation entry point in `$BYSPACE_HOME/chief`. The daemon's built-in prompts already carry the command contracts; this file gives the full mission lifecycle and configuration model.

## Execution tiers

Pick the lightest tier that isolates risk:

| Tier | Shape                                                    | When to use                                                         |
| ---- | -------------------------------------------------------- | ------------------------------------------------------------------- |
| `L0` | Direct reply or single solo agent                        | One-turn answers or trivial single-workspace edits                  |
| `L1` | One `none`-isolation thread + shadow read-only Verifier  | Non-trivial single-workspace changes that need independent checking |
| `L2` | Multiple `worktree` threads + non-coding Chief secretary | Two or more disjoint tasks running in parallel                      |

Upgrade mid-flight with `byspace chief mission upgrade` when scope grows:

- `L0 -> L1` binds the solo agent as Thread 1 in place without restarting it.
- `L0/L1 -> L2` opens worktree threads; pass `--dirty-policy carry_into_thread_1` to carry uncommitted changes into Thread 1, or `--dirty-policy fail_if_dirty` to require a clean checkout first.

## Role separation and peer handoffs

- **Chief (`L2`)**: stays in `$BYSPACE_HOME/chief`, keeps turns short, decomposes work into disjoint `--own` paths, and surfaces blocking choices via `pendingDecision`. Chief never edits repository files or resolves merge conflicts.
- **Author**: edits only inside `ownedPaths` (and granted `sharedLocks`), verifies its own work, and hands off directly to the Verifier with `byspace chief thread submit`.
- **Verifier**: runs read-only (`plan` / Codex `read-only` sandbox) and never modifies the checkout. Any git working-tree or `HEAD` mutation taints the verdict and escalates to Chief. Verifier answers with `byspace chief thread verdict --pass|--reject`: reject #1 goes back to Author directly; reject #2 escalates to Chief.
- **Integrator**: resolves conflicts inside a dedicated worktree when a branch needs rebasing beyond a single Author rebase, then submits for a fresh Verifier pass.

Do not poll running threads. After a submission or verdict, end your turn; the daemon delivers unread mission events inside `<byspace-system>` wake bells when an agent becomes idle.

## `byspace chief` CLI reference

`BYSPACE_AGENT_ID` populates `callerAgentId` automatically (override with `--caller <id>`). Pass `--json` on any command for machine-readable output.

```bash
# Missions
byspace chief mission list [--chief <id>] [--project <id>] [--workspace <id>] [--status active|waiting_human|completed|failed|canceled] [--include-completed] [--json]
byspace chief mission get <missionId> [--events] [--events-limit <1..500>] [--after-seq <n>] [--json]
byspace chief mission create --goal "<goal>" [--title "<title>"] [--tier L0|L1|L2] [--chief <id>] [--project <id>] [--workspace <id>] [--cwd <dir>] [--base-branch <branch>] [--json]
byspace chief mission upgrade [--mission <id>|--solo-agent <id>] --tier L0|L1|L2 [--dirty-policy fail_if_dirty|carry_into_thread_1] [--title "<title>"] [--goal "<goal>"] [--acceptance "<item>" ...] [--own "<path>" ...] [--author-profile <id>] [--verifier-profile <id>] [--json]
byspace chief mission resolve-decision --mission <id> --option <optionId> [--decision <id>] [--note "<text>"] [--json]

# Threads
byspace chief thread create --mission <id> --title "<title>" --goal "<goal>" [--acceptance "<item>" ...] [--own "<path>" ...] [--isolation none|worktree] [--base <ref>] [--branch <name>] [--author-profile <id>] [--verifier-profile <id>] [--author-agent <id>] [--prompt "<text>"] [--json]
byspace chief thread submit --thread <threadId> [--mission <missionId>] --summary "<summary>" [--tests "<checks>"] [--file <path> ...] [--commit <sha>] [--json]
byspace chief thread verdict --thread <threadId> [--mission <missionId>] --pass|--reject --summary "<summary>" [--issue "<finding>" ...] [--checked "<cmd>" ...] [--json]
byspace chief thread merge-check --thread <threadId> [--mission <missionId>] [--json]
byspace chief thread land --thread <threadId> --strategy <merge|squash|rebase> --commit-message "<text>" [--mission <missionId>] [--json]
byspace chief thread cancel --thread <threadId> [--mission <missionId>] --reason "<text>" [--json]

# Agents
byspace chief agent hotswap --agent <agentId> --thread <threadId> --profile <profileId> --reason "<text>" [--mission <missionId>] [--json]
```

Always run `merge-check` before `land`. A land response with `approvalRequired=true` is not landed and not an error: stop and wait for human landing approval. Only the daemon's trusted decision flow may authorize the Git mutation. Local `merge`, `squash`, and `rebase` are supported; `open_pr` is explicitly unsupported.

Cancellation stops active workers and marks the thread canceled without deleting its worktree or uncommitted work. Hot-swap preserves the agent identity when possible; when it returns a different `replacementAgentId` from `previousAgentId`, use the replacement for subsequent worker commands.

## Profile routing and safety invariants

Configure `agentProfiles[].tier` (`"fast" | "standard" | "strong"`, defaulting to `"standard"`) and `chief` routing in daemon config:

- `chief.roles.{chief,author,verifier,integrator}` each take `{ primaryProfileId, fallbackProfileIds }`.
- **Verifier >= Author tier**: the daemon rejects config saves and runtime fallbacks that place a lower-tier Verifier behind a higher-tier Author.
- **Defaults**: stall detection warns at `600s` and triggers recovery at `1200s` (`chief.stall.{softWarningSec,hardRecoverySec}`); landing defaults to `requireHumanApproval: true`, `mode: "merge_local"`, `strategy: "squash"` (`chief.landing`).
- **Daemon-owned state**: `$BYSPACE_HOME/orchestration/` and `byspace.orchestration.*` labels are managed exclusively by the daemon. Never edit mission files or forge orchestration labels manually.
