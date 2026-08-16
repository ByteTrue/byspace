import { IDENTITY_COLOR_NAMES, type IdentityColorName } from "@/styles/identity-colors";
import type { HostProfile } from "@/types/host-connection";

export type HostColor = "none" | IdentityColorName;
export const HOST_COLORS: readonly HostColor[] = ["none", ...IDENTITY_COLOR_NAMES];

export type HostBadgeDisplay = "auto" | "name" | "icon" | "hidden";
export const HOST_BADGE_DISPLAYS: readonly HostBadgeDisplay[] = ["auto", "name", "icon", "hidden"];

export interface HostAppearance {
  color: HostColor;
  badgeDisplay: HostBadgeDisplay | null;
}

export function defaultHostAppearance(): HostAppearance {
  return { color: "none", badgeDisplay: "auto" };
}

function isHostColor(value: unknown): value is HostColor {
  return HOST_COLORS.some((color) => color === value);
}

function isHostBadgeDisplay(value: unknown): value is HostBadgeDisplay {
  return HOST_BADGE_DISPLAYS.some((display) => display === value);
}

export function normalizeStoredHostAppearance(value: unknown): HostAppearance {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultHostAppearance();
  }
  const record = value as Record<string, unknown>;
  return {
    color: isHostColor(record.color) ? record.color : "none",
    badgeDisplay: isHostBadgeDisplay(record.badgeDisplay) ? record.badgeDisplay : "auto",
  };
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
