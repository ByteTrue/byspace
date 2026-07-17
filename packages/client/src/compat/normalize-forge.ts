import { z } from "zod";
import {
  ForgeSearchItemSchema,
  type CheckoutPrStatusResponse,
  type CheckoutForgeGetCheckDetailsResponse,
  type ForgeSearchItem,
  type ForgeSearchResponse,
} from "@bytetrue/byspace-protocol/messages";

export type NormalizedForgeAuthState =
  | "authenticated"
  | "unauthenticated"
  | "cli_missing"
  | "no_remote"
  | "error";

export interface NormalizedForgeSearchPayload extends Omit<
  ForgeSearchResponse["payload"],
  "items" | "authState" | "forge"
> {
  items: ForgeSearchItem[];
  authState: NormalizedForgeAuthState;
  forge: string;
}

const SearchItemKindSchema = z.object({ kind: z.unknown() }).passthrough();

export function normalizeForgeAuthState(value: unknown): NormalizedForgeAuthState {
  switch (value) {
    case "authenticated":
    case "unauthenticated":
    case "cli_missing":
    case "no_remote":
    case "error":
      return value;
    default:
      return "error";
  }
}

export function normalizeForgeSearchPayload(
  payload: ForgeSearchResponse["payload"],
): NormalizedForgeSearchPayload {
  const items: ForgeSearchItem[] = [];
  for (const item of payload.items) {
    const shape = SearchItemKindSchema.safeParse(item);
    if (!shape.success) continue;
    const candidate =
      shape.data.kind === "pr" ? { ...shape.data, kind: "change_request" } : shape.data;
    const parsed = ForgeSearchItemSchema.safeParse(candidate);
    if (parsed.success) items.push(parsed.data);
  }

  return {
    ...payload,
    items,
    authState: normalizeForgeAuthState(payload.authState),
    forge: payload.forge || "github",
  };
}

export function normalizeCheckoutPrStatusPayload(
  payload: CheckoutPrStatusResponse["payload"],
): CheckoutPrStatusResponse["payload"] & {
  authState: NormalizedForgeAuthState;
  forge: string;
} {
  const forge = payload.forge || "github";
  const legacyAuthState = payload.githubFeaturesEnabled ? "authenticated" : "unauthenticated";
  const authState =
    payload.authState === undefined ? legacyAuthState : normalizeForgeAuthState(payload.authState);
  const status = payload.status
    ? { ...payload.status, forge: payload.status.forge || forge }
    : null;
  return {
    ...payload,
    authState,
    forge,
    status,
  };
}

export function normalizeForgeCheckDetailsPayload(
  payload: CheckoutForgeGetCheckDetailsResponse["payload"],
): CheckoutForgeGetCheckDetailsResponse["payload"] {
  const pipeline = payload.details?.pipeline;
  if (!pipeline || !payload.details) return payload;
  const stages: Array<NonNullable<typeof pipeline.stages>[number]> = [];
  for (const stage of pipeline.stages ?? []) {
    stages.push(Object.assign({}, stage, { jobs: stage.jobs ?? [] }));
  }
  return {
    ...payload,
    details: {
      ...payload.details,
      pipeline: { ...pipeline, stages },
    },
  };
}
