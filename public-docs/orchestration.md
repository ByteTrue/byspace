---
title: Orchestration
description: Coordinate agents across providers and machines, delegate work, and keep tasks moving with schedules and heartbeats.nav: Overview
order: 30
category: Orchestration
---

# Orchestration

BySpace lets your coding agents coordinate other agents, split work across providers and machines, and keep tasks moving automatically.

## What your agents can do

- **Choose providers and models:** launch other agents using any provider and model configured on the host.
- **Delegate and parallelize:** split research, implementation, and review between agents, including agents from different providers.
- **Communicate with each other:** agents can [send prompts to other agents by ID](/docs/orchestration-workflows#send-a-prompt-to-another-agent) to ask questions, share findings, or request work.
- **Coordinate ongoing work:** check progress, stop tasks, and collect results.
- **Create workspaces and worktrees:** give independent changes their own [working directories](/docs/worktrees).
- **Work across machines:** use the [CLI](/docs/cli#connecting-to-a-remote-daemon) to launch and manage agents on another reachable BySpace host.
- **Choose by specialty:** use [agent profiles](/docs/agent-profiles) and their notes to select settings for UI work, planning, or reviews.
- **Create schedules:** run a prompt in a new agent at [specified times](/docs/schedules).
- **Create heartbeats:** prompt the same agent periodically to [continue its task](/docs/orchestration-workflows#keep-an-agent-working-with-a-heartbeat).

## Get started

Every agent BySpace launches knows how to drive its host: BySpace installs the bundled **byspace**
skill where the agent reads its skills, and puts its own `byspace` binary on the agent's `PATH`.
There is nothing to turn on.

Ask the agent for the outcome:

> Use BySpace to launch a second agent to review this branch. Have it report potential bugs without changing files, then summarize its findings.

The worker appears in the **Subagents track** near the composer. Open it to follow the conversation.
Your main agent is notified when the worker finishes, errors, or needs permission, and you can keep
talking while it works.

An agent that does not read `~/.agents/skills` (most ACP clients) gets no BySpace tools. Copy the
skill into that client's own skill directory if you want it there.

See [Agent tools](/docs/agent-tools) for what the agent can do. [Orchestration skills](/docs/skills)
are optional reusable workflows built on top of it.

### From your own terminal

The same CLI works from your shell, which is handy for starting work without opening a chat:

```bash
byspace run --provider codex --background \
  "Review this branch without changing files"
byspace ls -a
```

The first command starts an agent and returns immediately; the second lists agents from active
workspaces, including archived ones. Started from your shell, the agent gets a new local workspace;
started by an agent, it becomes that agent's subagent.

See the [CLI reference](/docs/cli) for follow-ups, output, worktrees, and remote hosts.

## Pick settings once with profiles

Save a provider, model, thinking level, mode, and available feature settings as an **agent profile**, then select it in one click when creating an agent.

Add **When to use** notes so an orchestrating agent can choose a profile for the task: UI work, planning, or independent review. [Create profiles and write delegation notes](/docs/agent-profiles).

## Go further

- [Delegate implementation and get an independent review](/docs/orchestration-workflows#implement-then-review).
- [Run parallel changes in separate worktrees](/docs/orchestration-workflows#parallelize-edits-without-collisions).
- [Coordinate work on another machine](/docs/orchestration-workflows#work-on-another-machine).
- [Create recurring jobs](/docs/schedules) or [continue a task with a heartbeat](/docs/orchestration-workflows#keep-an-agent-working-with-a-heartbeat).
- [Install reusable orchestration skills](/docs/skills).
