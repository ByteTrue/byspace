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

## Messages

```bash
byspace worker message send --group-id <id> --sender-worker-id <id> --body "<text>" \
  (--mention <worker-id> ... | --not-mention) \
  [--private-to <worker-id> ...] [--intent chat|ask|notify|request_action] [--reply-to <message-id>]
byspace worker message ls --group-id <id> [--viewer-worker-id <id>] [--limit <n>]
byspace worker inbox --worker-id <id>
byspace worker message read --message-id <id> --worker-id <id>
```

**Mentions wake; the text does not route.** `--mention` addresses the named workers
and makes the message waking. Routing reads the audience, never the body, so an `@name`
in the text is presentation only. `--mention` and `--not-mention` are exclusive, because
they are two different sends rather than two flags on one.

**Visibility and waking are separate questions.** `--not-mention` stores a message that
everyone can read and that wakes nobody. `--private-to` narrows who may read it without
changing whether anyone is woken. A message with no `--private-to` is public to the group.

**One delivery per addressed worker.** A waking message creates a delivery row for each
addressee, so "has this been picked up" is a fact about a pair. Two workers addressed by
one message read it independently; one reading it does not mark it read for the other.

`inbox` lists only messages that woke the worker and are not finished — `unread` or
`claimed`. Claiming keeps a message in the inbox so work interrupted mid-way can be
resumed. `message read` returns `not-addressed` when the worker had no delivery for the
message, which means it was not for them; that is an answer, not an error.

Read a group's stream with your own `--viewer-worker-id` unless you mean to inspect the
whole group. Without it you get the operator view, including messages you are not a
reader of.

## Goals

A group has one goal: what it is delivering, and how many public messages it may
spend doing it.

```bash
byspace worker goal get --group-id <id>
byspace worker goal create --group-id <id> --content "<objective>" --turn-limit <n>
byspace worker goal mutate --group-id <id> --action update|complete|pause|reopen \
  --generation <n> --revision <n> [--content <text>] [--turn-limit <n>] \
  [--reason <reason>] [--result-message <message-id>]
```

**Read before you write, and echo the version back.** Every mutation except `create`
requires `--generation` and `--revision` exactly as `goal get` returned them. A write
against a version that has since changed is refused, because another run changed the goal
first. When that happens, read again and reconsider — do not retry with the same numbers.

**Budget counts public messages only.** `turnUsed/turnLimit` bounds what the group says in
public, not what it takes to get there, so private messages are free. The limit is 1..96.

**Completing names what delivered the result.** `--action complete` requires
`--result-message` pointing at the message that carried the result to the user. Completion
is a claim about delivery, so it has to say what was delivered.

**Reopening starts a new generation.** It carries the objective forward (or replaces it),
clears the previous result, and resets the budget — a new attempt gets its own budget
rather than inheriting the previous attempt's spend. Do not raise `--turn-limit` only to
get around an exhausted budget; `pause --reason turn_limit` says so honestly.

Pause reasons are `user_stop`, `awaiting_user`, `turn_limit`, `no_progress`,
`execution_error`, and `leader_unavailable`. Anything else is rejected.
