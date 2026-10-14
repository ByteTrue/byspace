/**
 * Built-in agent roles. A role is a named, daemon-embedded identity that
 * contributes a system prompt to the agents carrying it. The registry is
 * intentionally closed: roles ship with the daemon binary so updating the
 * daemon updates every workspace's role behavior (Multica's embedded-prompt
 * pattern). Custom user roles are a future extension point, not this epic.
 *
 * Issue: byissue/epics/005-o-chief-floating-assistant/issues/001
 */

export const AGENT_ROLE_LABEL = "byspace.agent-role";

/**
 * Daemon-owned label keys a client may not set: built-in identity stamps, not
 * the whole byspace.* namespace (relationship labels like parent-agent-id flow
 * through internal paths that also strip client input). Client-supplied
 * copies are stripped before they reach agent records so a client cannot forge
 * a built-in identity (e.g. stamp itself as Chief).
 */
export const RESERVED_LABEL_KEYS: ReadonlySet<string> = new Set([AGENT_ROLE_LABEL]);

/** Drop daemon-reserved label keys from a client-supplied label map. */
export function stripReservedLabels(
  labels: Record<string, string> | undefined,
): Record<string, string> {
  if (!labels) return {};
  const stripped: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (RESERVED_LABEL_KEYS.has(key)) continue;
    stripped[key] = value;
  }
  return stripped;
}

export interface AgentRoleDefinition {
  /** Stable identifier carried on agent labels and the wire. */
  name: string;
  /** Human-facing description for pickers and future settings UI. */
  description: string;
  /** System prompt appended to agents carrying this role. */
  systemPrompt: string;
}

const CHIEF_SYSTEM_PROMPT = [
  "You are Chief, the built-in assistant of BySpace — the user's single conversation entry point for everything running on this daemon.",
  "",
  "## Working model",
  "- The user brings you a goal, not a routing decision. Never answer by naming the feature or workspace they should go find — do it yourself with the tools below, then tell them what you did.",
  "- Answer in chat when one turn is enough. Start or steer a workspace agent when the work needs a repository, tools, or more than one turn.",
  "- Use the byspace CLI (agents, workspaces, projects, schedules, heartbeats) and the injected BySpace tools to observe and act on this daemon.",
  "- Your working directory is the BySpace home directory. Treat it as read-mostly; ask before modifying anything here.",
  "",
  "## Collaboration",
  "- Ask only when the answer materially changes the outcome.",
  "- A clear request is authorization for ordinary operations.",
  "- Preview and confirm before destructive actions, publishing, or anything that spends money.",
  "- You CAN promise follow-ups: schedules and heartbeats can wake you later. When the user wants you to check on something, set one up.",
  "",
].join("\n");

const BUILT_IN_ROLES: readonly AgentRoleDefinition[] = [
  {
    name: "chief",
    description:
      "BySpace's built-in assistant. A single conversation entry point that observes and drives the workspaces on this daemon.",
    systemPrompt: CHIEF_SYSTEM_PROMPT,
  },
];

const ROLE_BY_NAME = new Map(BUILT_IN_ROLES.map((role) => [role.name, role]));

/**
 * Built-in role names in display order, for the catalog the daemon advertises
 * on server_info. Clients render their own labels; the wire carries names.
 */
export function listAgentRoleNames(): string[] {
  return BUILT_IN_ROLES.map((role) => role.name);
}

/** Resolve a built-in role by wire name. Unknown names resolve to null so a
 * stale client or a removed role degrades to a plain agent instead of
 * failing creation. */
export function getAgentRole(name: string | null | undefined): AgentRoleDefinition | null {
  if (!name) {
    return null;
  }
  return ROLE_BY_NAME.get(name.trim().toLowerCase()) ?? null;
}

/** Role prompt to append for an agent carrying the given role name, or null. */
export function getAgentRoleSystemPrompt(name: string | null | undefined): string | null {
  return getAgentRole(name)?.systemPrompt ?? null;
}
