import { afterEach, describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { createAgentProviderRuntime } from "./provider-runtime.js";
import { OpenCodeBridge } from "./providers/opencode/bridge.js";
import type { BySpaceToolCatalog } from "./tools/types.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("agent provider runtime", () => {
  test("owns bridge injection, catalog forwarding, and idempotent shutdown", async () => {
    vi.spyOn(OpenCodeBridge.prototype, "start").mockResolvedValue();
    const setManifestCatalog = vi
      .spyOn(OpenCodeBridge.prototype, "setManifestCatalog")
      .mockImplementation(() => undefined);
    const close = vi.spyOn(OpenCodeBridge.prototype, "close").mockResolvedValue();
    const runtime = await createAgentProviderRuntime({
      byspaceHome: "/tmp/byspace-provider-runtime-test",
      logger: createTestLogger(),
      snapshotManager: {},
    });
    const catalog = emptyCatalog();

    expect(
      runtime.snapshotManager.getAgentManagerProviderState().clients.opencode?.capabilities
        .supportsNativeBySpaceTools,
    ).toBe(true);
    runtime.setBySpaceToolCatalog(catalog);
    await Promise.all([runtime.shutdown(), runtime.shutdown()]);

    expect(setManifestCatalog).toHaveBeenCalledOnce();
    expect(setManifestCatalog).toHaveBeenCalledWith(catalog);
    expect(close).toHaveBeenCalledOnce();
  });

  test("closes the bridge when startup fails", async () => {
    vi.spyOn(OpenCodeBridge.prototype, "start").mockRejectedValue(new Error("startup failed"));
    const close = vi.spyOn(OpenCodeBridge.prototype, "close").mockResolvedValue();

    await expect(
      createAgentProviderRuntime({
        byspaceHome: "/tmp/byspace-provider-runtime-test",
        logger: createTestLogger(),
        snapshotManager: {},
      }),
    ).rejects.toThrow("startup failed");
    expect(close).toHaveBeenCalledOnce();
  });
});

function emptyCatalog(): BySpaceToolCatalog {
  return {
    tools: new Map(),
    getTool: () => undefined,
    executeTool: async () => {
      throw new Error("Unknown tool");
    },
  };
}
