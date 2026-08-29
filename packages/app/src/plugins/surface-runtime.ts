import { createBySpaceApi, type BySpaceApi } from "@bytetrue/byspace-client";
import type { DaemonClient } from "@bytetrue/byspace-client/internal/daemon-client";

export interface PluginSurfaceRuntime {
  byspace: BySpaceApi;
  invoke(method: string, input: unknown): Promise<unknown>;
}

export function createPluginSurfaceRuntime(
  client: DaemonClient | null,
  pluginId: string,
): PluginSurfaceRuntime | null {
  if (!client) return null;
  return {
    byspace: createBySpaceApi(client),
    invoke: (method, input) => client.invokePluginRpc(pluginId, method, input),
  };
}
