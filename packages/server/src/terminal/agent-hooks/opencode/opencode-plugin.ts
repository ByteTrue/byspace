import type { AgentHookPluginFileInstallStrategy } from "../agent-hook-installer.js";

const OPENCODE_PLUGIN_MARKER = "byspace.opencode-terminal-activity";

function createOpenCodePluginSource(includeMarker: boolean): string {
  return [
    ...(includeMarker ? [`// ${OPENCODE_PLUGIN_MARKER}`] : []),
    "const STATUS_EVENTS = {",
    '  busy: "session.status.busy",',
    '  retry: "session.status.retry",',
    '  idle: "session.status.idle",',
    "};",
    "",
    "function byspaceEventFor(event) {",
    '  if (event?.type === "permission.asked") return "permission.asked";',
    '  if (event?.type === "permission.replied") return "permission.replied";',
    '  if (event?.type !== "session.status") return null;',
    "  return STATUS_EVENTS[event?.properties?.status?.type] ?? null;",
    "}",
    "",
    "function runBySpaceHook(event) {",
    "  if (!process.env.BYSPACE_TERMINAL_ID) return;",
    "  try {",
    '    const child = Bun.spawn(["byspace", "hooks", "opencode", event], {',
    '      stdin: "ignore",',
    '      stdout: "ignore",',
    '      stderr: "ignore",',
    "    });",
    "    void child.exited.catch(() => {});",
    "  } catch {}",
    "}",
    "",
    "export default async () => ({",
    "  event: async ({ event }) => {",
    "    const byspaceEvent = byspaceEventFor(event);",
    "    if (byspaceEvent) runBySpaceHook(byspaceEvent);",
    "  },",
    "});",
    "",
  ].join("\n");
}

export const OPENCODE_PLUGIN_SOURCE = createOpenCodePluginSource(true);
const LEGACY_OPENCODE_PLUGIN_SOURCE = createOpenCodePluginSource(false);

export function createOpenCodePluginInstallStrategy(): AgentHookPluginFileInstallStrategy {
  return {
    kind: "plugin-file",
    configDir: "opencode",
    configDirBase: "xdg-config",
    configFile: "plugins/byspace-terminal-activity.js",
    configDirEnvOverride: "OPENCODE_CONFIG_DIR",
    hookMarker: OPENCODE_PLUGIN_MARKER,
    source: OPENCODE_PLUGIN_SOURCE,
    legacySources: [LEGACY_OPENCODE_PLUGIN_SOURCE],
  };
}
