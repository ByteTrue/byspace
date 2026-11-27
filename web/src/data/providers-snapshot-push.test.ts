import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { expect, it } from "vitest";
import type { SessionOutboundMessage } from "@bytetrue/protocol/messages";
import { providersSnapshotQueryKey } from "@/data/providers-snapshot";
import { applyProvidersSnapshotUpdate } from "@/data/push-router";

it("refetches active workspace snapshots after a home catalog update", async () => {
  const queryClient = new QueryClient();
  const client: Parameters<typeof applyProvidersSnapshotUpdate>[0]["client"] = {
    async getProvidersSnapshot() {
      throw new Error("Unexpected snapshot pull");
    },
  };
  const serverId = "server-1";
  const projectKey = providersSnapshotQueryKey(serverId, "/repo");
  const previous = {
    requestId: "project-old",
    entries: [{ provider: "pi", status: "ready", enabled: true, models: [{ id: "old" }] }],
    generatedAt: "2026-01-01T00:00:00.000Z",
  };
  const refreshed = {
    requestId: "project-refreshed",
    entries: [
      {
        provider: "pi",
        status: "ready",
        enabled: true,
        models: [{ id: "old" }, { id: "new" }],
      },
    ],
    generatedAt: "2026-01-01T00:01:00.000Z",
  };
  queryClient.setQueryData(projectKey, previous);
  const observer = new QueryObserver(queryClient, {
    queryKey: projectKey,
    queryFn: async () => refreshed,
    enabled: true,
    gcTime: Infinity,
    staleTime: Infinity,
  });
  const unsubscribeObserver = observer.subscribe(() => undefined);
  const message: Extract<SessionOutboundMessage, { type: "providers_snapshot_update" }> = {
    type: "providers_snapshot_update",
    payload: {
      entries: [{ provider: "codex", status: "ready", enabled: true, models: [] }],
      generatedAt: "2026-01-01T00:01:00.000Z",
    },
  };

  try {
    await applyProvidersSnapshotUpdate({ client, queryClient, serverId, message });
    await expect.poll(() => queryClient.getQueryData(projectKey)).toEqual(refreshed);
  } finally {
    unsubscribeObserver();
    queryClient.clear();
  }
});

it("drops inactive workspace snapshots so returning to the project fetches fresh data", async () => {
  const queryClient = new QueryClient();
  const client: Parameters<typeof applyProvidersSnapshotUpdate>[0]["client"] = {
    async getProvidersSnapshot() {
      throw new Error("Unexpected snapshot pull");
    },
  };
  const serverId = "server-1";
  const projectKey = providersSnapshotQueryKey(serverId, "/repo");
  const previous = {
    requestId: "project-old",
    entries: [{ provider: "pi", status: "ready", enabled: true, models: [{ id: "old" }] }],
    generatedAt: "2026-01-01T00:00:00.000Z",
  };
  const refreshed = {
    requestId: "project-refreshed",
    entries: [{ provider: "pi", status: "ready", enabled: true, models: [{ id: "new" }] }],
    generatedAt: "2026-01-01T00:01:00.000Z",
  };
  queryClient.setQueryData(projectKey, previous);
  const observer = new QueryObserver(queryClient, {
    queryKey: projectKey,
    queryFn: async () => previous,
    enabled: true,
    gcTime: Infinity,
    staleTime: Infinity,
    refetchOnMount: false,
  });
  const unsubscribeObserver = observer.subscribe(() => undefined);
  unsubscribeObserver();
  const message: Extract<SessionOutboundMessage, { type: "providers_snapshot_update" }> = {
    type: "providers_snapshot_update",
    payload: {
      entries: [{ provider: "codex", status: "ready", enabled: true, models: [] }],
      generatedAt: "2026-01-01T00:01:00.000Z",
    },
  };

  try {
    await applyProvidersSnapshotUpdate({ client, queryClient, serverId, message });
    expect(queryClient.getQueryData(projectKey)).toBeUndefined();

    const returningObserver = new QueryObserver(queryClient, {
      queryKey: projectKey,
      queryFn: async () => refreshed,
      enabled: true,
      gcTime: Infinity,
      staleTime: Infinity,
      refetchOnMount: false,
    });
    const unsubscribeReturningObserver = returningObserver.subscribe(() => undefined);
    try {
      await expect.poll(() => returningObserver.getCurrentResult().data).toEqual(refreshed);
    } finally {
      unsubscribeReturningObserver();
    }
  } finally {
    queryClient.clear();
  }
});
