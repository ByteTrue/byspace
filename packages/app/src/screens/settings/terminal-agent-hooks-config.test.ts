import { describe, expect, it } from "vitest";
import {
  createTerminalAgentHookPatch,
  isTerminalAgentHookProviderEnabled,
  TERMINAL_AGENT_HOOK_PROVIDERS,
} from "./terminal-agent-hooks-config";

describe("terminal agent hook provider settings", () => {
  it("uses the legacy global value only while the provider map is absent", () => {
    expect(isTerminalAgentHookProviderEnabled(undefined, false, "claude")).toBe(false);
    expect(isTerminalAgentHookProviderEnabled(undefined, true, "codex")).toBe(true);
    expect(isTerminalAgentHookProviderEnabled({ claude: true }, true, "codex")).toBe(false);
    expect(isTerminalAgentHookProviderEnabled({ claude: true }, false, "claude")).toBe(true);
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
