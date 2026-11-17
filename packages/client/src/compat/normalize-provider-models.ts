import { expandProviderSnapshot } from "@bytetrue/protocol/provider-snapshot-codec";
import type {
  GetProvidersSnapshotResponseMessage,
  SessionOutboundMessage,
} from "@bytetrue/protocol/messages";

type GetProvidersSnapshotPayload = GetProvidersSnapshotResponseMessage["payload"];
type ProvidersSnapshotUpdatePayload = Extract<
  SessionOutboundMessage,
  { type: "providers_snapshot_update" }
>["payload"];

// Expands a compact snapshot and merges per-provider fetchedAt freshness. The daemon normalizes
// models at source, so entries pass through untouched when there is no compact form.
export function normalizeProvidersSnapshotPayload<
  T extends GetProvidersSnapshotPayload | ProvidersSnapshotUpdatePayload,
>(payload: T, expand = true): T {
  if (payload.compactSnapshot && !expand) return payload;
  const decoded = payload.compactSnapshot
    ? expandProviderSnapshot(payload.compactSnapshot)
    : payload.entries;
  const freshness = payload.fetchedAt;
  const entries =
    freshness && expand
      ? decoded.map((entry) =>
          freshness[entry.provider] ? { ...entry, fetchedAt: freshness[entry.provider] } : entry,
        )
      : decoded;
  return entries === payload.entries ? payload : { ...payload, entries };
}

export function normalizeProviderSnapshotUpdateMessage(
  msg: SessionOutboundMessage,
  expand = true,
): SessionOutboundMessage {
  if (msg.type !== "providers_snapshot_update") {
    return msg;
  }

  return { ...msg, payload: normalizeProvidersSnapshotPayload(msg.payload, expand) };
}
