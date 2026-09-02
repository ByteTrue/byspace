import { describe, expect, it } from "vitest";

import {
  EMPTY_FOCUS_CLAIM_STATE,
  canRequestFocusClaim,
  reconcileFocusClaim,
  resolveTerminalResizeClaim,
  settleFocusClaim,
  type FocusClaimReadiness,
  type FocusClaimState,
} from "./terminal-pane-focus-claim";

function request(
  state: FocusClaimState,
  input: { key: string | null; canRequest: boolean },
): FocusClaimState {
  return reconcileFocusClaim(state, input).state;
}

describe("terminal pane focus claim", () => {
  const readiness: FocusClaimReadiness = {
    isWorkspaceFocused: true,
    isPaneFocused: true,
    isAppActivelyVisible: true,
    isClientReady: true,
    isConnected: true,
    isRendererReady: true,
  };

  it("distinguishes size-claim from size-update intents based on pane focus", () => {
    const size = { rows: 40, cols: 100 };
    const claims = [
      resolveTerminalResizeClaim({
        size,
        previousSentSize: null,
        shouldClaim: true,
        forceClaim: false,
        supportsTerminalSizeOwnership: true,
        hasClaimedSize: false,
        readiness: { ...readiness, isPaneFocused: false },
      }),
      resolveTerminalResizeClaim({
        size,
        previousSentSize: null,
        shouldClaim: true,
        forceClaim: false,
        supportsTerminalSizeOwnership: true,
        hasClaimedSize: false,
        readiness: { ...readiness, isPaneFocused: true },
      }),
    ];

    expect(claims).toEqual([
      { shouldSend: false, intent: "claim" },
      { shouldSend: true, intent: "claim" },
    ]);
  });

  it("lets an active pane claim on ordinary same-size measurements", () => {
    const size = { rows: 40, cols: 100 };
    const passiveRefit = resolveTerminalResizeClaim({
      size,
      previousSentSize: size,
      shouldClaim: false,
      forceClaim: false,
      supportsTerminalSizeOwnership: true,
      hasClaimedSize: true,
      readiness,
    });
    const ordinarySameSizeMeasurement = resolveTerminalResizeClaim({
      size,
      previousSentSize: size,
      shouldClaim: true,
      forceClaim: false,
      supportsTerminalSizeOwnership: true,
      hasClaimedSize: true,
      readiness,
    });

    expect(passiveRefit).toEqual({ shouldSend: false, intent: "update" });
    expect(ordinarySameSizeMeasurement).toEqual({ shouldSend: true, intent: "claim" });
  });

  it("keeps a claimed terminal's passive resize ownership after pane focus moves in one connection epoch", () => {
    const key = "7:ws:term-1";
    const requested = reconcileFocusClaim(EMPTY_FOCUS_CLAIM_STATE, {
      key,
      canRequest: true,
    });
    const claimed = settleFocusClaim(requested.state, { key, sent: true });
    const blurred = request(claimed, { key, canRequest: false });

    const ownerUpdate = resolveTerminalResizeClaim({
      size: { rows: 20, cols: 100 },
      previousSentSize: { rows: 40, cols: 100 },
      shouldClaim: false,
      forceClaim: false,
      supportsTerminalSizeOwnership: true,
      hasClaimedSize: blurred.claimedKey === key,
      readiness: {
        isWorkspaceFocused: true,
        isPaneFocused: false,
        isAppActivelyVisible: true,
        isClientReady: true,
        isConnected: true,
        isRendererReady: true,
      },
    });

    expect(blurred).toEqual({ claimedKey: key, requestedKey: null });
    expect(ownerUpdate).toEqual({ shouldSend: true, intent: "update" });
  });

  it("invalidates a blurred claim across disconnect and a new connection epoch", () => {
    const firstConnectionKey = "7:ws:term-1";
    const requested = reconcileFocusClaim(EMPTY_FOCUS_CLAIM_STATE, {
      key: firstConnectionKey,
      canRequest: true,
    });
    const claimed = settleFocusClaim(requested.state, { key: firstConnectionKey, sent: true });
    const blurred = request(claimed, { key: firstConnectionKey, canRequest: false });
    const disconnected = request(blurred, { key: null, canRequest: false });
    const reconnected = reconcileFocusClaim(disconnected, {
      key: "8:ws:term-1",
      canRequest: false,
    });

    expect(blurred.claimedKey).toBe(firstConnectionKey);
    expect(disconnected).toEqual(EMPTY_FOCUS_CLAIM_STATE);
    expect(reconnected).toEqual({ state: EMPTY_FOCUS_CLAIM_STATE, shouldRequest: false });
  });

  it("keeps passive resizes from an unclaimed unfocused terminal local", () => {
    const key = "ws:term-1";
    const blurred = request(EMPTY_FOCUS_CLAIM_STATE, { key, canRequest: false });

    const passiveResize = resolveTerminalResizeClaim({
      size: { rows: 20, cols: 100 },
      previousSentSize: null,
      shouldClaim: false,
      forceClaim: false,
      supportsTerminalSizeOwnership: true,
      hasClaimedSize: blurred.claimedKey === key,
      readiness: {
        isWorkspaceFocused: true,
        isPaneFocused: false,
        isAppActivelyVisible: true,
        isClientReady: true,
        isConnected: true,
        isRendererReady: true,
      },
    });

    expect(blurred).toEqual(EMPTY_FOCUS_CLAIM_STATE);
    expect(passiveResize).toEqual({ shouldSend: false, intent: "update" });
  });

  it("keeps passive refits local against legacy daemons", () => {
    expect(
      resolveTerminalResizeClaim({
        size: { rows: 20, cols: 100 },
        previousSentSize: { rows: 40, cols: 100 },
        shouldClaim: false,
        forceClaim: false,
        supportsTerminalSizeOwnership: false,
        hasClaimedSize: true,
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
    const scopedReadiness = {
      isWorkspaceFocused: true,
      isPaneFocused: true,
      isAppActivelyVisible: true,
      isConnected: true,
    };
    expect(
      canRequestFocusClaim({ ...scopedReadiness, isClientReady: false, isRendererReady: true }),
    ).toBe(false);
    expect(
      canRequestFocusClaim({ ...scopedReadiness, isClientReady: true, isRendererReady: false }),
    ).toBe(false);
  });

  it("claims once per continuous pane-focus period and re-arms after blur", () => {
    const firstRequest = reconcileFocusClaim(EMPTY_FOCUS_CLAIM_STATE, {
      key: "ws:term-1",
      canRequest: true,
    });
    const sent = settleFocusClaim(firstRequest.state, { key: "ws:term-1", sent: true });
    const repeated = reconcileFocusClaim(sent, { key: "ws:term-1", canRequest: true });
    const blurred = request(sent, { key: "ws:term-1", canRequest: false });
    const refocused = reconcileFocusClaim(blurred, { key: "ws:term-1", canRequest: true });

    expect(firstRequest.shouldRequest).toBe(true);
    expect(repeated.shouldRequest).toBe(false);
    expect(refocused.shouldRequest).toBe(true);
    expect(request(sent, { key: "ws:term-2", canRequest: false })).toEqual(EMPTY_FOCUS_CLAIM_STATE);
    expect(request(sent, { key: null, canRequest: false })).toEqual(EMPTY_FOCUS_CLAIM_STATE);
  });
});
