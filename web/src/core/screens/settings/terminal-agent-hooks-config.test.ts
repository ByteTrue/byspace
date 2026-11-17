import { describe, expect, it } from "vitest";
import {
  createTerminalAgentHookPatch,
  isTerminalAgentHookProviderEnabled,
  TERMINAL_AGENT_HOOK_PROVIDERS,
} from "./terminal-agent-hooks-config";

describe("terminal agent hook provider settings", () => {
  it("reads enablement from the provider map", () => {
    expect(isTerminalAgentHookProviderEnabled(undefined, "claude")).toBe(false);
    expect(isTerminalAgentHookProviderEnabled({ claude: true }, "codex")).toBe(false);
    expect(isTerminalAgentHookProviderEnabled({ claude: true }, "claude")).toBe(true);
  });

  it("creates a provider-scoped daemon config patch", () => {
    expect(createTerminalAgentHookPatch("pi", true)).toEqual({
      terminalAgentHooks: { pi: true },
    });
  });

  it("exposes the four supported terminal providers", () => {
    expect(TERMINAL_AGENT_HOOK_PROVIDERS.map((provider) => provider.id)).toEqual([
      "claude",
      "codex",
      "opencode",
      "pi",
    ]);
  });
});
