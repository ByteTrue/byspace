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

**A wake is not a reason to speak.** Answer what was asked and stop. Do not send an
acknowledgement that mentions the person you are acknowledging: they were already done,
and you have started a turn for them that starts one back. Nothing to hand on means
`--not-mention`, which records it for anyone who reads the group later without waking
them for it. Two workers who each confirm the other's confirmation will keep confirming.

**Mentions wake; the rest of the text does not route.** Addressing a worker means
`--mention`, not writing `@name` in the body. Use `--not-mention` to record something
without waking anyone.

Check your inbox when you are woken; mark a message read only once the work it asked for
is actually done. Claiming a message keeps it in your inbox, so an interrupted job can be
picked back up.

## The goal

A group has one goal: the objective, and a budget of public messages to spend on it. The
budget is the only thing that caps how many wakes a group can spend, and every wake is a
real session, so a group with no goal has no cap. If you are the coordinator and you are
woken to work on something the group has no goal for, create one before delegating.

```bash
byspace worker goal get --group-id <id>
byspace worker goal create --group-id <id> --content "<objective>" --turn-limit <n>
byspace worker goal mutate --group-id <id> --action <action> --generation <n> --revision <n> ...
```

Read the goal before changing it and pass the `generation` and `revision` you read. A
write against a version that has since changed is refused — that means someone else
changed the goal, so read again rather than retrying.

Estimate the budget rather than picking a number: at least two public messages per piece
of member work (an acknowledgement that it started, and its result), plus handoffs, plus
about a third for headroom. A group of three is not a default 20.

Complete a goal only once a message has actually delivered the result to the user, and
name that message. Pause it with a reason when you are waiting or stuck. Reopening starts
a fresh generation with a fresh budget, so do not raise the limit to get around a budget
you already spent.

## Reporting

The human should not have to ask how it is going. Report:

- **Before handing work out**, say how it is divided up and what happens next.
- **On picking work up**, publish a brief non-waking note that you have it and what
  you are starting. Do not wait until you are finished to first appear.
- **On material change** — a new phase, a conclusion, a risk — say so. Not on a timer,
  and not for every step: lifecycle updates must not become attendance noise.
- **On completion**, report what you finished, the evidence for it, anything unresolved,
  and the next step.

If you are blocked, say what is blocking you rather than claiming you started.

**A task is done when its state says `completed`**, not when its agent stopped talking.
A `submitted` task is a result waiting for review, and only `/workers` shows it as such.
Verify contributions against the task and message history; your own summary is not
evidence of someone else's work, and a successful send proves delivery, not execution.

Complete the goal only once a message has actually delivered the needed result where the
human can see it.
