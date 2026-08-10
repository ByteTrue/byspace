import type { ServerCapabilityState } from "@bytetrue/byspace-protocol/messages";
import type { DaemonServerInfo } from "@/stores/session-store";

export function getServerCapabilities(params: {
  serverInfo: DaemonServerInfo | null | undefined;
}): DaemonServerInfo["capabilities"] | null {
  const capabilities = params.serverInfo?.capabilities;
  if (!capabilities) {
    return null;
  }
  return capabilities;
}

export function getDictationReadinessState(params: {
  serverInfo: DaemonServerInfo | null | undefined;
}): ServerCapabilityState | null {
  return getServerCapabilities({ serverInfo: params.serverInfo })?.voice?.dictation ?? null;
}

export function resolveDictationUnavailableMessage(params: {
  serverInfo: DaemonServerInfo | null | undefined;
}): string | null {
  const readiness = getDictationReadinessState(params);
  if (!readiness) {
    return null;
  }
  if (readiness.enabled && readiness.reason.trim().length === 0) {
    return null;
  }
  const message = readiness.reason.trim();
  if (message.length > 0) {
    return message;
  }
  return null;
}
