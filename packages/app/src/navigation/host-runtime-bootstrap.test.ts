import { describe, expect, it } from "vitest";
import {
  resolveHostIndexRoute,
  resolveStartupRoute,
  shouldRunStartupGiveUpTimer,
  startHostRuntimeBootstrap,
  bindHostRuntimeAppState,
} from "./host-runtime-bootstrap";

describe("startHostRuntimeBootstrap", () => {
  it("boots the host registry", async () => {
    const events: string[] = [];
    const store = {
      boot: async () => {
        events.push("boot");
      },
    };

    startHostRuntimeBootstrap({ store });
    await Promise.resolve();

    expect(events).toEqual(["boot"]);
  });
});

describe("startup give-up timer", () => {
  it("runs while no host is online and we have not given up", () => {
    expect(
      shouldRunStartupGiveUpTimer({
        anyOnlineHostServerId: null,
        hasGivenUpWaitingForHost: false,
      }),
    ).toBe(true);
  });

  it("does not run once a host is online", () => {
    expect(
      shouldRunStartupGiveUpTimer({
        anyOnlineHostServerId: "srv_online",
        hasGivenUpWaitingForHost: false,
      }),
    ).toBe(false);
  });

  it("does not run again after giving up", () => {
    expect(
      shouldRunStartupGiveUpTimer({
        anyOnlineHostServerId: null,
        hasGivenUpWaitingForHost: true,
      }),
    ).toBe(false);
  });
});

describe("resolveStartupRoute", () => {
  const baseIndexInput = {
    route: { kind: "index" as const, pathname: "/" },
    hostRegistryStatus: "ready" as const,
    hosts: [],
    anyOnlineHostServerId: null,
    workspaceSelection: null,
    workspaceSelectionStatus: "unknown" as const,
    isWorkspaceSelectionLoaded: true,
    hasGivenUpWaitingForHost: false,
  };
  const baseHostInput = {
    route: { kind: "host" as const, serverId: "server-saved" },
    hostRegistryStatus: "ready" as const,
    hosts: [],
  };

  it("renders non-index routes instead of making an index startup decision", () => {
    expect(
      resolveStartupRoute({
        ...baseIndexInput,
        route: { kind: "index", pathname: "/settings" },
      }),
    ).toEqual({ kind: "render" });
  });

  it("keeps startup on the splash while the persisted workspace selection is loading", () => {
    expect(
      resolveStartupRoute({
        ...baseIndexInput,
        anyOnlineHostServerId: "server-1",
        isWorkspaceSelectionLoaded: false,
      }),
    ).toEqual({ kind: "splash" });
  });

  it("keeps startup on the splash while the host registry is loading", () => {
    expect(
      resolveStartupRoute({
        ...baseIndexInput,
        hostRegistryStatus: "loading",
      }),
    ).toEqual({ kind: "splash" });
  });

  it("does not treat loading hosts as an empty registry when a workspace is already restored", () => {
    expect(
      resolveStartupRoute({
        ...baseIndexInput,
        hostRegistryStatus: "loading",
        workspaceSelection: { serverId: "server-1", workspaceId: "workspace-a" },
        hasGivenUpWaitingForHost: true,
      }),
    ).toEqual({ kind: "splash" });
  });

  it("enters the host boundary for saved workspace restore after the host registry proves the host exists", () => {
    expect(
      resolveStartupRoute({
        ...baseIndexInput,
        hosts: [{ serverId: "server-1" }],
        workspaceSelection: { serverId: "server-1", workspaceId: "workspace-a" },
        workspaceSelectionStatus: "exists",
      }),
    ).toEqual({ kind: "redirect", href: "/h/server-1" });
  });

  it("restores the last workspace host even when a different host is already online", () => {
    expect(
      resolveStartupRoute({
        ...baseIndexInput,
        hosts: [{ serverId: "server-offline" }, { serverId: "server-online" }],
        anyOnlineHostServerId: "server-online",
        workspaceSelection: { serverId: "server-offline", workspaceId: "workspace-a" },
        workspaceSelectionStatus: "unknown",
      }),
    ).toEqual({ kind: "redirect", href: "/h/server-offline" });
  });

  it("does not restore a saved workspace after workspace hydration proves it is missing", () => {
    expect(
      resolveStartupRoute({
        ...baseIndexInput,
        hosts: [{ serverId: "server-1" }],
        workspaceSelection: { serverId: "server-1", workspaceId: "workspace-a" },
        workspaceSelectionStatus: "missing",
      }),
    ).toEqual({ kind: "redirect", href: "/h/server-1" });
  });

  it("falls back to a saved host when the restored workspace host is no longer saved", () => {
    expect(
      resolveStartupRoute({
        ...baseIndexInput,
        workspaceSelection: { serverId: "server-saved", workspaceId: "workspace-a" },
        hosts: [{ serverId: "server-next" }],
        hasGivenUpWaitingForHost: true,
      }),
    ).toEqual({ kind: "redirect", href: "/h/server-next" });
  });

  it("redirects to the online host when no saved workspace is selected", () => {
    expect(
      resolveStartupRoute({
        ...baseIndexInput,
        anyOnlineHostServerId: "srv-desktop",
      }),
    ).toEqual({ kind: "redirect", href: "/h/srv-desktop" });
  });

  it("keeps a known connecting host in app-owned routing instead of showing welcome", () => {
    expect(
      resolveStartupRoute({
        ...baseIndexInput,
        hosts: [{ serverId: "server-saved" }],
        hasGivenUpWaitingForHost: true,
      }),
    ).toEqual({ kind: "redirect", href: "/h/server-saved" });
  });

  it("shows welcome after root startup gives up and no host exists", () => {
    expect(
      resolveStartupRoute({
        ...baseIndexInput,
        hasGivenUpWaitingForHost: true,
      }),
    ).toEqual({ kind: "redirect", href: "/welcome" });
  });

  it("keeps host routes mounted while the host registry is loading", () => {
    expect(
      resolveStartupRoute({
        ...baseHostInput,
        hostRegistryStatus: "loading",
      }),
    ).toEqual({ kind: "render" });
  });

  it("renders a host route once the route host is known", () => {
    expect(
      resolveStartupRoute({
        ...baseHostInput,
        hosts: [{ serverId: "server-saved" }],
      }),
    ).toEqual({ kind: "render" });
  });

  it("sends removed host routes to global project selection instead of welcome", () => {
    expect(
      resolveStartupRoute({
        ...baseHostInput,
        route: { kind: "host", serverId: "server-removed" },
        hosts: [{ serverId: "server-next" }],
      }),
    ).toEqual({ kind: "redirect", href: "/open-project" });
  });

  it("shows welcome from a host route only after the registry proves no hosts exist", () => {
    expect(
      resolveStartupRoute({
        ...baseHostInput,
        route: { kind: "host", serverId: "server-removed" },
      }),
    ).toEqual({ kind: "redirect", href: "/welcome" });
  });
});

