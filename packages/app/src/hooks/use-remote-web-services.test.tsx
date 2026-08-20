/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import React, { type PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRemoteWebServices } from "./use-remote-web-services";

const SERVICE = {
  id: "c946926a-e4f2-4a1e-ab92-94ad52bbf3e3",
  name: "home-web",
  hostname: "home-web.remote.localhost",
  target: {
    serverId: "target",
    label: "Target",
    port: 5173,
    daemonPublicKeyB64: "target-key",
  },
  createdAt: "2026-08-20T00:00:00.000Z",
};

const mocks = vi.hoisted(() => ({
  grant: vi.fn(),
  statuses: new Map<string, string>(),
  query: {
    data: [] as (typeof SERVICE)[],
    error: null as Error | null,
    isLoading: false,
  },
}));

vi.mock("@/data/query", () => ({
  useFetchQuery: () => mocks.query,
}));

vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getClient: (serverId: string) =>
      serverId === "target" ? { grantRemoteWebService: mocks.grant } : null,
  }),
  useHostRuntimeClient: () => ({}),
  useHostRuntimeConnectionStatuses: () => mocks.statuses,
  useHostRuntimeIsConnected: () => true,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useRemoteWebServices authorization reconciliation", () => {
  beforeEach(() => {
    mocks.grant.mockReset().mockResolvedValue({});
    mocks.statuses = new Map([["target", "online"]]);
    mocks.query.data = [SERVICE];
    mocks.query.error = null;
    mocks.query.isLoading = false;
  });

  afterEach(cleanup);

  it("repairs a missing target grant for every persisted source mapping", async () => {
    renderHook(() => useRemoteWebServices("source", true, "source-key"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mocks.grant).toHaveBeenCalledWith({
        serviceId: SERVICE.id,
        sourceDaemonPublicKeyB64: "source-key",
        targetPort: 5173,
      });
    });
  });

  it("waits until the target host is online before repairing its grant", async () => {
    mocks.statuses = new Map([["target", "offline"]]);
    const { rerender } = renderHook(() => useRemoteWebServices("source", true, "source-key"), {
      wrapper: createWrapper(),
    });
    expect(mocks.grant).not.toHaveBeenCalled();

    mocks.statuses = new Map([["target", "online"]]);
    rerender();

    await waitFor(() => expect(mocks.grant).toHaveBeenCalledOnce());
  });

  it("surfaces a reconciliation failure without hiding the mapping", async () => {
    mocks.grant.mockResolvedValue({ error: "denied" });
    const { result } = renderHook(() => useRemoteWebServices("source", true, "source-key"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).toBe(
        "settings.host.remoteWebServices.authorizationRepairFailed",
      );
    });
    expect(result.current.services).toEqual([SERVICE]);
  });
});
