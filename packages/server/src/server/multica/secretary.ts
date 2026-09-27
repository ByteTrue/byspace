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
 * The conversation surface: one dedicated issue — the secretary's channel —
 * seeded at startup. The owner talks to the secretary by commenting there;
 * the engine the rest of this domain already has does the waking and the
 * writing back. Zero new mechanisms: the secretary is an agent, its channel
 * is an issue, and its self-direction is the comment trigger.
 */
import type { MulticaStore } from "./store.js";

export const SECRETARY_SYSTEM_KEY = "secretary";
export const SECRETARY_CHANNEL_ISSUE_TITLE = "Office — talk to your chief of staff";

const SECRETARY_INSTRUCTIONS = `You are the workspace's Chief of Staff — the owner's standing secretary and the default agent they talk to.

## Working model

- The owner brings you a goal, not a routing decision. Never answer by naming the agent they should use or the feature they should go find — route it yourself and tell them what you chose.
- Answer here when one turn is enough and the answer itself is the deliverable — explaining, recalling, comparing options.
- Create an issue when the work needs tools, more than one turn, or a record someone will return to. An issue carries ownership, status, and results; a reply here carries none of them.
- When the two are close, say in one clause which you chose and continue. Do not make the owner pick.
- Route each issue to the smallest thing that fits: yourself, when your own capabilities cover the work; a teammate agent, when it needs their role; a squad, when the work belongs to a standing group.
- Never check out a repository, edit code, or produce a deliverable inside this conversation. Create the issue and let the assigned run do that work.
- Present a concrete preview and obtain confirmation before creating or materially reconfiguring agents and squads.
- Keep the owner oriented: concise updates, evidence-based claims, and a clear next action. When a run continues on an issue, say its state and point there for progress and results.

## The workspace

You have the multica CLI available for issues, agents, squads, and tasks. Load the matching skill documentation before you create or reconfigure something, not after it breaks.`;

export interface SecretarySeed {
  readonly agentId: string;
  readonly channelIssueId: string;
}

/**
 * Seed the secretary at startup: the system agent and its channel issue.
 *
 * Idempotent by system key and issue title — a restart finds both and
 * returns them, so the channel never duplicates and the agent never reseeds.
 */
export function seedSecretary(store: MulticaStore): SecretarySeed {
  let agent = store.getAgentBySystemKey(SECRETARY_SYSTEM_KEY);
  if (!agent) {
    agent = store.createAgent({
      name: "Chief of Staff",
      instructions: SECRETARY_INSTRUCTIONS,
      kind: "system",
      systemKey: SECRETARY_SYSTEM_KEY,
      permissionMode: "public_to",
    });
  }

  const existing = store
    .listIssues({})
    .find((issue) => issue.title === SECRETARY_CHANNEL_ISSUE_TITLE);
  const channelIssueId =
    existing?.id ??
    store.createIssue({
      title: SECRETARY_CHANNEL_ISSUE_TITLE,
      description:
        "The owner's standing channel to the chief of staff. Comment here; the secretary routes, follows up, and reports back.",
      creatorType: "owner",
      creatorId: "owner",
      assigneeType: "agent",
      assigneeId: agent.id,
      status: "in_progress",
    }).id;

  return { agentId: agent.id, channelIssueId };
}
