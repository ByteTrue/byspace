import type { TerminalAgentHookProviderId } from "@getpaseo/protocol/messages";
import {
  type AgentHookActivityInput,
  type AgentHookActivityState,
  type AgentHookInstallLogger,
  type AgentHookInstallOptions,
  type AgentHookInstallResult,
  type AgentHookProvider,
  agentHooksAreInstalled,
  installAgentHooks,
  uninstallAgentHooks,
} from "./agent-hook-installer.js";
import { claudeAgentHookProvider } from "./claude/claude.js";
import { codexAgentHookProvider } from "./codex/codex.js";
import { opencodeAgentHookProvider } from "./opencode/opencode.js";
import { piAgentHookProvider } from "./pi/pi.js";

export type {
  AgentHookActivityInput,
  AgentHookActivityState,
  AgentHookProvider,
} from "./agent-hook-installer.js";

export const AGENT_HOOK_PROVIDERS = {
  claude: claudeAgentHookProvider,
  codex: codexAgentHookProvider,
  opencode: opencodeAgentHookProvider,
  pi: piAgentHookProvider,
} satisfies Record<TerminalAgentHookProviderId, AgentHookProvider>;

export type AgentHookProviderId = TerminalAgentHookProviderId;

export interface AgentHookActivityRequest {
  provider: string;
  event: string;
  input: AgentHookActivityInput;
}

export interface RegisteredAgentHookInstallOptions extends AgentHookInstallOptions {
  logger?: AgentHookInstallLogger;
}

export function installRegisteredAgentHook(
  providerId: AgentHookProviderId,
  options: RegisteredAgentHookInstallOptions = {},
): AgentHookInstallResult | null {
  const provider = AGENT_HOOK_PROVIDERS[providerId];
  try {
    return installAgentHooks(provider, options);
  } catch (error) {
    options.logger?.warn(
      { err: error, provider: provider.id },
      "Failed to install terminal activity hook provider",
    );
    return null;
  }
}

export function uninstallRegisteredAgentHook(
  providerId: AgentHookProviderId,
  options: RegisteredAgentHookInstallOptions = {},
): AgentHookInstallResult | null {
  const provider = AGENT_HOOK_PROVIDERS[providerId];
  try {
    return uninstallAgentHooks(provider, options);
  } catch (error) {
    options.logger?.warn(
      { err: error, provider: provider.id },
      "Failed to uninstall terminal activity hook provider",
    );
    return null;
  }
}

export function installRegisteredAgentHooks(
  options: RegisteredAgentHookInstallOptions = {},
): AgentHookInstallResult[] {
  return (Object.keys(AGENT_HOOK_PROVIDERS) as AgentHookProviderId[]).flatMap((providerId) => {
    const result = installRegisteredAgentHook(providerId, options);
    return result ? [result] : [];
  });
}

export function uninstallRegisteredAgentHooks(
  options: RegisteredAgentHookInstallOptions = {},
): void {
  for (const providerId of Object.keys(AGENT_HOOK_PROVIDERS) as AgentHookProviderId[]) {
    uninstallRegisteredAgentHook(providerId, options);
  }
}

export function registeredAgentHooksAreInstalled(options: AgentHookInstallOptions = {}): boolean {
  return Object.values(AGENT_HOOK_PROVIDERS).every((provider) =>
    agentHooksAreInstalled(provider, options),
  );
}

export async function resolveHookActivity(
  request: AgentHookActivityRequest,
): Promise<AgentHookActivityState | null> {
  const provider =
    AGENT_HOOK_PROVIDERS[request.provider.toLowerCase() as TerminalAgentHookProviderId];
  if (!provider) return null;

  return provider.resolveActivity({ event: request.event, input: request.input });
}
