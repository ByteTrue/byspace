import { z } from "zod";
import type {
  ProviderUsage,
  ProviderUsageBalance,
  ProviderUsageTone,
  ProviderUsageWindow,
} from "../../server/messages.js";
import type { ProviderApiFetch } from "./provider.js";

const PROVIDER_HTTP_TIMEOUT_MS = 15_000;

export const ApiNumberSchema = z.coerce.number().finite();
export const ApiNullableNumberSchema = z.preprocess(
  (value) => (value == null ? null : value),
  ApiNumberSchema.nullable(),
);
export const ApiOptionalStringSchema = z.preprocess(
  (value) => (value == null ? undefined : value),
  z.coerce.string().optional(),
);

export function fetchProviderApi(
  fetchApi: ProviderApiFetch,
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  return fetchApi(input, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(PROVIDER_HTTP_TIMEOUT_MS),
  });
}

export function unavailableUsage(provider: {
  providerId: string;
  displayName: string;
  error?: string | null;
}): ProviderUsage {
  return {
    providerId: provider.providerId,
    displayName: provider.displayName,
    status: provider.error ? "error" : "unavailable",
    planLabel: null,
    windows: [],
    balances: [],
    details: [],
    error: provider.error ?? null,
  };
}

export function windowFromUsedPct(input: {
  id: string;
  label: string;
  utilizationPct: number | null | undefined;
  resetsAt?: string | null;
  tone?: ProviderUsageWindow["tone"];
}): ProviderUsageWindow {
  const usedPct = typeof input.utilizationPct === "number" ? input.utilizationPct : null;
  const window: ProviderUsageWindow = {
    id: input.id,
    label: input.label,
    usedPct,
    remainingPct: usedPct === null ? null : Math.max(0, 100 - usedPct),
    resetsAt: input.resetsAt ?? null,
  };
  if (input.tone) {
    window.tone = input.tone;
  }
  return window;
}

export function toneFromUsedPct(usedPct: number | null | undefined): ProviderUsageTone {
  if (typeof usedPct !== "number") return "default";
  if (usedPct > 90) return "danger";
  if (usedPct >= 70) return "warning";
  return "ok";
}

export function balanceToneFromRemaining(
  remaining: number | null | undefined,
): ProviderUsageBalance["tone"] {
  if (typeof remaining !== "number") return "default";
  if (remaining <= 0) return "danger";
  return "ok";
}

export function usedPctOf(
  used: number | null | undefined,
  limit: number | null | undefined,
): number | null {
  if (typeof used !== "number" || typeof limit !== "number" || limit <= 0) return null;
  return (used / limit) * 100;
}

export function toIsoStringOrNull(timestampMs: number): string | null {
  const date = new Date(timestampMs);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
