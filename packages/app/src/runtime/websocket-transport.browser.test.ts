import { describe, expect, inject, test } from "vitest";
import { defaultWebSocketFactory } from "@bytetrue/byspace-client/internal/daemon-client-websocket-transport";

declare module "vitest" {
  interface ProvidedContext {
    passwordlessRelayUrl: string;
  }
}

function openPasswordlessRelayConnection(url: string): Promise<WebSocket> {
  const socket = defaultWebSocketFactory(url, { headers: {}, protocols: undefined });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out waiting for the passwordless relay connection"));
    }, 2_000);

    socket.addEventListener?.("open", () => {
      clearTimeout(timeout);
      resolve(socket as WebSocket);
    });
    socket.addEventListener?.("error", () => {
      clearTimeout(timeout);
      reject(new Error("Passwordless relay connection failed before open"));
    });
  });
}

describe("browser WebSocket transport", () => {
  test("opens a passwordless relay-style connection without a subprotocol", async () => {
    const socket = await openPasswordlessRelayConnection(inject("passwordlessRelayUrl"));
    try {
      expect(socket.protocol).toBe("");
    } finally {
      socket.close();
    }
  });
});
