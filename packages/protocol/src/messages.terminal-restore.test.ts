import { describe, expect, test } from "vitest";

import { SubscribeTerminalRequestSchema } from "./messages.js";

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

  test("carries the optional resume request alongside the fallback mode", () => {
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

  test("keeps resume optional for older terminal subscribe requests", () => {
    expect(
      SubscribeTerminalRequestSchema.parse({
        type: "subscribe_terminal_request",
        terminalId: "term-1",
        requestId: "req-1",
        restore: {
          mode: "visible-snapshot",
          scrollbackLines: 1_000,
        },
      }).restore?.resume,
    ).toBeUndefined();
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
});
