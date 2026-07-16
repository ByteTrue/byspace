import { expect, test } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { ProviderSnapshotManager } from "./provider-snapshot-manager.js";

test("adds a generic ACP provider to a primed snapshot", () => {
  const manager = new ProviderSnapshotManager({ logger: createTestLogger() });
  try {
    manager.getSnapshot();
    manager.applyMutableProviderConfig({
      hermes: {
        extends: "acp",
        label: "Hermes",
        description: "Nous Research self-improving AI agent",
        command: ["hermes", "acp"],
        env: {},
      },
    });

    expect(manager.listRegisteredProviderIds()).toContain("hermes");
    expect(manager.getSnapshot()).toContainEqual(
      expect.objectContaining({ provider: "hermes", label: "Hermes", status: "unavailable" }),
    );
  } finally {
    manager.destroy();
  }
});
