import { describe, expect, it } from "vitest";
import type { CheckoutPrStatusResponse } from "@bytetrue/protocol/messages";
import { normalizeCheckoutPrStatusPayload } from "./pr-status";

function payload(
  overrides: Partial<CheckoutPrStatusResponse["payload"]> = {},
): CheckoutPrStatusResponse["payload"] {
  return {
    cwd: "/repo",
    status: null,
    forge: "github",
    error: null,
    requestId: "pr-status-1",
    ...overrides,
  };
}

describe("normalizeCheckoutPrStatusPayload", () => {
  it("preserves known auth states", () => {
    expect(normalizeCheckoutPrStatusPayload(payload({ authState: "cli_missing" })).authState).toBe(
      "cli_missing",
    );
  });

  it("defaults to unauthenticated when authState is absent", () => {
    expect(normalizeCheckoutPrStatusPayload(payload()).authState).toBe("unauthenticated");
    expect(
      normalizeCheckoutPrStatusPayload(payload({ authState: "authenticated" })).authState,
    ).toBe("authenticated");
  });

  it("does not expose an unknown wire auth state to feature code", () => {
    expect(
      normalizeCheckoutPrStatusPayload(payload({ authState: "future_auth_state" })).authState,
    ).toBe("unauthenticated");
  });
});
