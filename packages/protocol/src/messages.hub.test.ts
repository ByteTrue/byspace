import { describe, expect, test } from "vitest";

import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "./messages.js";

describe("Hub management protocol", () => {
  test.each([
    {
      type: "hub.management.daemon.connect.request",
      requestId: "r1",
      hubUrl: "https://hub.example",
      token: "token",
      permissions: [],
    },
    { type: "hub.management.daemon.get_status.request", requestId: "r2" },
    { type: "hub.management.daemon.disconnect.request", requestId: "r3", force: true },
    {
      type: "hub.management.daemon.permissions.update.request",
      requestId: "r4",
      grant: ["hub.execute"],
      revoke: [],
    },
  ])("accepts trusted management request $type", (message) => {
    expect(SessionInboundMessageSchema.parse(message)).toEqual(message);
  });

  test.each([
    {
      type: "hub.management.daemon.connect.response",
      payload: {
        requestId: "r1",
        status: {
          state: "connected",
          daemonId: "daemon-1",
          hubOrigin: "https://hub.example",
          connectedAt: "2026-07-13T00:00:00.000Z",
          lastError: null,
        },
      },
    },
    {
      type: "hub.management.daemon.get_status.response",
      payload: {
        requestId: "r2",
        status: {
          state: "not_connected",
          daemonId: null,
          hubOrigin: null,
          connectedAt: null,
          lastError: null,
        },
      },
    },
    {
      type: "hub.management.daemon.disconnect.response",
      payload: {
        requestId: "r3",
        status: {
          state: "disconnecting",
          daemonId: "daemon-1",
          hubOrigin: "https://hub.example",
          connectedAt: null,
          lastError: "offline",
        },
        warning: "pending",
      },
    },
    {
      type: "hub.management.daemon.permissions.update.response",
      payload: {
        requestId: "r4",
        status: {
          state: "connected",
          daemonId: "daemon-1",
          hubOrigin: "https://hub.example",
          connectedAt: "2026-07-13T00:00:00.000Z",
          lastError: null,
        },
      },
    },
  ])("accepts trusted management response $type", (message) => {
    expect(SessionOutboundMessageSchema.parse(message)).toEqual(message);
  });
});
