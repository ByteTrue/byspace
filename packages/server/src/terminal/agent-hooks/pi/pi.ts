import type { AgentHookActivityState, AgentHookProvider } from "../agent-hook-installer.js";
import { PI_TERMINAL_ACTIVITY_EXTENSION_SOURCE } from "./pi-extension.js";

const PI_EVENT_STATES: Record<string, AgentHookActivityState> = {
  before_agent_start: "running",
  agent_start: "running",
  tool_execution_end: "running",
  needs_input: "needs-input",
  agent_settled: "idle",
  agent_end: "idle",
};

export const piAgentHookProvider: AgentHookProvider = {
  id: "pi",
  events: Object.keys(PI_EVENT_STATES).map((event) => ({ event })),
  install: {
    kind: "plugin-file",
    configDir: ".pi/agent",
    configFile: "extensions/byspace-terminal-activity.ts",
    configDirEnvOverride: "PI_CODING_AGENT_DIR",
    hookMarker: "byspace.pi-terminal-activity",
    source: PI_TERMINAL_ACTIVITY_EXTENSION_SOURCE,
  },
  async resolveActivity({ event }) {
    return PI_EVENT_STATES[event] ?? null;
  },
};
