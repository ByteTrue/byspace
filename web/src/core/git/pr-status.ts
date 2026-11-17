import type { CheckoutPrStatusResponse, ForgeAuthState } from "@bytetrue/protocol/messages";
import { parseForgeAuthState } from "@/git/forge";

type WireCheckoutPrStatusPayload = CheckoutPrStatusResponse["payload"];

export type CheckoutPrStatusPayload = Omit<WireCheckoutPrStatusPayload, "authState"> & {
  authState: ForgeAuthState;
};

export function normalizeCheckoutPrStatusPayload(
  payload: WireCheckoutPrStatusPayload,
): CheckoutPrStatusPayload {
  return {
    ...payload,
    authState: parseForgeAuthState(payload.authState) ?? "unauthenticated",
  };
}
