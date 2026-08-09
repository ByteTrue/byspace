import { describe, expect, test, vi } from "vitest";

import { WorkspaceSetupRuntime } from "./workspace-setup-runtime.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("WorkspaceSetupRuntime", () => {
  test("runs post-settlement work after operation rejection and rejects start and stop", async () => {
    const runtime = new WorkspaceSetupRuntime();
    const entered = deferred();
    const release = deferred();
    const operationError = new Error("operation failed");
    const afterSettled = vi.fn(async () => {});
    const start = runtime.start(
      "w1",
      async () => {
        entered.resolve();
        await release.promise;
        throw operationError;
      },
      afterSettled,
    );
    await entered.promise;
    const stop = runtime.stop("w1");
    release.resolve();

    await expect(start).rejects.toBe(operationError);
    await expect(stop).rejects.toBe(operationError);
    expect(afterSettled).toHaveBeenCalledOnce();
  });

  test("external stop waits for pending post-settlement work", async () => {
    const runtime = new WorkspaceSetupRuntime();
    const afterStarted = deferred();
    const releaseAfter = deferred();
    const start = runtime.start(
      "w1",
      async () => {},
      async () => {
        afterStarted.resolve();
        await releaseAfter.promise;
      },
    );
    await afterStarted.promise;

    let stopped = false;
    const stop = runtime.stop("w1").then(() => {
      stopped = true;
      return undefined;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    releaseAfter.resolve();
    await expect(Promise.all([start, stop])).resolves.toEqual([undefined, undefined]);
  });

  test("preserves operation and post-settlement errors in execution order", async () => {
    const runtime = new WorkspaceSetupRuntime();
    const operationError = new Error("operation failed");
    const callbackError = new Error("callback failed");
    const start = runtime.start(
      "w1",
      async () => {
        throw operationError;
      },
      async () => {
        throw callbackError;
      },
    );

    await expect(start).rejects.toMatchObject({ errors: [operationError, callbackError] });
    await expect(runtime.stop("w1")).resolves.toBeUndefined();
  });

  test("start and duplicate stops reject with the same post-settlement error", async () => {
    const runtime = new WorkspaceSetupRuntime();
    const operationEntered = deferred();
    const releaseOperation = deferred();
    const callbackError = new Error("callback failed");
    const start = runtime.start(
      "w1",
      async () => {
        operationEntered.resolve();
        await releaseOperation.promise;
      },
      async () => {
        throw callbackError;
      },
    );
    await operationEntered.promise;

    const firstStop = runtime.stop("w1");
    const secondStop = runtime.stop("w1");
    releaseOperation.resolve();

    await expect(start).rejects.toBe(callbackError);
    await expect(firstStop).rejects.toBe(callbackError);
    await expect(secondStop).rejects.toBe(callbackError);
  });

  test("normal completion and cooperative abort resolve", async () => {
    const runtime = new WorkspaceSetupRuntime();
    await expect(runtime.start("normal", async () => {})).resolves.toBeUndefined();
    await expect(runtime.stop("normal")).resolves.toBeUndefined();

    const entered = deferred();
    const operationAborted = deferred();
    const start = runtime.start("aborted", async (signal) => {
      signal.addEventListener("abort", operationAborted.resolve, { once: true });
      entered.resolve();
      await operationAborted.promise;
    });
    await entered.promise;
    const stop = runtime.stop("aborted");
    await expect(Promise.all([start, stop])).resolves.toEqual([undefined, undefined]);
  });
});
