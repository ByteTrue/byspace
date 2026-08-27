import { nativeWebSocketFactory } from "@bytetrue/byspace-client/internal/daemon-client-websocket-transport";
import type { WebSocketFactory } from "@bytetrue/byspace-client/internal/daemon-client-transport-types";

export function createAppWebSocketFactory(): WebSocketFactory {
  return nativeWebSocketFactory;
}
