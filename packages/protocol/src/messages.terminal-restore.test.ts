import { describe, expect, test } from "vitest";

import { ServerInfoStatusPayloadSchema, SubscribeTerminalRequestSchema } from "./messages.js";

describe("terminal restore schemas", () => {
  test("accepts legacy terminal subscribe requests without restore options", () => {
    expect(
      SubscribeTerminalRequestSchema.parse({
        type: "subscribe_terminal_request",
        terminalId: "term-1",
        requestId: "req-1",
      }),
    ).toEqual({
      type: "subscribe_terminal_request",
      terminalId: "term-1",
      requestId: "req-1",
    });
  });

  test("accepts kebab-case terminal restore modes", () => {
    for (const mode of ["live", "visible-snapshot", "full-snapshot"] as const) {
      expect(
        SubscribeTerminalRequestSchema.parse({
          type: "subscribe_terminal_request",
          terminalId: "term-1",
          requestId: `req-${mode}`,
          restore: {
            mode,
            scrollbackLines: 200,
            size: { rows: 24, cols: 80 },
          },
        }).restore?.mode,
      ).toBe(mode);
    }
  });

  test("carries the resume request alongside the fallback mode", () => {
    expect(
      SubscribeTerminalRequestSchema.parse({
        type: "subscribe_terminal_request",
        terminalId: "term-1",
        requestId: "req-1",
        restore: {
          resume: true,
          mode: "visible-snapshot",
          scrollbackLines: 1_000,
        },
      }).restore,
    ).toEqual({ resume: true, mode: "visible-snapshot", scrollbackLines: 1_000 });
  });

  test("a daemon that does not know a restore field still parses the request", () => {
    // This is what makes `resume` safe to send unconditionally: a daemon released
    // before it existed sees an unknown key, not an invalid message. A new `mode`
    // value would have failed that daemon's enum instead.
    expect(
      SubscribeTerminalRequestSchema.parse({
        type: "subscribe_terminal_request",
        terminalId: "term-1",
        requestId: "req-1",
        restore: {
          mode: "visible-snapshot",
          somethingOnlyANewerClientSends: true,
        },
      }).restore?.mode,
    ).toBe("visible-snapshot");
  });

  test("rejects camel-case terminal restore modes", () => {
    expect(() =>
      SubscribeTerminalRequestSchema.parse({
        type: "subscribe_terminal_request",
        terminalId: "term-1",
        requestId: "req-1",
        restore: {
          mode: "visibleSnapshot",
        },
      }),
    ).toThrow();
  });

  test("accepts terminal restore mode feature metadata", () => {
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "server-1",
        features: {
          "terminal-restore-modes": true,
        },
      }).features?.["terminal-restore-modes"],
    ).toBe(true);
  });
});
