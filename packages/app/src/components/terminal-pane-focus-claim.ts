export interface FocusClaimState {
  claimedKey: string | null;
  requestedKey: string | null;
}

export interface FocusClaimStep {
  state: FocusClaimState;
  shouldRequest: boolean;
}

interface FocusClaimReadiness {
  isWorkspaceFocused: boolean;
  isAppVisible: boolean;
  isClientReady: boolean;
  isConnected: boolean;
  isRendererReady: boolean;
}

export const EMPTY_FOCUS_CLAIM_STATE: FocusClaimState = {
  claimedKey: null,
  requestedKey: null,
};

export function canRequestFocusClaim(input: FocusClaimReadiness): boolean {
  return (
    input.isWorkspaceFocused &&
    input.isAppVisible &&
    input.isClientReady &&
    input.isConnected &&
    input.isRendererReady
  );
}

/**
 * Whether a measured size has to reach the PTY.
 *
 * A passive refit (the post-mount fit ladder, font metrics settling, the WebGL renderer swap
 * with its own cell dimensions, a window visibility restore) must not take the PTY away from
 * another client, so it arrives with `shouldClaim: false`. But once this client has claimed a
 * size, those refits are the only thing that knows our columns moved: dropping them leaves the
 * PTY — and therefore everything the app paints — narrower or wider than what we render, until
 * some input re-claims.
 */
export function shouldSendTerminalResize(input: {
  shouldClaim: boolean;
  hasClaimedSize: boolean;
}): boolean {
  return input.shouldClaim || input.hasClaimedSize;
}

export function reconcileFocusClaim(
  state: FocusClaimState,
  input: { key: string | null; canRequest: boolean },
): FocusClaimStep {
  if (input.key === null) {
    return { state: EMPTY_FOCUS_CLAIM_STATE, shouldRequest: false };
  }
  if (state.claimedKey === input.key) {
    return {
      state: { claimedKey: input.key, requestedKey: null },
      shouldRequest: false,
    };
  }
  if (!input.canRequest) {
    return {
      state: { claimedKey: state.claimedKey, requestedKey: null },
      shouldRequest: false,
    };
  }
  if (state.requestedKey === input.key) {
    return { state, shouldRequest: false };
  }
  return {
    state: { claimedKey: state.claimedKey, requestedKey: input.key },
    shouldRequest: true,
  };
}

export function settleFocusClaim(
  state: FocusClaimState,
  input: { key: string; sent: boolean },
): FocusClaimState {
  if (state.requestedKey !== input.key) {
    return state;
  }
  return {
    claimedKey: input.sent ? input.key : state.claimedKey,
    requestedKey: null,
  };
}
