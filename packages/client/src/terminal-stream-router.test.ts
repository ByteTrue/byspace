import {
  decodeTerminalResizePayload,
  decodeTerminalStreamFrame,
  TerminalStreamOpcode,
} from "@bytetrue/byspace-protocol/binary-frames/index";
import { describe, expect, test } from "vitest";

import { TerminalStreamRouter, type TerminalStreamEvent } from "./terminal-stream-router.js";

describe("terminal-stream-router", () => {
  test("routes restore frames as restore events", () => {
    const router = new TerminalStreamRouter();
    const events: TerminalStreamEvent[] = [];
    const payload = new TextEncoder().encode("restored screen");

    router.setSlot("term-1", 7);
    router.onEvent((event) => events.push(event));
    router.handleFrame({
      opcode: TerminalStreamOpcode.Restore,
      slot: 7,
      payload,
    });

    expect(events).toEqual([
      {
        terminalId: "term-1",
        type: "restore",
        data: payload,
      },
    ]);
  });

  test("preserves resize update intent in binary frames", () => {
    const router = new TerminalStreamRouter();
    router.setSlot("term-1", 7);

    const encoded = router.encodeInput("term-1", {
      type: "resize",
      rows: 24,
      cols: 80,
      intent: "update",
    });
    const frame = decodeTerminalStreamFrame(encoded!);

    expect(frame?.opcode).toBe(TerminalStreamOpcode.Resize);
    expect(frame?.slot).toBe(7);
    expect(decodeTerminalResizePayload(frame?.payload ?? new Uint8Array())).toEqual({
      rows: 24,
      cols: 80,
      intent: "update",
    });
  });
});
