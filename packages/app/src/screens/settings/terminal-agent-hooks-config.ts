import {
  TERMINAL_AGENT_HOOK_LEGACY_GLOBAL_PROVIDER_IDS,
  type MutableDaemonConfigPatch,
  type TerminalAgentHookProviderId,
  type TerminalAgentHookSettings,
} from "@getpaseo/protocol/messages";

const legacyGlobalProviderIds = new Set<TerminalAgentHookProviderId>(
  TERMINAL_AGENT_HOOK_LEGACY_GLOBAL_PROVIDER_IDS,
);

export const TERMINAL_AGENT_HOOK_PROVIDERS = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "opencode", label: "OpenCode" },
  { id: "pi", label: "Pi" },
] as const satisfies readonly {
  id: TerminalAgentHookProviderId;
  label: string;
}[];

export function isTerminalAgentHookProviderEnabled(
  settings: TerminalAgentHookSettings | undefined,
  legacyEnabled: boolean,
  providerId: TerminalAgentHookProviderId,
): boolean {
  return settings === undefined
    ? legacyEnabled && legacyGlobalProviderIds.has(providerId)
    : settings[providerId] === true;
}

export function createTerminalAgentHookPatch(
  providerId: TerminalAgentHookProviderId,
  enabled: boolean,
): MutableDaemonConfigPatch {
  return { terminalAgentHooks: { [providerId]: enabled } };
}
