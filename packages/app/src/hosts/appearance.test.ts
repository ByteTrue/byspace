import { describe, expect, it } from "vitest";
import {
  defaultHostAppearance,
  normalizeStoredHostAppearance,
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
