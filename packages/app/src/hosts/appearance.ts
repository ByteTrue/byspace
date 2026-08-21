import { IDENTITY_COLOR_NAMES, type IdentityColorName } from "@/styles/identity-colors";
import type { HostProfile } from "@/types/host-connection";
import { z } from "zod";

export type HostColor = "none" | IdentityColorName;
export const HOST_COLORS: readonly HostColor[] = ["none", ...IDENTITY_COLOR_NAMES];

export type HostBadgeDisplay = "auto" | "name" | "icon" | "hidden";
export const HOST_BADGE_DISPLAYS: readonly HostBadgeDisplay[] = ["auto", "name", "icon", "hidden"];

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
  return result.success ? result.data : defaultHostAppearance();
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

type HostAppearanceSource = Pick<HostProfile, "serverId" | "label" | "appearance">;

export function selectHostBadges(input: {
  hosts: readonly HostAppearanceSource[];
  enabled: boolean;
}): ReadonlyMap<string, HostBadgeModel> {
  const badges = new Map<string, HostBadgeModel>();
  if (!input.enabled) return badges;

  for (const host of input.hosts) {
    const display = resolveHostBadgeDisplay({ appearance: host.appearance });
    if (display === "hidden") continue;
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
