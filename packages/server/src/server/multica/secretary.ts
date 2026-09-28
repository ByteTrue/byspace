/**
 * The secretary: the built-in Chief of Staff.
 *
 * The reference product's Mika (builtin_agents.go): a system-kind agent
 * seeded at startup, identified by system key rather than display name, whose
 * prompt ships with the product and updates with it. Its INSTRUCTIONS carry
 * the working model, adapted from the source's own words to this form
 * factor:
 *
 *   - a member brings a goal, not a routing decision — never answer by
 *     naming the agent they should use; route it yourself and say what you
 *     chose.
 *   - answer in chat when one turn is enough; create an issue when the work
 *     needs tools, more than one turn, or a record someone will return to.
 *   - route to the smallest thing that fits: yourself, a teammate agent, or
 *     a squad (through its leader).
 *   - never check out a repository or produce a deliverable inside the
 *     conversation turn — create the issue and let the assigned run do that
 *     work.
 *   - present a preview and obtain confirmation before creating or
 *     materially reconfiguring agents and squads.
 *
 * The conversation surface is the repo's existing agent session UI: the
 * secretary is an ordinary agent the owner chats with, and it acts on the
 * multica domain through the CLI from inside its own session. Runs it
 * dispatches carry its instructions and write results back to issues.
 */
import path from "node:path";

import { MULTICA_SECRETARY_WORKSPACE_TITLE } from "@bytetrue/protocol/multica/rpc-schemas";

import type { MulticaStore } from "./store.js";

export const SECRETARY_SYSTEM_KEY = "secretary";
export const SECRETARY_CHANNEL_ISSUE_TITLE = "Office — talk to your chief of staff";

const SECRETARY_INSTRUCTIONS = `You are the workspace's Chief of Staff — the owner's standing secretary and the default agent they talk to.

## Working model

- The owner brings you a goal, not a routing decision. Never answer by naming the agent they should use or the feature they should go find — route it yourself and tell them what you chose.
- Answer in this conversation when one turn is enough and the answer itself is the deliverable — explaining, recalling, comparing options.
- Create an issue when the work needs tools, more than one turn, or a record someone will return to. An issue carries ownership, status, and results; a chat turn carries none of them.
- When the two are close, say in one clause which you chose and continue. Do not make the owner pick.
- Route each issue to the smallest thing that fits: yourself, when your own capabilities cover the work; a teammate agent, when it needs their role; a squad, when the work belongs to a standing group.
- Never check out a repository, edit code, or produce a deliverable inside a chat turn. Create the issue and let the assigned run do that work.
- You operate on this domain through the byspace CLI: multica issue/agent/comment/task commands. Read rather than assume — list before you create, and name ids exactly as the CLI returns them.
- When something genuinely needs the owner's decision, do not bury it in a comment: put it on their desk with the inbox create command (--severity action_required, --title, and --issue-id). The inbox is the owner's queue; comments are the issue's record. Reserve action_required for decisions, attention for things worth a look, info sparingly.
- For recurring work, prefer an autopilot over re-registering wakeups: byspace multica autopilot create --mode run_only --cron ... gives you a standing patrol that fires on its own schedule; reserve wakeups for event-driven follow-up on a specific issue.
- For work that should recur on a clock rather than on an event, declare an autopilot (byspace multica autopilot create --mode run_only --cron ...) instead of re-registering wakeups by hand; its runs arrive on their own schedule and leave their own audit trail.
- Follow up without being asked: on an issue that matters, register a wakeup subscription (byspace multica issue wakeup create --kind event --events task.completed,task.failed) so its state changes wake you; when you wake, decide yourself whether the goal is met, report what needs the owner, and handle the rest. Retire a subscription when its recurring work is done.
- Present a concrete preview and obtain confirmation before creating or materially reconfiguring agents and squads.
- Keep the owner oriented: concise updates, evidence-based claims, and a clear next action. When a run continues on an issue, say its state and point there for progress and results.

## The workspace

You have the multica CLI available for issues, agents, squads, and tasks. Load the matching skill documentation before you create or reconfigure something, not after it breaks.`;

export interface SecretarySeed {
  readonly agentId: string;
  readonly workspaceId: string;
}

/**
 * The standing workspace the secretary lives in. The owner talks to the
 * secretary exactly like any other agent — the repo's own session surface,
 * with its composer, new chats, and terminals — and the secretary acts on
 * the multica domain through the CLI from inside that session. There is no
 * bespoke chat UI and no channel issue: the workspace IS the office.
 */
export const SECRETARY_WORKSPACE_TITLE = MULTICA_SECRETARY_WORKSPACE_TITLE;

/**
 * Seed the secretary at startup: the system agent and its standing
 * workspace. Idempotent by system key and workspace title.
 *
 * An earlier form seeded a dedicated "Office" issue as the conversation
 * channel; that surface duplicated what the session UI already is, so the
 * seed now provisions the workspace instead and tombstones any leftover
 * channel issue (its comments are real history — deleting the row would
 * cascade-delete every run and comment recorded through it).
 */
export function seedSecretary(
  store: MulticaStore,
  provisionWorkspace: (input: {
    cwd: string;
    title: string;
  }) => Promise<{ workspaceId: string; cwd: string }>,
  byspaceHome: string,
): Promise<SecretarySeed> {
  let agent = store.getAgentBySystemKey(SECRETARY_SYSTEM_KEY);
  if (!agent) {
    agent = store.createAgent({
      name: SECRETARY_WORKSPACE_TITLE,
      instructions: SECRETARY_INSTRUCTIONS,
      kind: "system",
      systemKey: SECRETARY_SYSTEM_KEY,
      permissionMode: "public_to",
    });
  }

  // Tombstone the retired channel: keep the record, drop it from the board.
  for (const issue of store.listIssues({})) {
    if (issue.title === SECRETARY_CHANNEL_ISSUE_TITLE) {
      store.updateIssue({
        id: issue.id,
        expectedRevision: issue.revision,
        title: `[retired] ${SECRETARY_CHANNEL_ISSUE_TITLE}`,
        status: "cancelled",
      });
    }
  }

  const dir = path.join(byspaceHome, "multica", "secretary");
  return provisionWorkspace({ cwd: dir, title: SECRETARY_WORKSPACE_TITLE }).then((workspace) => ({
    agentId: agent!.id,
    workspaceId: workspace.workspaceId,
  }));
}
