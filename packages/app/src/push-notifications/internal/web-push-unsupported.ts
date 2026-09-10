import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { WebPushState } from "./web-subscription";

/**
 * Web Push is a browser transport. Native builds use Expo push, and the base
 * entrypoint has to declare the same signatures because it is what TypeScript
 * resolves for `@/push-notifications`.
 */
export function isWebPushSupported(): boolean {
  return false;
}

export async function getWebPushState(
  _client: DaemonClient | null,
  _serverId: string,
): Promise<WebPushState> {
  return "unsupported";
}

export async function enableWebPush(_input: {
  client: DaemonClient;
  serverId: string;
}): Promise<WebPushState> {
  return "unsupported";
}
