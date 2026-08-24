import { describe, expect, it } from "vitest";
import {
  defaultHostAppearance,
  normalizeStoredHostAppearance,
  resolveWorkspaceHostBadge,
  selectHostBadges,
} from "./appearance";

describe("host badge appearance", () => {
  it("defaults missing and legacy badge settings to automatic", () => {
    expect(defaultHostAppearance().badgeDisplay).toBe("auto");
    expect(normalizeStoredHostAppearance({ color: "none", badgeDisplay: null })).toEqual({
      color: "none",
      badgeDisplay: "auto",
    });
  });

  it("keeps automatic badges icon-only until the project disambiguates them", () => {
    const badges = selectHostBadges({
      hosts: [
        {
          serverId: "host-a",
          label: "MacBook",
          appearance: defaultHostAppearance(),
        },
      ],
      enabled: true,
    });

    expect(badges.get("host-a")).toEqual({
      serverId: "host-a",
      label: "MacBook",
      color: "none",
      showLabel: false,
      display: "auto",
    });
  });

  it.each([
    { display: "name" as const, showLabel: true },
    { display: "icon" as const, showLabel: false },
  ])("preserves explicit $display badge display", ({ display, showLabel }) => {
    const badges = selectHostBadges({
      hosts: [
        {
          serverId: "host-a",
          label: "MacBook",
          appearance: { color: "none", badgeDisplay: display },
        },
      ],
      enabled: true,
    });

    expect(badges.get("host-a")).toMatchObject({ display, showLabel });
  });

  it("preserves an explicit hidden badge display", () => {
    const badges = selectHostBadges({
      hosts: [
        {
          serverId: "host-a",
          label: "MacBook",
          appearance: { color: "none", badgeDisplay: "hidden" },
        },
      ],
      enabled: true,
    });

    expect(badges.has("host-a")).toBe(false);
  });
});

describe("resolveWorkspaceHostBadge", () => {
  const autoBadge = {
    serverId: "host-a",
    label: "MacBook",
    color: "none" as const,
    showLabel: false,
    display: "auto" as const,
  };

  const nameBadge = {
    serverId: "host-a",
    label: "MacBook",
    color: "none" as const,
    showLabel: true,
    display: "name" as const,
  };

  const iconBadge = {
    serverId: "host-a",
    label: "MacBook",
    color: "none" as const,
    showLabel: false,
    display: "icon" as const,
  };

  it("returns null when badge is null", () => {
    expect(resolveWorkspaceHostBadge({ badge: null, showAutoLabel: false })).toBeNull();
    expect(resolveWorkspaceHostBadge({ badge: null, showAutoLabel: true })).toBeNull();
  });

  it("hides automatic badge (both icon and name) when project workspaces are on a single host", () => {
    expect(resolveWorkspaceHostBadge({ badge: autoBadge, showAutoLabel: false })).toBeNull();
  });

  it("shows automatic badge with name when multiple hosts have workspaces in the same project", () => {
    expect(resolveWorkspaceHostBadge({ badge: autoBadge, showAutoLabel: true })).toEqual({
      ...autoBadge,
      showLabel: true,
    });
  });

  it("preserves explicit name badge regardless of showAutoLabel", () => {
    expect(resolveWorkspaceHostBadge({ badge: nameBadge, showAutoLabel: false })).toEqual(
      nameBadge,
    );
    expect(resolveWorkspaceHostBadge({ badge: nameBadge, showAutoLabel: true })).toEqual(nameBadge);
  });

  it("preserves explicit icon badge regardless of showAutoLabel", () => {
    expect(resolveWorkspaceHostBadge({ badge: iconBadge, showAutoLabel: false })).toEqual(
      iconBadge,
    );
    expect(resolveWorkspaceHostBadge({ badge: iconBadge, showAutoLabel: true })).toEqual(iconBadge);
  });
});
