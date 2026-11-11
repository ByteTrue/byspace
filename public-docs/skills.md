---
title: Orchestration skills
description: Reusable workflows for handing off tasks, getting a second opinion, and planning with multiple agents.nav: Skills
order: 33
category: Orchestration
---

# Orchestration skills

Skills give your agents reusable instructions for delegation, handoffs, and reviews. You can also [ask for these workflows directly](/docs/orchestration-workflows) without installing skills.
| Skill | Use it to |
| ------------------ | -------------------------------------------------------------------- |
| `/byspace` | How to manage agents, workspaces, schedules, and heartbeats. |
| `/byspace-handoff` | Transfer a task and its context to another agent. |
| `/byspace-committee` | Get two independent analyses of a difficult problem. |
| `/byspace-advisor` | Get a second opinion on your current work. |

## Installation

- **In BySpace:** Open **Settings → your host → Agents → Orchestration skills** and choose which skills to install on that host. Nothing is installed until you choose; `/byspace` is the recommended first choice — it is how an agent learns the CLI exists — and the workflow skills below are optional.
- **From the terminal:** Run `npx skills add ByteTrue/byspace` on the machine where your agents run.

Use the same settings card to change the selection, update, or uninstall skills. Uninstalling records that choice, so a later start does not put the skills back. The picker also lists the install locations: `~/.agents/skills` (read by Codex, Pi, and other agents that use the shared skills folder) and `~/.claude/skills` (read by Claude Code). Turning a location off deletes the BySpace copies from it on the next save, so you can install only where your agents look. The host also refreshes selected installed BySpace skills on startup.

## `/byspace`, BySpace Reference

The foundational reference used by the other skills, and what gives an agent its BySpace tools at all: it covers the `byspace` commands, delegation and parentage, schedules versus heartbeats, and the commands an agent must never run against its own host. See [Agent tools](/docs/agent-tools).

> /byspace show me how to create an agent in a workspace with worktree isolation

## `/byspace-handoff`, Task Handoff

Transfer the current task with a briefing: relevant files, progress, decisions, constraints, and acceptance criteria. The skill checks profiles before choosing the receiving agent; you can name the profile you want.

> /byspace-handoff hand off the auth fix to an implementation agent in its own worktree

The receiving agent gets the context it needs to continue. Ask for a separate worktree when it should edit independently.

## `/byspace-committee`, Committee Planning

Get two agents to analyze a difficult problem independently. The skill checks profile notes for planning and analysis, preferring different provider families when possible.

> /byspace-committee why are the websocket connections dropping under load?

Committee members return analyses without editing files. The main agent synthesizes their plans, implements the solution, and sends the diff back for review.

## `/byspace-advisor`, Advisor

Get another agent's judgment on a design, diff, or question. The skill chooses a profile whose notes fit the work, or uses the profile you name.

> /byspace-advisor did I miss anything in this migration plan?

The advisor returns a second opinion without editing files.
