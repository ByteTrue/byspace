import { describe, expect, it } from "vitest";
import {
  type HostAppearanceSource,
  defaultHostAppearance,
  normalizeStoredHostAppearance,
  resolveHostBadgeDisplay,
  resolveHostBadgeWithoutProjectContext,
  selectHostBadges,
} from "@/hosts/appearance";

function host(
  serverId: string,
  label: string,
  appearance = defaultHostAppearance(),
): HostAppearanceSource {
  return { serverId, label, appearance };
}

describe("normalizeStoredHostAppearance", () => {
  it("defaults new and legacy stored values to automatic display", () => {
    const expected = { color: "none", badgeDisplay: "auto" };
    expect(defaultHostAppearance()).toEqual(expected);
    expect(normalizeStoredHostAppearance(undefined)).toEqual(expected);
    expect(normalizeStoredHostAppearance(null)).toEqual(expected);
    expect(normalizeStoredHostAppearance("x")).toEqual(expected);
    expect(normalizeStoredHostAppearance({})).toEqual(expected);
    expect(normalizeStoredHostAppearance({ color: "chartreuse" })).toEqual(expected);
    expect(normalizeStoredHostAppearance({ badgeDisplay: "loud" })).toEqual(expected);
  });

  it("normalizes a legacy null display without dropping its color", () => {
    expect(normalizeStoredHostAppearance({ color: "teal", badgeDisplay: null })).toEqual({
      color: "teal",
      badgeDisplay: "auto",
    });
  });

  it("round-trips a value the user actually chose", () => {
    expect(normalizeStoredHostAppearance({ color: "teal", badgeDisplay: "icon" })).toEqual({
      color: "teal",
      badgeDisplay: "icon",
    });
  });
});

describe("resolveHostBadgeDisplay", () => {
  it("resolves a new or legacy-null appearance to automatic display", () => {
    expect(resolveHostBadgeDisplay({ appearance: defaultHostAppearance() })).toBe("auto");
    expect(resolveHostBadgeDisplay({ appearance: { color: "teal", badgeDisplay: null } })).toBe(
      "auto",
    );
  });

  it.each(["name", "icon", "hidden"] as const)("preserves an explicit %s choice", (display) => {
    expect(resolveHostBadgeDisplay({ appearance: { color: "none", badgeDisplay: display } })).toBe(
      display,
    );
  });
});

describe("resolveHostBadgeWithoutProjectContext", () => {
  const autoBadge = {
    serverId: "alpha",
    label: "Alpha",
    color: "none",
    showLabel: false,
    display: "auto",
  } as const;

  it("preserves the previous local and remote defaults outside project rows", () => {
    expect(
      resolveHostBadgeWithoutProjectContext({
        badge: autoBadge,
        isLocalHost: false,
        localHostResolutionPending: true,
      }),
    ).toBeNull();
    expect(
      resolveHostBadgeWithoutProjectContext({
        badge: autoBadge,
        isLocalHost: true,
        localHostResolutionPending: false,
      }),
    ).toBeNull();
    expect(
      resolveHostBadgeWithoutProjectContext({
        badge: autoBadge,
        isLocalHost: false,
        localHostResolutionPending: false,
      }),
    ).toEqual({ ...autoBadge, showLabel: true });
  });

  it("keeps explicit choices authoritative", () => {
    const explicitIcon = { ...autoBadge, display: "icon" } as const;
    expect(
      resolveHostBadgeWithoutProjectContext({
        badge: explicitIcon,
        isLocalHost: true,
        localHostResolutionPending: true,
      }),
    ).toBe(explicitIcon);
  });
});

describe("selectHostBadges", () => {
  it("returns no badges when the global sidebar item is disabled", () => {
    const badges = selectHostBadges({
      hosts: [host("alpha", "Alpha"), host("beta", "Beta")],
      enabled: false,
    });
    expect(badges.size).toBe(0);
  });

  it("keeps an automatic host in the map for project-level resolution", () => {
    const badges = selectHostBadges({
      hosts: [host("alpha", "Alpha")],
      enabled: true,
    });
    expect(badges.get("alpha")).toEqual({
      serverId: "alpha",
      label: "Alpha",
      color: "none",
      showLabel: false,
      display: "auto",
    });
  });

  it("omits a host the user hid and keeps its sibling", () => {
    const badges = selectHostBadges({
      hosts: [
        host("alpha", "Alpha", { color: "none", badgeDisplay: "hidden" }),
        host("beta", "Beta", { color: "none", badgeDisplay: "name" }),
      ],
      enabled: true,
    });
    expect(badges.has("alpha")).toBe(false);
    expect(badges.get("beta")).toEqual({
      serverId: "beta",
      label: "Beta",
      color: "none",
      showLabel: true,
      display: "name",
    });
  });

  it("keeps an icon-only host in the map without its label", () => {
    const badges = selectHostBadges({
      hosts: [host("alpha", "Alpha", { color: "teal", badgeDisplay: "icon" })],
      enabled: true,
    });
    expect(badges.get("alpha")).toEqual({
      serverId: "alpha",
      label: "Alpha",
      color: "teal",
      showLabel: false,
      display: "icon",
    });
  });

  it("falls back to the server id when the label is blank", () => {
    const badges = selectHostBadges({
      hosts: [host("alpha", "   ")],
      enabled: true,
    });
    expect(badges.get("alpha")?.label).toBe("alpha");
  });
});
