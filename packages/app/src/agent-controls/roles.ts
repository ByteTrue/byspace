/**
 * Built-in agent roles a daemon offers.
 *
 * The daemon owns the registry (packages/server/src/server/agent/agent-roles.ts)
 * and advertises the names on `server_info`; the app ships labels for the roles
 * it knows and humanizes the rest. A new built-in role therefore reaches the
 * composer's role picker without an app release.
 */

/**
 * The form value for "no role". The daemon reads an absent role as a plain
 * agent, so the picker's sentinel and the wire value are the same empty string —
 * no mapping layer between them.
 */
export const NO_AGENT_ROLE_ID = "";

/**
 * Labels for the roles this app ships copy for. A role missing here renders its
 * name sentence-cased: untranslated, but never a raw i18n key.
 */
export const AGENT_ROLE_LABEL_KEYS: Readonly<Record<string, string>> = {
  chief: "agentControls.role.chief",
};

interface HostRoleFeatures {
  agentRoleNames?: string[];
  agentRoles?: boolean;
}

/**
 * COMPAT(agentRoles): added in v0.20.0, remove after 2027-04-14.
 * A v0.20.0 daemon advertised only the boolean, and `chief` was its whole
 * registry. New daemons send the catalog and keep the boolean for apps released
 * before it existed.
 */
const LEGACY_AGENT_ROLE_NAMES: readonly string[] = ["chief"];

/**
 * The host's built-in roles, or null when the host has none to offer.
 *
 * Null is the capability gate: every caller reads it as "this host has no role
 * feature", which is what hides the Chief entry point and the role picker.
 */
export function resolveAgentRoleNames(
  features: HostRoleFeatures | undefined,
): readonly string[] | null {
  if (!features) return null;
  if (features.agentRoleNames) return features.agentRoleNames;
  if (features.agentRoles === true) return LEGACY_AGENT_ROLE_NAMES;
  return null;
}
