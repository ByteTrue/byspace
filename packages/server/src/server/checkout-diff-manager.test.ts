import { describe, expect, test, vi } from "vitest";
import { CheckoutDiffManager } from "./checkout-diff-manager.js";

function createManager(getCheckoutDiff = vi.fn(async () => ({ diff: "", structured: [] }))) {
  const manager = new CheckoutDiffManager({ getCheckoutDiff });
  return { getCheckoutDiff, manager };
}

describe("CheckoutDiffManager", () => {
  test("loads a diff once on demand without requiring a working-tree watcher", async () => {
    const { getCheckoutDiff, manager } = createManager(
      vi.fn(async () => ({
        diff: "",
        structured: [{ path: "a.ts", additions: 1, deletions: 0, status: "modified" as const }],
      })),
    );

    const subscription = await manager.subscribe(
      { cwd: "/tmp/repo", compare: { mode: "uncommitted" } },
      vi.fn(),
    );

    expect(subscription.initial.files).toEqual([
      { path: "a.ts", additions: 1, deletions: 0, status: "modified" },
    ]);
    expect(getCheckoutDiff).toHaveBeenCalledTimes(1);
    expect(getCheckoutDiff).toHaveBeenCalledWith(
      "/tmp/repo",
      expect.objectContaining({ mode: "uncommitted", includeStructured: true }),
      undefined,
    );
    expect(manager.getMetrics()).toEqual({
      checkoutDiffTargetCount: 1,
      checkoutDiffSubscriptionCount: 1,
    });

    subscription.unsubscribe();
    expect(manager.getMetrics().checkoutDiffTargetCount).toBe(0);
  });

  test("shares the initial on-demand read between concurrent subscribers", async () => {
    const { getCheckoutDiff, manager } = createManager();

    const [first, second] = await Promise.all([
      manager.subscribe({ cwd: "/tmp/repo", compare: { mode: "uncommitted" } }, vi.fn()),
      manager.subscribe({ cwd: "/tmp/repo", compare: { mode: "uncommitted" } }, vi.fn()),
    ]);

    expect(getCheckoutDiff).toHaveBeenCalledTimes(1);
    expect(manager.getMetrics().checkoutDiffSubscriptionCount).toBe(2);
    first.unsubscribe();
    second.unsubscribe();
  });

  test("refreshes active diffs only when explicitly requested", async () => {
    const getCheckoutDiff = vi
      .fn()
      .mockResolvedValueOnce({
        diff: "",
        structured: [{ path: "a.ts", additions: 1, deletions: 0, status: "modified" }],
      })
      .mockResolvedValueOnce({
        diff: "",
        structured: [{ path: "b.ts", additions: 2, deletions: 0, status: "modified" }],
      });
    const { manager } = createManager(getCheckoutDiff);
    const listener = vi.fn();
    const subscription = await manager.subscribe(
      { cwd: "/tmp/repo", compare: { mode: "uncommitted" } },
      listener,
    );

    manager.scheduleRefreshForCwd("/tmp/repo");

    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    expect(listener).toHaveBeenCalledWith({
      cwd: "/tmp/repo",
      files: [{ path: "b.ts", additions: 2, deletions: 0, status: "modified" }],
      error: null,
    });
    expect(getCheckoutDiff).toHaveBeenLastCalledWith(
      "/tmp/repo",
      expect.objectContaining({ mode: "uncommitted" }),
      { force: true, reason: "explicit-refresh" },
    );

    subscription.unsubscribe();
  });

  test("does not emit when an explicit refresh produces the same payload", async () => {
    const { manager } = createManager();
    const listener = vi.fn();
    const subscription = await manager.subscribe(
      { cwd: "/tmp/repo", compare: { mode: "uncommitted" } },
      listener,
    );

    manager.scheduleRefreshForCwd("/tmp/repo");

    await vi.waitFor(() => expect(manager.getMetrics().checkoutDiffTargetCount).toBe(1));
    expect(listener).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });

  test("serializes a mutation refresh behind an in-flight initial read", async () => {
    interface DiffResult {
      diff: string;
      structured: Array<{
        path: string;
        additions: number;
        deletions: number;
        status: "modified";
      }>;
    }
    let resolveInitial!: (value: DiffResult) => void;
    const initial = new Promise<DiffResult>((resolve) => {
      resolveInitial = resolve;
    });
    const getCheckoutDiff = vi
      .fn()
      .mockImplementationOnce(() => initial)
      .mockResolvedValueOnce({
        diff: "",
        structured: [{ path: "fresh.ts", additions: 1, deletions: 0, status: "modified" }],
      });
    const { manager } = createManager(getCheckoutDiff);
    const listener = vi.fn();
    const subscriptionPromise = manager.subscribe(
      { cwd: "/tmp/repo", compare: { mode: "uncommitted" } },
      listener,
    );

    await vi.waitFor(() => expect(getCheckoutDiff).toHaveBeenCalledTimes(1));
    manager.scheduleRefreshForCwd("/tmp/repo");
    await Promise.resolve();
    expect(getCheckoutDiff).toHaveBeenCalledTimes(1);

    resolveInitial({
      diff: "",
      structured: [{ path: "stale.ts", additions: 1, deletions: 0, status: "modified" }],
    });
    const subscription = await subscriptionPromise;
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    expect(listener).toHaveBeenCalledWith({
      cwd: "/tmp/repo",
      files: [{ path: "fresh.ts", additions: 1, deletions: 0, status: "modified" }],
      error: null,
    });

    const second = await manager.subscribe(
      { cwd: "/tmp/repo", compare: { mode: "uncommitted" } },
      vi.fn(),
    );
    expect(second.initial.files).toEqual([
      { path: "fresh.ts", additions: 1, deletions: 0, status: "modified" },
    ]);
    expect(getCheckoutDiff).toHaveBeenCalledTimes(2);
    subscription.unsubscribe();
    second.unsubscribe();
  });
});
