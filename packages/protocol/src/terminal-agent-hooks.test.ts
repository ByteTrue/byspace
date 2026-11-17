import { describe, expect, it } from "vitest";
import { MutableDaemonConfigPatchSchema, MutableDaemonConfigSchema } from "./messages.js";

const baseConfig = {
  providers: {},
  metadataGeneration: { providers: [] },
};

describe("terminal agent hook provider settings", () => {
  it("accepts partial provider-keyed settings and patches", () => {
    const parsed = MutableDaemonConfigSchema.parse({
      ...baseConfig,
      terminalAgentHooks: { claude: true, pi: false },
    });
    const patch = MutableDaemonConfigPatchSchema.parse({
      terminalAgentHooks: { pi: true },
    });

    expect(parsed.terminalAgentHooks).toEqual({ claude: true, pi: false });
    expect(patch.terminalAgentHooks).toEqual({ pi: true });
  });
});
