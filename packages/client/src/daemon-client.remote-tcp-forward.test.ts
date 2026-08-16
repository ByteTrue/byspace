import { expect, test, vi } from "vitest";
import type { ConnectionOfferV2 } from "@bytetrue/byspace-protocol/connection-offer";
import { DaemonClient, type DaemonTransport } from "./daemon-client";

function createTransport() {
  const sent: string[] = [];
  let onMessage: (data: unknown, isBinary: boolean) => void = () => undefined;
  let onOpen: () => void = () => undefined;

  const transport: DaemonTransport = {
    send(data) {
      if (typeof data === "string") sent.push(data);
    },
    close() {},
    onMessage(handler) {
      onMessage = handler;
      return () => undefined;
    },
    onOpen(handler) {
      onOpen = handler;
      return () => undefined;
    },
    onClose() {
      return () => undefined;
    },
    onError() {
      return () => undefined;
    },
  };

  return {
    transport,
    sent,
    open() {
      onOpen();
      sent.length = 0;
      onMessage(
        JSON.stringify({
          type: "session",
          message: {
            type: "status",
            payload: {
              status: "server_info",
              serverId: "source-daemon",
              features: { remoteTcpForward: true },
            },
          },
        }),
        false,
      );
    },
    respond(message: unknown) {
      onMessage(JSON.stringify({ type: "session", message }), false);
    },
  };
}

const target: ConnectionOfferV2 = {
  v: 2,
  serverId: "target-daemon",
  daemonPublicKeyB64: "cHVibGljLWtleQ",
  relay: { endpoint: "relay.example.com", useTls: true },
};

function createClient(transport: DaemonTransport): DaemonClient {
  return new DaemonClient({
    url: "ws://source-daemon",
    clientId: "remote-tcp-forward-test",
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    reconnect: { enabled: false },
    transportFactory: () => transport,
  });
}

test("correlates remote TCP forward open and close responses", async () => {
  const mock = createTransport();
  const client = createClient(mock.transport);
  const connected = client.connect();
  mock.open();
  await connected;

  const opening = client.openRemoteTcpForward({
    target,
    targetPort: 3000,
    localPort: 43000,
  });
  const openFrame = JSON.parse(mock.sent.at(-1) ?? "") as {
    message: { requestId: string; type: string; targetPort: number; localPort?: number };
  };
  expect(openFrame.message).toMatchObject({
    type: "remote.tcp.forward.open.request",
    targetPort: 3000,
    localPort: 43000,
  });
  mock.respond({
    type: "remote.tcp.forward.open.response",
    payload: {
      requestId: openFrame.message.requestId,
      forwardId: "forward-1",
      localHost: "127.0.0.1",
      localPort: 43000,
      targetServerId: "target-daemon",
      targetPort: 3000,
    },
  });
  await expect(opening).resolves.toMatchObject({ forwardId: "forward-1", localPort: 43000 });

  const closing = client.closeRemoteTcpForward("forward-1");
  const closeFrame = JSON.parse(mock.sent.at(-1) ?? "") as {
    message: { requestId: string; type: string; forwardId: string };
  };
  expect(closeFrame.message).toMatchObject({
    type: "remote.tcp.forward.close.request",
    forwardId: "forward-1",
  });
  mock.respond({
    type: "remote.tcp.forward.close.response",
    payload: { requestId: closeFrame.message.requestId, forwardId: "forward-1" },
  });
  await expect(closing).resolves.toEqual({
    requestId: closeFrame.message.requestId,
    forwardId: "forward-1",
  });

  await client.close();
});
