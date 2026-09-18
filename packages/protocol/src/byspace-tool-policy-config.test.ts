import { describe, expect, test } from "vitest";

import { MutableDaemonConfigPatchSchema, MutableDaemonConfigSchema } from "./messages.js";
import { ProviderOverrideSchema, ProviderBySpaceToolsPolicySchema } from "./provider-config.js";

describe("provider BySpace-tool policy", () => {
  test("accepts arbitrary tool IDs and leaves an empty policy enabled by default", () => {
    expect(
      ProviderBySpaceToolsPolicySchema.parse({
        disabledTools: ["future_tool", "browser_future_tool"],
      }),
    ).toEqual({
      disabledTools: ["future_tool", "browser_future_tool"],
    });
    expect(ProviderBySpaceToolsPolicySchema.parse({})).toEqual({});
    expect(ProviderOverrideSchema.parse({}).byspaceTools).toBeUndefined();
  });

  test("accepts byspaceTools on persisted provider overrides", () => {
    expect(
      ProviderOverrideSchema.parse({
        extends: "claude",
        byspaceTools: {
          enabled: false,
          disabledTools: ["create_workspace"],
        },
      }).byspaceTools,
    ).toEqual({
      enabled: false,
      disabledTools: ["create_workspace"],
    });
  });

  test("accepts byspaceTools when reading and patching mutable daemon providers", () => {
    expect(
      MutableDaemonConfigSchema.parse({
        mcp: { injectIntoAgents: true },
        providers: {
          codex: {
            byspaceTools: { enabled: false, disabledTools: ["future_tool"] },
          },
        },
      }).providers.codex?.byspaceTools,
    ).toEqual({
      enabled: false,
      disabledTools: ["future_tool"],
    });

    expect(
      MutableDaemonConfigPatchSchema.parse({
        providers: {
          codex: {
            byspaceTools: { disabledTools: ["browser_future_tool"] },
          },
        },
      }).providers?.codex?.byspaceTools,
    ).toEqual({ disabledTools: ["browser_future_tool"] });
  });
});
