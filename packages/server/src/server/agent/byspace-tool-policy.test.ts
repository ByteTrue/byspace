import { describe, expect, test } from "vitest";
import type { ProviderBySpaceToolsPolicy } from "@bytetrue/protocol/provider-config";

import { isBySpaceToolEnabled, resolveBySpaceToolPolicy } from "./byspace-tool-policy.js";

describe("BySpace tool policy", () => {
  test("defaults to all BySpace tools and resolves only the exact provider ID", () => {
    const customPolicy = {
      enabled: true,
      disabledTools: ["list_agents"],
    } satisfies ProviderBySpaceToolsPolicy;

    expect(
      resolveBySpaceToolPolicy("custom-claude", {
        claude: { byspaceTools: { enabled: false } },
        "custom-claude": { byspaceTools: customPolicy },
      }),
    ).toBe(customPolicy);
    expect(
      resolveBySpaceToolPolicy("other-custom", { claude: { byspaceTools: customPolicy } }),
    ).toBe(undefined);
    expect(isBySpaceToolEnabled(undefined, "list_agents")).toBe(true);
  });

  test("applies the provider gate and sparse disabled tools without filtering speak", () => {
    expect(isBySpaceToolEnabled({ enabled: false }, "list_agents")).toBe(false);
    expect(isBySpaceToolEnabled({ enabled: false }, "speak")).toBe(true);
    expect(
      isBySpaceToolEnabled({ enabled: true, disabledTools: ["list_agents"] }, "list_agents"),
    ).toBe(false);
    expect(
      isBySpaceToolEnabled({ enabled: true, disabledTools: ["list_agents"] }, "create_agent"),
    ).toBe(true);
  });
});
