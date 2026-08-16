import { describe, expect, test } from "vitest";
import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "./messages.js";

const target = {
  v: 2 as const,
  serverId: "remote-daemon",
  daemonPublicKeyB64: "remote-public-key",
  relay: {
    endpoint: "https://relay.example.com",
    useTls: true,
  },
};

describe("remote TCP forward control protocol", () => {
  test("parses open and close requests", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "remote.tcp.forward.open.request",
        requestId: "req-open",
        target,
        targetPort: 3000,
      }),
    ).toMatchObject({ requestId: "req-open", targetPort: 3000 });

    expect(
      SessionInboundMessageSchema.parse({
        type: "remote.tcp.forward.close.request",
        requestId: "req-close",
        forwardId: "forward-1",
      }),
    ).toMatchObject({ requestId: "req-close", forwardId: "forward-1" });
  });

  test("ignores arbitrary target addresses and rejects invalid ports", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "remote.tcp.forward.open.request",
      requestId: "req-open",
      target,
      targetPort: 3000,
      targetHost: "192.168.1.1",
    });
    expect(parsed).not.toHaveProperty("targetHost");

    expect(() =>
      SessionInboundMessageSchema.parse({
        type: "remote.tcp.forward.open.request",
        requestId: "req-open",
        target,
        targetPort: 0,
      }),
    ).toThrow();
  });

  test("parses open and close responses", () => {
    expect(
      SessionOutboundMessageSchema.parse({
        type: "remote.tcp.forward.open.response",
        payload: {
          requestId: "req-open",
          forwardId: "forward-1",
          localHost: "127.0.0.1",
          localPort: 49321,
          targetServerId: "remote-daemon",
          targetPort: 3000,
        },
      }),
    ).toMatchObject({ type: "remote.tcp.forward.open.response" });

    expect(
      SessionOutboundMessageSchema.parse({
        type: "remote.tcp.forward.close.response",
        payload: { requestId: "req-close", forwardId: "forward-1" },
      }),
    ).toMatchObject({ type: "remote.tcp.forward.close.response" });
  });
});