describe("resolveHostIndexRoute", () => {
  it("restores the remembered workspace when the host index opens for the same host", () => {
    expect(
      resolveHostIndexRoute({
        serverId: "server-saved",
        workspaceSelection: { serverId: "server-saved", workspaceId: "workspace-a" },
        workspaceSelectionStatus: "exists",
      }),
    ).toEqual("/h/server-saved/workspace/workspace-a");
  });

  it("keeps restoring a remembered workspace before the host workspace list hydrates", () => {
    expect(
      resolveHostIndexRoute({
        serverId: "server-saved",
        workspaceSelection: { serverId: "server-saved", workspaceId: "workspace-a" },
        workspaceSelectionStatus: "unknown",
      }),
    ).toEqual("/h/server-saved/workspace/workspace-a");
  });

  it("opens global project selection when the remembered workspace is proven missing", () => {
    expect(
      resolveHostIndexRoute({
        serverId: "server-saved",
        workspaceSelection: { serverId: "server-saved", workspaceId: "workspace-a" },
        workspaceSelectionStatus: "missing",
      }),
    ).toEqual("/open-project");
  });

  it("opens global project selection when the remembered workspace belongs to another host", () => {
    expect(
      resolveHostIndexRoute({
        serverId: "server-saved",
        workspaceSelection: { serverId: "server-other", workspaceId: "workspace-a" },
        workspaceSelectionStatus: "exists",
      }),
    ).toEqual("/open-project");
  });

  it("opens global project selection when no workspace is remembered", () => {
    expect(
      resolveHostIndexRoute({
        serverId: "server-saved",
        workspaceSelection: null,
        workspaceSelectionStatus: "unknown",
      }),
    ).toEqual("/open-project");
  });
});

describe("host runtime app lifecycle", () => {
  it.each(["inactive", "background"] as const)(
    "applies initial visibility and forwards lifecycle changes when mounted %s",
    (currentState) => {
      const visibility: boolean[] = [];
      let listener: ((state: "active" | "inactive" | "background") => void) | undefined;
      let subscribed = true;
      const dispose = bindHostRuntimeAppState(
        { setAppVisible: (visible) => visibility.push(visible) },
        {
          currentState,
          addEventListener: (_event, handler) => {
            listener = handler;
            return {
              remove: () => {
                subscribed = false;
              },
            };
          },
        },
      );
      expect(visibility).toEqual([false]);
      listener?.("active");
      listener?.("inactive");
      listener?.("background");
      listener?.("active");
      expect(visibility).toEqual([false, true, false, false, true]);
      dispose();
      expect(subscribed).toBe(false);
    },
  );
});
