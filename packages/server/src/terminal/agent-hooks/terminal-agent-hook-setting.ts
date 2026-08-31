import type { MutableDaemonConfig, TerminalAgentHookProviderId } from "@getpaseo/protocol/messages";
import type { DaemonConfigStore } from "../../server/daemon-config-store.js";
import type { AgentHookInstallLogger, AgentHookInstallOptions } from "./agent-hook-installer.js";
import {
  AGENT_HOOK_PROVIDERS,
  installRegisteredAgentHook,
  type RegisteredAgentHookInstallOptions,
  uninstallRegisteredAgentHook,
} from "./provider-registry.js";

interface ApplyTerminalAgentHookSettingOptions {
  store: DaemonConfigStore;
  logger?: AgentHookInstallLogger;
  install?: AgentHookInstallOptions;
}

export type ResolvedTerminalAgentHookSettings = Record<TerminalAgentHookProviderId, boolean>;

export function resolveTerminalAgentHookSettings(
  config: Pick<MutableDaemonConfig, "enableTerminalAgentHooks" | "terminalAgentHooks">,
): ResolvedTerminalAgentHookSettings {
  const providerSettings = config.terminalAgentHooks;
  return Object.fromEntries(
    (Object.keys(AGENT_HOOK_PROVIDERS) as TerminalAgentHookProviderId[]).map((providerId) => [
      providerId,
      providerSettings === undefined
        ? config.enableTerminalAgentHooks === true
        : providerSettings[providerId] === true,
    ]),
  ) as ResolvedTerminalAgentHookSettings;
}

// Provider settings take over as one map: an omitted map keeps the legacy global
// switch working, while a missing key in a present map is always disabled.
export function applyTerminalAgentHookSetting(
  options: ApplyTerminalAgentHookSettingOptions,
): () => void {
  const installOptions: RegisteredAgentHookInstallOptions = {
    ...options.install,
    logger: options.logger,
  };
  let applied = resolveTerminalAgentHookSettings(options.store.get());

  for (const providerId of Object.keys(applied) as TerminalAgentHookProviderId[]) {
    if (applied[providerId]) {
      installRegisteredAgentHook(providerId, installOptions);
    }
  }

  return options.store.onChange((config) => {
    const settings = resolveTerminalAgentHookSettings(config);
    for (const providerId of Object.keys(settings) as TerminalAgentHookProviderId[]) {
      if (settings[providerId] === applied[providerId]) continue;
      if (settings[providerId]) {
        installRegisteredAgentHook(providerId, installOptions);
      } else {
        uninstallRegisteredAgentHook(providerId, installOptions);
      }
    }
    applied = settings;
  });
}
