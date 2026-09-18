import type { ProviderBySpaceToolsPolicy } from "@byspace/protocol/provider-config";

interface ProviderBySpaceToolSettings {
  byspaceTools?: ProviderBySpaceToolsPolicy;
}

export function resolveBySpaceToolPolicy(
  providerId: string,
  providerSettings: Readonly<Record<string, ProviderBySpaceToolSettings>> | undefined,
): ProviderBySpaceToolsPolicy | undefined {
  return providerSettings?.[providerId]?.byspaceTools;
}

export function isBySpaceToolEnabled(
  policy: ProviderBySpaceToolsPolicy | undefined,
  toolName: string,
): boolean {
  if (toolName === "speak") {
    return true;
  }
  if (!isBySpaceToolPolicyEnabled(policy)) {
    return false;
  }
  return !policy?.disabledTools?.includes(toolName);
}

export function isBySpaceToolPolicyEnabled(
  policy: ProviderBySpaceToolsPolicy | undefined,
): boolean {
  return policy?.enabled !== false;
}
