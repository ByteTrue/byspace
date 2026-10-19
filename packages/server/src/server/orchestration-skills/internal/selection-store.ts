import {
  AGENT_SKILL_TARGET_IDS,
  type AgentSkillSelection,
  type AgentSkillTargetId,
  AgentSkillTargetIdSchema,
} from "@bytetrue/protocol/messages";

import type { DaemonConfigStore } from "../../daemon-config-store.js";

export type SkillSelection = AgentSkillSelection;

export interface SkillSelectionStore {
  get(): Promise<SkillSelection>;
  getTargets(): Promise<AgentSkillTargetId[]>;
  set(selection: unknown, targets?: unknown): Promise<SkillSelection>;
  isSet(): Promise<boolean>;
}

const DEFAULT_SKILL_SELECTION: SkillSelection = { mode: "all" };
/** A host that never chose targets writes every home, which is what every older daemon did. */
const DEFAULT_SKILL_TARGETS: AgentSkillTargetId[] = [...AGENT_SKILL_TARGET_IDS];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function coerceSkillNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return [...new Set(names)].sort();
}

export function coerceSkillSelection(value: unknown): SkillSelection {
  if (!isRecord(value)) return DEFAULT_SKILL_SELECTION;
  if (value.mode === "all") return { mode: "all" };
  if (value.mode === "custom") {
    return { mode: "custom", skills: coerceSkillNames(value.skills) };
  }
  return DEFAULT_SKILL_SELECTION;
}

/**
 * Target order is the protocol order, not the request's, so two selections that
 * name the same homes compare equal. An unrecognized entry is dropped rather
 * than failing the whole save: the app cannot invent a home the daemon lacks.
 */
export function coerceSkillTargets(value: unknown): AgentSkillTargetId[] {
  if (!Array.isArray(value)) return [...DEFAULT_SKILL_TARGETS];
  const requested = new Set(
    value.filter(
      (entry): entry is AgentSkillTargetId => AgentSkillTargetIdSchema.safeParse(entry).success,
    ),
  );
  return AGENT_SKILL_TARGET_IDS.filter((id) => requested.has(id));
}

export function createSkillSelectionStore(
  configStore: Pick<DaemonConfigStore, "get" | "setAgentSkillSelection" | "setAgentSkillTargets">,
): SkillSelectionStore {
  return {
    async get() {
      return coerceSkillSelection(configStore.get().skills?.selection);
    },
    async getTargets() {
      return coerceSkillTargets(configStore.get().skills?.targets);
    },
    async set(selection, targets) {
      const parsed = coerceSkillSelection(selection);
      configStore.setAgentSkillSelection(parsed);
      if (targets !== undefined) configStore.setAgentSkillTargets(coerceSkillTargets(targets));
      return parsed;
    },
    async isSet() {
      return configStore.get().skills?.selection !== undefined;
    },
  };
}
