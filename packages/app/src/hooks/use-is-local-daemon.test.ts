import { afterEach, describe, expect, it, vi } from "vitest";

// The hook module imports @/runtime/host-runtime, whose import chain pulls in
// expo-constants and crashes under vitest (__DEV__ undefined). The tests here
// target the pure resolvers, so the runtime layer is stubbed out.
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [],
  useHostRegistryLoaded: () => true,
}));

import {
  browserOriginHost,
  isLoopbackEndpoint,
  resolveLocalDaemonServerId,
} from "./use-is-local-daemon";
import type { HostProfile } from "@/types/host-connection";

function hostWith(serverId: string, endpoint: string): HostProfile {
  return {
    serverId,
    label: serverId,
    appearance: { color: "none", badgeDisplay: null },
    lifecycle: {},
    connections: [{ id: `${serverId}-conn`, type: "directTcp", endpoint, useTls: false }],
    preferredConnectionId: null,
    createdAt: "",
    updatedAt: "",
  };
}

interface WindowStub {
  window?: { location?: Partial<Location> } | undefined;
}

const globalWithWindow = globalThis as unknown as WindowStub;
const originalWindow = globalWithWindow.window;

function setLocation(location: Partial<Location>): void {
  globalWithWindow.window = { location };
}

afterEach(() => {
  globalWithWindow.window = originalWindow;
  vi.restoreAllMocks();
});

describe("browserOriginHost", () => {
  it("returns null when window is unavailable", () => {
    delete globalWithWindow.window;
    expect(browserOriginHost()).toBeNull();
  });

  it("passes through origins with an explicit port", () => {
    setLocation({ host: "localhost:8081", port: "8081", protocol: "http:" });
    expect(browserOriginHost()).toBe("localhost:8081");
  });

  it("re-attaches the default https port that location.host omits", () => {
    setLocation({ host: "app.byspace.cc.cd", port: "", protocol: "https:" });
    expect(browserOriginHost()).toBe("app.byspace.cc.cd:443");
  });

  it("re-attaches the default http port that location.host omits", () => {
    setLocation({ host: "app.byspace.cc.cd", port: "", protocol: "http:" });
    expect(browserOriginHost()).toBe("app.byspace.cc.cd:80");
  });

  it("normalizes loopback hosts", () => {
    setLocation({ host: "127.0.0.1:6777", port: "6777", protocol: "http:" });
    expect(browserOriginHost()).toBe("localhost:6777");
  });
});

describe("resolveLocalDaemonServerId", () => {
  it("resolves the host whose directTcp endpoint is loopback", () => {
    const hosts = [hostWith("mac", "192.168.1.103:6777"), hostWith("desktop", "localhost:6777")];
    expect(resolveLocalDaemonServerId(hosts)).toBe("desktop");
  });

  it("returns null when no host has a loopback endpoint", () => {
    expect(resolveLocalDaemonServerId([hostWith("mac", "192.168.1.103:6777")])).toBeNull();
  });

  it("matches 127.0.0.1 spellings", () => {
    expect(resolveLocalDaemonServerId([hostWith("desktop", "127.0.0.1:6777")])).toBe("desktop");
  });

  it("ignores relay-only hosts", () => {
    const hosts: HostProfile[] = [
      {
        serverId: "mac",
        label: "mac",
        appearance: { color: "none", badgeDisplay: null },
        lifecycle: {},
        connections: [
          {
            id: "relay",
            type: "relay",
            relayEndpoint: "relay.byspace.cc.cd:443",
            useTls: true,
            daemonPublicKeyB64: "abc",
          },
        ],
        preferredConnectionId: null,
        createdAt: "",
        updatedAt: "",
      },
    ];
    expect(resolveLocalDaemonServerId(hosts)).toBeNull();
  });
});
it("matches loopback literals across spellings", () => {
  expect(isLoopbackEndpoint("localhost:6777")).toBe(true);
  expect(isLoopbackEndpoint("LocalHost:6777")).toBe(true);
  expect(isLoopbackEndpoint("127.0.0.1:6777")).toBe(true);
  expect(isLoopbackEndpoint("0.0.0.0:6777")).toBe(true);
  expect(isLoopbackEndpoint("[::1]:6777")).toBe(true);
  expect(isLoopbackEndpoint("[::]:6777")).toBe(true);
});

it("does not match LAN, cloud, or relay endpoints", () => {
  expect(isLoopbackEndpoint("192.168.1.103:6777")).toBe(false);
  expect(isLoopbackEndpoint("10.0.0.8:6777")).toBe(false);
  expect(isLoopbackEndpoint("DESKTOP-BYTE.local:6777")).toBe(false);
  expect(isLoopbackEndpoint("relay.byspace.cc.cd:443")).toBe(false);
  expect(isLoopbackEndpoint("app.byspace.cc.cd:443")).toBe(false);
});

it("does not throw on socket/pipe or malformed endpoints", () => {
  expect(isLoopbackEndpoint("")).toBe(false);
  expect(isLoopbackEndpoint("/tmp/byspace.sock")).toBe(false);
  expect(isLoopbackEndpoint("localhost")).toBe(false);
  expect(isLoopbackEndpoint("localhost:99999")).toBe(false);
  expect(isLoopbackEndpoint("[::1:6777")).toBe(false);
});
