import type { CheckoutPrStatusResponse } from "@bytetrue/byspace-protocol/messages";
import {
  normalizeCheckoutPrStatusPayload as normalizeCheckoutPrStatusCompatPayload,
  type NormalizedForgeAuthState,
} from "@bytetrue/byspace-client/internal/compat/normalize-forge";

type WireCheckoutPrStatusPayload = CheckoutPrStatusResponse["payload"];

export type CheckoutPrStatusPayload = Omit<WireCheckoutPrStatusPayload, "authState" | "forge"> & {
  authState: NormalizedForgeAuthState;
  forge: string;
};

export function normalizeCheckoutPrStatusPayload(
  payload: WireCheckoutPrStatusPayload,
): CheckoutPrStatusPayload {
  return normalizeCheckoutPrStatusCompatPayload(payload);
}
