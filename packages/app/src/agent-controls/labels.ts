import { i18n } from "@/i18n/i18next";
import { AGENT_ROLE_LABEL_KEYS } from "@/agent-controls/roles";

interface ControlLabelInput {
  id: string;
  label?: string | null;
}

function sentenceCase(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function splitCompactLabel(value: string, splitHyphen: boolean): string {
  const separatorPattern = splitHyphen ? /[_-]+/g : /_+/g;

  return value
    .replace(separatorPattern, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function formatControlLabel(option: ControlLabelInput, splitHyphen: boolean): string {
  const rawLabel = (option.label ?? option.id).trim();
  return sentenceCase(splitCompactLabel(rawLabel, splitHyphen));
}

export function formatAgentModeLabel(mode: ControlLabelInput): string {
  return formatControlLabel(mode, mode.label == null);
}

/**
 * A built-in role's display label. Roles the app has copy for are translated;
 * anything else the daemon advertises falls back to its name, so a role added to
 * a newer daemon shows up readable instead of as a missing-key string.
 */
export function formatAgentRoleLabel(roleId: string): string {
  // hasOwn, not a bare lookup: the map is a plain object, so a role named
  // "constructor" or "toString" would otherwise return a prototype member and
  // hand i18n a function instead of a key.
  if (Object.hasOwn(AGENT_ROLE_LABEL_KEYS, roleId)) {
    return i18n.t(AGENT_ROLE_LABEL_KEYS[roleId]);
  }
  return formatControlLabel({ id: roleId }, true);
}

export function formatThinkingOptionLabel(option: ControlLabelInput): string {
  const rawLabel = (option.label ?? option.id).trim();
  const compactId = option.id.replace(/[\s_-]+/g, "").toLowerCase();
  const compactLabel = rawLabel.replace(/[\s_-]+/g, "").toLowerCase();

  if (compactId === "xhigh" || compactLabel === "xhigh") {
    return i18n.t("agentControls.thinking.extraHigh");
  }

  return formatControlLabel(option, true);
}
