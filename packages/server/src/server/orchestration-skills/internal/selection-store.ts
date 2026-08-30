import type { AgentSkillSelection } from "@getpaseo/protocol/messages";

import type { DaemonConfigStore } from "../../daemon-config-store.js";

export type SkillSelection = AgentSkillSelection;

export interface SkillSelectionStore {
  get(): Promise<SkillSelection>;
  set(selection: unknown): Promise<SkillSelection>;
  isSet(): Promise<boolean>;
}

const DEFAULT_SKILL_SELECTION: SkillSelection = { mode: "all" };

const LEGACY_SKILL_NAME_ALIASES: Readonly<Record<string, string>> = {
  paseo: "byspace",
  "paseo-advisor": "byspace-advisor",
  "paseo-committee": "byspace-committee",
  "paseo-handoff": "byspace-handoff",
  "paseo-help": "byspace-help",
  "paseo-plugin": "byspace-plugin",
};

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

function migrateLegacySkillNames(selection: SkillSelection): SkillSelection {
  if (selection.mode === "all") return selection;
  const names = selection.skills.map((name) => LEGACY_SKILL_NAME_ALIASES[name] ?? name);
  return { mode: "custom", skills: [...new Set(names)].sort() };
}

export function coerceSkillSelection(value: unknown): SkillSelection {
  if (!isRecord(value)) return DEFAULT_SKILL_SELECTION;
  if (value.mode === "all") return { mode: "all" };
  if (value.mode === "custom") {
    return { mode: "custom", skills: coerceSkillNames(value.skills) };
  }
  return DEFAULT_SKILL_SELECTION;
}

export function createSkillSelectionStore(
  configStore: Pick<DaemonConfigStore, "get" | "setAgentSkillSelection">,
): SkillSelectionStore {
  return {
    async get() {
      return migrateLegacySkillNames(coerceSkillSelection(configStore.get().skills?.selection));
    },
    async set(selection) {
      const parsed = migrateLegacySkillNames(coerceSkillSelection(selection));
      configStore.setAgentSkillSelection(parsed);
      return parsed;
    },
    async isSet() {
      return configStore.get().skills?.selection !== undefined;
    },
  };
}
