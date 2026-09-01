import type { AgentHookActivityState, AgentHookProvider } from "../agent-hook-installer.js";
import { PI_TERMINAL_ACTIVITY_EXTENSION_SOURCE } from "./pi-extension.js";

const PI_EVENT_STATES: Record<string, AgentHookActivityState> = {
  agent_start: "running",
  ui_prompt_start: "needs-input",
  ui_prompt_end: "running",
  agent_settled: "idle",
  session_shutdown: "idle",
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
    ownedFileMarker: "// byspace.pi-terminal-activity",
    source: PI_TERMINAL_ACTIVITY_EXTENSION_SOURCE,
  },
  async resolveActivity({ event }) {
    return PI_EVENT_STATES[event] ?? null;
  },
};
