import { defaultWebSocketFactory } from "@byspace/client/internal/daemon-client-websocket-transport";
import type { WebSocketFactory } from "@byspace/client/internal/daemon-client-transport-types";

export function createAppWebSocketFactory(): WebSocketFactory {
  return defaultWebSocketFactory;
}
