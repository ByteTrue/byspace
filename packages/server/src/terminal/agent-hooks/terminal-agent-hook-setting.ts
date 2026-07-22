import type { MutableDaemonConfig } from "@bytetrue/byspace-protocol/messages";
import type { DaemonConfigStore } from "../../server/daemon-config-store.js";
import type { AgentHookInstallLogger, AgentHookInstallOptions } from "./agent-hook-installer.js";
import {
  AGENT_HOOK_PROVIDERS,
  installRegisteredAgentHook,
  type AgentHookProviderId,
  uninstallRegisteredAgentHook,
} from "./provider-registry.js";

export type TerminalAgentHookSettings = Record<AgentHookProviderId, boolean>;

export function resolveTerminalAgentHookSettings(
  config: Pick<MutableDaemonConfig, "enableTerminalAgentHooks" | "terminalAgentHooks">,
): TerminalAgentHookSettings {
  const legacyEnabled = config.enableTerminalAgentHooks;
  return Object.fromEntries(
    (Object.keys(AGENT_HOOK_PROVIDERS) as AgentHookProviderId[]).map((providerId) => [
      providerId,
      config.terminalAgentHooks?.[providerId] ?? legacyEnabled,
    ]),
  ) as TerminalAgentHookSettings;
}

export function applyTerminalAgentHookSetting(options: {
  store: DaemonConfigStore;
  install?: AgentHookInstallOptions;
  logger?: AgentHookInstallLogger;
}): () => void {
  const install = {
    ...options.install,
    logger: options.logger,
  };
  let applied = resolveTerminalAgentHookSettings(options.store.get());
  for (const providerId of Object.keys(applied) as AgentHookProviderId[]) {
    if (applied[providerId]) installRegisteredAgentHook(providerId, install);
  }

  return options.store.onChange((config) => {
    const settings = resolveTerminalAgentHookSettings(config);
    for (const providerId of Object.keys(settings) as AgentHookProviderId[]) {
      if (settings[providerId] === applied[providerId]) continue;
      if (settings[providerId]) {
        installRegisteredAgentHook(providerId, install);
      } else {
        uninstallRegisteredAgentHook(providerId, install);
      }
    }
    applied = settings;
  });
}
