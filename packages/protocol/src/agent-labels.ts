export const PARENT_AGENT_ID_LABEL = "byspace.parent-agent-id";
export const AGENT_ROLE_LABEL = "byspace.agent-role";
export const AUTO_ARCHIVE_LABEL = "byspace.auto-archive";
export const SCHEDULE_LABEL_PREFIX = "byspace.schedule-";
export const ORCHESTRATION_LABEL_PREFIX = "byspace.orchestration.";
export const ORCHESTRATION_MISSION_ID_LABEL = "byspace.orchestration.mission-id";
export const ORCHESTRATION_THREAD_ID_LABEL = "byspace.orchestration.thread-id";
export const ORCHESTRATION_ROLE_LABEL = "byspace.orchestration.role";
export const ORCHESTRATION_CHATTER_SHIELD_LABEL = "byspace.orchestration.chatter-shield";

export const ORCHESTRATION_ROLES = ["author", "verifier", "integrator"] as const;
export type OrchestrationRole = (typeof ORCHESTRATION_ROLES)[number];

const OPEN_AGENT_TAB_LABEL_PREFIX = "byspace.open-agent-tab.";

export function getOpenAgentTabLabel(clientId: string): string {
  return `${OPEN_AGENT_TAB_LABEL_PREFIX}${clientId}`;
}

export function isOpenAgentTabLabel(label: string): boolean {
  return label.startsWith(OPEN_AGENT_TAB_LABEL_PREFIX);
}

export function isOrchestrationLabel(label: string): boolean {
  return label.startsWith(ORCHESTRATION_LABEL_PREFIX);
}

export function isReservedAgentLabel(label: string): boolean {
  return (
    label === AGENT_ROLE_LABEL ||
    label === AUTO_ARCHIVE_LABEL ||
    label.startsWith(SCHEDULE_LABEL_PREFIX) ||
    isOrchestrationLabel(label)
  );
}

export interface AgentLabelSource {
  labels?: Record<string, unknown> | null;
}

export interface AgentOrchestrationLabels {
  missionId: string | null;
  threadId: string | null;
  role: OrchestrationRole | null;
  chatterShield: boolean;
}

function readTrimmedStringLabel(
  labels: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = labels?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function getParentAgentIdFromLabels(labels: Record<string, unknown> | null | undefined) {
  return readTrimmedStringLabel(labels, PARENT_AGENT_ID_LABEL);
}

export function getOrchestrationInfoFromLabels(
  labels: Record<string, unknown> | null | undefined,
): AgentOrchestrationLabels {
  const rawRole = readTrimmedStringLabel(labels, ORCHESTRATION_ROLE_LABEL);
  const role = ORCHESTRATION_ROLES.includes(rawRole as OrchestrationRole)
    ? (rawRole as OrchestrationRole)
    : null;
  return {
    missionId: readTrimmedStringLabel(labels, ORCHESTRATION_MISSION_ID_LABEL),
    threadId: readTrimmedStringLabel(labels, ORCHESTRATION_THREAD_ID_LABEL),
    role,
    chatterShield: labels?.[ORCHESTRATION_CHATTER_SHIELD_LABEL] === "true",
  };
}

export function isChatterShieldedAgent(agent: AgentLabelSource): boolean {
  return agent.labels?.[ORCHESTRATION_CHATTER_SHIELD_LABEL] === "true";
}

export function isDelegatedAgent(agent: AgentLabelSource): boolean {
  return getParentAgentIdFromLabels(agent.labels) !== null;
}

export function hasOpenAgentTab(labels: Record<string, unknown> | null | undefined): boolean {
  return Object.entries(labels ?? {}).some(
    ([label, value]) => isOpenAgentTabLabel(label) && value === "true",
  );
}
