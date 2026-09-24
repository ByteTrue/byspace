# Worker team command reference

Every command accepts `--json` for machine-readable output and `--host <host>` to target a
specific daemon. Identity comes from the environment, so no command takes a "who am I".

## Workers

```bash
byspace worker templates
byspace worker ls
byspace worker create --name <name> --template-id <role> [--workspace-path <path>]
```

- `worker templates` lists the roles and the skills each ships with. A worker's role is
  **fixed at creation**, so check before creating rather than after.
- `--workspace-path` defaults to a directory under BySpace home, one per worker. Pass a
  project directory when the worker should work somewhere specific.
- The response carries `workerId`, which everything else refers to.

## Groups

```bash
byspace worker group create --name <name> --project-id <id> \
  [--goal "<goal>"] [--coordinator <worker-id>] [--member <worker-id> ...]
byspace worker group ls
byspace worker group add-worker <group-id> --worker <worker-id> [--role member|coordinator]
byspace worker group remove-worker <group-id> <worker-id>
```

- `--member` is repeatable. `--coordinator` names the leader.
- A group binds a **project id**, not a path, so a moved checkout does not orphan it.
- **Exactly one coordinator.** The rule is a partial unique index, so it holds under
  concurrency, not just in the code path that checks it. `--role coordinator` on a group
  that already has one is refused; remove the current coordinator first.
- Removing the coordinator leaves the group without one. Add a replacement.

## Tasks

```bash
byspace worker task create --worker-id <id> --title "<what to do>"
byspace worker task ls [--worker-id <id>]
byspace worker task run <task-id>
```

`task run` blocks until the task settles and returns its final state. It creates an agent
session in the worker's workspace, so it needs write access there.

## Task states

`planned → prepared → assigned → in_progress → submitted → completed | revision | blocked | cancelled`

The last four are terminal. A task cannot be reopened; follow-up work is a new task.
Illegal moves are refused with a message naming the states actually reachable, so read
the error rather than guessing.

- `submitted` — a result exists and is waiting to be accepted.
- `completed` — the result was accepted. Only this means done.
- `revision` — the result was rejected; the follow-up is a new task.
- `blocked` — no result: the run failed, or it stopped for a permission decision.
  Reachable directly from `assigned` and `in_progress`, because a run that never
  produced anything must not have to record a submission first.

## Task history

Each task keeps an append-only history of `fromState`, `toState`, `action`, `actor`,
`note`, and `recordedAt`. Read it to find out _why_ a task is where it is — a `blocked`
task's last note carries the failure reason, and a `submitted` one carries the agent id
that produced it. Every state change is attributed to the actor that caused it.
