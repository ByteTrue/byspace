import { describe, expect, it } from "vitest";
import {
  EMPTY_FOCUS_CLAIM_STATE,
  canRequestFocusClaim,
  reconcileFocusClaim,
  resolveTerminalResizeClaim,
  settleFocusClaim,
  type FocusClaimState,
} from "./terminal-pane-focus-claim";

function request(
  state: FocusClaimState,
  input: { key: string | null; canRequest: boolean },
): FocusClaimState {
  return reconcileFocusClaim(state, input).state;
}

describe("terminal pane focus claim", () => {
  it("forwards resize callbacks only from the active focused ready candidate", () => {
    const readiness = {
      isWorkspaceFocused: true,
      isAppActivelyVisible: true,
      isClientReady: true,
      isConnected: true,
      isRendererReady: true,
    };
    const candidates = [
      resolveTerminalResizeClaim({
        size: { rows: 30, cols: 90 },
        previousSentSize: null,
        shouldClaim: true,
        forceClaim: false,
        supportsTerminalSizeOwnership: true,
        readiness: { ...readiness, isPaneFocused: false },
      }),
      resolveTerminalResizeClaim({
        size: { rows: 42, cols: 120 },
        previousSentSize: null,
        shouldClaim: true,
        forceClaim: false,
        supportsTerminalSizeOwnership: true,
        readiness: { ...readiness, isPaneFocused: true },
      }),
    ];

    expect(candidates).toEqual([
      { shouldSend: false, intent: "claim" },
      { shouldSend: true, intent: "claim" },
    ]);
  });

  it("sends passive refits as owner-only updates and lets interaction reclaim the same size", () => {
    const readiness = {
      isWorkspaceFocused: true,
      isPaneFocused: true,
      isAppActivelyVisible: true,
      isClientReady: true,
      isConnected: true,
      isRendererReady: true,
    };
    const size = { rows: 42, cols: 120 };

    const passiveRefit = resolveTerminalResizeClaim({
      size,
      previousSentSize: size,
      shouldClaim: false,
      forceClaim: false,
      supportsTerminalSizeOwnership: true,
      readiness,
    });
    const ordinarySameSizeMeasurement = resolveTerminalResizeClaim({
      size,
      previousSentSize: size,
      shouldClaim: true,
      forceClaim: false,
      supportsTerminalSizeOwnership: true,
      readiness,
    });

    expect(passiveRefit).toEqual({ shouldSend: false, intent: "update" });
    expect(ordinarySameSizeMeasurement).toEqual({ shouldSend: true, intent: "claim" });
  });

  it("lets the current owner update after pane focus moves without transferring ownership", () => {
    expect(
      resolveTerminalResizeClaim({
        size: { rows: 20, cols: 100 },
        previousSentSize: { rows: 40, cols: 100 },
        shouldClaim: false,
        forceClaim: false,
        supportsTerminalSizeOwnership: true,
        readiness: {
          isWorkspaceFocused: true,
          isPaneFocused: false,
          isAppActivelyVisible: true,
          isClientReady: true,
          isConnected: true,
          isRendererReady: true,
        },
      }),
    ).toEqual({ shouldSend: true, intent: "update" });
  });

  it("keeps passive refits local against legacy daemons", () => {
    expect(
      resolveTerminalResizeClaim({
        size: { rows: 20, cols: 100 },
        previousSentSize: { rows: 40, cols: 100 },
        shouldClaim: false,
        forceClaim: false,
        supportsTerminalSizeOwnership: false,
        readiness: {
          isWorkspaceFocused: true,
          isPaneFocused: true,
          isAppActivelyVisible: true,
          isClientReady: true,
          isConnected: true,
          isRendererReady: true,
        },
      }),
    ).toEqual({ shouldSend: false, intent: "update" });
  });

  it("waits for both the client and renderer before requesting a claim", () => {
    const readiness = {
      isWorkspaceFocused: true,
      isPaneFocused: true,
      isAppActivelyVisible: true,
      isConnected: true,
    };
    expect(
      canRequestFocusClaim({ ...readiness, isClientReady: false, isRendererReady: true }),
    ).toBe(false);
    expect(
      canRequestFocusClaim({ ...readiness, isClientReady: true, isRendererReady: false }),
    ).toBe(false);
  });

  it("claims once per continuous pane-focus period and re-arms after blur", () => {
    const firstRequest = reconcileFocusClaim(EMPTY_FOCUS_CLAIM_STATE, {
      key: "ws:term-1",
      canRequest: true,
    });
    const sent = settleFocusClaim(firstRequest.state, { key: "ws:term-1", sent: true });
    const repeated = reconcileFocusClaim(sent, { key: "ws:term-1", canRequest: true });
    const blurred = request(sent, { key: null, canRequest: true });
    const refocused = reconcileFocusClaim(blurred, { key: "ws:term-1", canRequest: true });

    expect(firstRequest.shouldRequest).toBe(true);
    expect(repeated.shouldRequest).toBe(false);
    expect(refocused.shouldRequest).toBe(true);
  });
});
