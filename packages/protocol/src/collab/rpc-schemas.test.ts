import { describe, expect, it } from "vitest";
import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "../messages.js";
import {
  CollabSliceCreateRequestSchema,
  CollabSliceCreateResponseSchema,
  CollabSliceListRequestSchema,
  CollabSliceListResponseSchema,
} from "./rpc-schemas.js";

const RECORD = {
  id: "9f1c8b1e-0c1d-4a5b-8e2f-3a4b5c6d7e8f",
  title: "First record",
  createdAt: "2026-09-26T16:00:00.000Z",
  updatedAt: "2026-09-26T16:00:00.000Z",
};

describe("collab RPC schemas", () => {
  it("parses a create request and trims the title", () => {
    expect(
      CollabSliceCreateRequestSchema.parse({
        type: "collab.slice.create.request",
        requestId: "req-1",
        title: "  Record  ",
      }),
    ).toEqual({
      type: "collab.slice.create.request",
      requestId: "req-1",
      title: "Record",
    });
  });

  it("rejects a create request with a blank title", () => {
    expect(() =>
      CollabSliceCreateRequestSchema.parse({
        type: "collab.slice.create.request",
        requestId: "req-1",
        title: "   ",
      }),
    ).toThrow();
  });

  it("parses a create response with a record", () => {
    expect(
      CollabSliceCreateResponseSchema.parse({
        type: "collab.slice.create.response",
        payload: { requestId: "req-1", record: RECORD, error: null },
      }),
    ).toEqual({
      type: "collab.slice.create.response",
      payload: { requestId: "req-1", record: RECORD, error: null },
    });
  });

  it("rejects a create response with an invalid record id", () => {
    expect(() =>
      CollabSliceCreateResponseSchema.parse({
        type: "collab.slice.create.response",
        payload: {
          requestId: "req-1",
          record: { ...RECORD, id: "not-a-uuid" },
          error: null,
        },
      }),
    ).toThrow();
  });

  it("parses a list request and response", () => {
    expect(
      CollabSliceListRequestSchema.parse({
        type: "collab.slice.list.request",
        requestId: "req-2",
      }),
    ).toEqual({ type: "collab.slice.list.request", requestId: "req-2" });
    expect(
      CollabSliceListResponseSchema.parse({
        type: "collab.slice.list.response",
        payload: { requestId: "req-2", records: [RECORD], error: null },
      }),
    ).toEqual({
      type: "collab.slice.list.response",
      payload: { requestId: "req-2", records: [RECORD], error: null },
    });
  });

  it("accepts the request through the session inbound union", () => {
    const parsed = SessionInboundMessageSchema.safeParse({
      type: "collab.slice.create.request",
      requestId: "req-1",
      title: "Record",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts the response through the session outbound union", () => {
    const parsed = SessionOutboundMessageSchema.safeParse({
      type: "collab.slice.list.response",
      payload: { requestId: "req-2", records: [], error: null },
    });
    expect(parsed.success).toBe(true);
  });
});
