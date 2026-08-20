import { describe, expect, it } from "vitest";
import {
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  ServerInfoStatusPayloadSchema,
} from "./messages.js";

const target = {
  serverId: "srv_target",
  label: "home",
  port: 5173,
  daemonPublicKeyB64: "public-key",
};

const service = {
  id: "rws_1",
  name: "home-web",
  hostname: "home-web.remote.localhost",
  target,
  createdAt: "2026-08-20T00:00:00.000Z",
};

describe("Remote Web Service protocol", () => {
  it.each([
    { type: "remote_web_service.list.request", requestId: "req-list" },
    {
      type: "remote_web_service.create.request",
      requestId: "req-create",
      name: "home-web",
      target,
    },
    { type: "remote_web_service.remove.request", requestId: "req-remove", id: "rws_1" },
  ])("parses $type", (message) => {
    expect(SessionInboundMessageSchema.parse(message)).toEqual(message);
  });

  it.each([
    {
      type: "remote_web_service.list.response",
      payload: { requestId: "req-list", services: [service], error: null },
    },
    {
      type: "remote_web_service.create.response",
      payload: { requestId: "req-create", service, error: null },
    },
    {
      type: "remote_web_service.remove.response",
      payload: { requestId: "req-remove", service, error: null },
    },
  ])("parses $type", (message) => {
    expect(SessionOutboundMessageSchema.parse(message)).toEqual(message);
  });

  it("reports optional data relay readiness without breaking old daemon payloads", () => {
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "srv_new",
        dataRelay: { configured: true },
        features: { remoteWebServices: true },
      }).dataRelay,
    ).toEqual({ configured: true });

    const oldPayload = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "srv_old",
      features: {},
    });
    expect(oldPayload.features.remoteWebServices).toBeUndefined();
    expect(oldPayload.dataRelay).toBeUndefined();
  });
});
