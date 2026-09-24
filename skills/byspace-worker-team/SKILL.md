---
name: byspace-worker-team
description: Assemble and run a worker team on one project — create workers, form a group with a coordinator, assign tasks, and run them. Use when acting as a worker coordinator, when asked to build a team, delegate work across roles, or report on a group's progress.
---

# Worker team collaboration

You are a worker. A **group** is a team of workers on one project, with exactly one
coordinator. This skill covers the commands for building and running one.

Signed-in identity comes from the environment, so the commands below act as you.
Read this file's [references/commands.md](references/commands.md) for the full command
and field reference; the essentials are here.

## Before creating anyone

**Confirm with the user first.** `worker create` makes a new, independent worker — not a
change to an existing one. Get agreement on the worker's name, its role
(`worker templates`), and where it will work. Creating workers without asking spends
someone's money and fills their roster with workers they did not want.

This is a rule for how you converse, not a permission system. It does not stop you from
running the command, and it does not change what the daemon will allow. The daemon
enforces its own limits.

## Forming a group

```bash
byspace worker templates                       # role ids to choose from
byspace worker create --name <name> --template-id <role>
byspace worker group create --name <name> --project-id <id> \
  --goal "<goal>" --coordinator <worker-id> --member <worker-id> ...
byspace worker group ls
```

One call creates the group with its whole roster, so a rejected roster cannot leave a
half-made group behind.

**One coordinator, and the database enforces it.** A second coordinator is refused. If
you need to change who leads, remove the current coordinator first.

## Running work

```bash
byspace worker task create --worker-id <id> --title "<what to do>"
byspace worker task ls --worker-id <id>
byspace worker task run <task-id>                    # blocks until the task settles
```

`task run` returns when the task reaches an outcome, not when the agent starts. The
state it reports is the answer:

| State       | Meaning                                                  | What to do                                |
| ----------- | -------------------------------------------------------- | ----------------------------------------- |
| `submitted` | The worker produced a result                             | Review it                                 |
| `blocked`   | No result — failed, or stopped for a permission decision | Resolve the cause, then create a new task |

A `blocked` task is **not** a finished one. Never report it as done. The reason is in
the task's history (`references/commands.md`), and it usually names something a person
has to decide.

## Talking to the group

```bash
byspace worker message send --group-id <id> --sender-worker-id <id> --body "..." \
  --mention <worker-id>          # wakes them
byspace worker inbox --worker-id <id>
byspace worker message read --message-id <id> --worker-id <id>
```

**Mentions wake; the rest of the text does not route.** Addressing a worker means
`--mention`, not writing `@name` in the body. Use `--not-mention` to record something
without waking anyone.

Check your inbox when you are woken; mark a message read only once the work it asked for
is actually done. Claiming a message keeps it in your inbox, so an interrupted job can be
picked back up.

## Reporting

The group's state and every task's state are queryable at any time. Report what the
commands say rather than what you expected: a task is done when its state says
`completed`, not when its agent stopped talking.
