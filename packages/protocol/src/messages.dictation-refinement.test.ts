import { describe, expect, test } from "vitest";

import {
  DictationRefineRequestSchema,
  DictationRefineResponseSchema,
  MutableDaemonConfigPatchSchema,
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

describe("dictation refinement schemas", () => {
  test("parses the request and response through the session unions", () => {
    const request = {
      type: "speech.dictation.refine.request",
      requestId: "request-1",
      agentId: "77777777-7777-4777-8777-777777777777",
      text: "先检查两个文件",
    } as const;
    const response = {
      type: "speech.dictation.refine.response",
      payload: {
        requestId: "request-1",
        text: "先检查两个文件。",
        refined: true,
      },
    } as const;

    expect(DictationRefineRequestSchema.parse(request)).toEqual(request);
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    expect(DictationRefineResponseSchema.parse(response)).toEqual(response);
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  test("keeps the capability and config optional for older peers", () => {
    const serverInfo = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "srv_old",
      features: {},
    });
    expect(serverInfo.features.dictationRefinement).toBeUndefined();
    expect(MutableDaemonConfigPatchSchema.parse({})).toEqual({});
  });

  test("accepts the opt-in config patch", () => {
    expect(MutableDaemonConfigPatchSchema.parse({ dictation: { refineWithAgent: true } })).toEqual({
      dictation: { refineWithAgent: true },
    });
  });
});
