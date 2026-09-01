import { IDENTITY_COLOR_NAMES, type IdentityColorName } from "@/styles/identity-colors";
import type { HostProfile } from "@/types/host-connection";
import { z } from "zod";

export type HostColor = "none" | IdentityColorName;

export const HOST_COLORS: readonly HostColor[] = ["none", ...IDENTITY_COLOR_NAMES];

export type HostBadgeDisplay = "auto" | "name" | "icon" | "hidden";

export const HOST_BADGE_DISPLAYS: readonly HostBadgeDisplay[] = ["auto", "name", "icon", "hidden"];

/**
 * Per-device host presentation. `null` is accepted in stored data for compatibility with
 * registries written before the automatic project-scoped default existed; callers resolve it as
 * `auto`.
 */
export interface HostAppearance {
  color: HostColor;
  badgeDisplay: HostBadgeDisplay | null;
}

export const HostAppearanceSchema: z.ZodType<HostAppearance> = z.strictObject({
  color: z.enum(["none", ...IDENTITY_COLOR_NAMES]),
  badgeDisplay: z.enum(["auto", "name", "icon", "hidden"]).nullable(),
});

export function defaultHostAppearance(): HostAppearance {
  return { color: "none", badgeDisplay: "auto" };
}

export function normalizeStoredHostAppearance(value: unknown): HostAppearance {
  const result = HostAppearanceSchema.safeParse(value);
  if (!result.success) {
    return defaultHostAppearance();
  }
  return { ...result.data, badgeDisplay: result.data.badgeDisplay ?? "auto" };
}

export function resolveHostBadgeDisplay(input: { appearance: HostAppearance }): HostBadgeDisplay {
  return input.appearance.badgeDisplay ?? "auto";
}

export interface HostBadgeModel {
  serverId: string;
  label: string;
  color: HostColor;
  showLabel: boolean;
  display: HostBadgeDisplay;
}

export type HostAppearanceSource = Pick<HostProfile, "serverId" | "label" | "appearance">;

/**
 * A non-project surface cannot apply project cardinality. Preserve the previous default there:
 * hide the local desktop host, name every resolved remote host, and wait while local detection is
 * pending. Explicit choices remain authoritative.
 */
export function resolveHostBadgeWithoutProjectContext(input: {
  badge: HostBadgeModel | null;
  isLocalHost: boolean;
  localHostResolutionPending: boolean;
}): HostBadgeModel | null {
  if (!input.badge || input.badge.display !== "auto") {
    return input.badge;
  }
  if (input.localHostResolutionPending || input.isLocalHost) {
    return null;
  }
  return { ...input.badge, showLabel: true };
}

/**
 * Selects each host's explicit presentation for the sidebar. Automatic visibility is resolved
 * later against the project that owns a workspace; a host that should show no badge is absent
 * only when the user explicitly chose `hidden`.
 */
export function selectHostBadges(input: {
  hosts: readonly HostAppearanceSource[];
  enabled: boolean;
}): ReadonlyMap<string, HostBadgeModel> {
  const badges = new Map<string, HostBadgeModel>();
  if (!input.enabled) {
    return badges;
  }
  for (const host of input.hosts) {
    const display = resolveHostBadgeDisplay({ appearance: host.appearance });
    if (display === "hidden") {
      continue;
    }
    badges.set(host.serverId, {
      serverId: host.serverId,
      label: host.label.trim() || host.serverId,
      color: host.appearance.color,
      showLabel: display === "name",
      display,
    });
  }
  return badges;
}
