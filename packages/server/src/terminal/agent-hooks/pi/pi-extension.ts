export const PI_ASK_USER_TOOL_NAMES = [
  "ask",
  "ask_user",
  "question",
  "ask_user_question",
  "askuserquestion",
] as const;

export const PI_TERMINAL_ACTIVITY_EXTENSION_SOURCE = `// byspace.pi-terminal-activity
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ownerPidKey = "BYSPACE_PI_TERMINAL_HOOK_OWNER_PID";

type ActivityState = "running" | "idle" | "needs-input";

function report(state: ActivityState): void {
  const url = process.env.BYSPACE_TERMINAL_ACTIVITY_URL;
  const terminalId = process.env.BYSPACE_TERMINAL_ID;
  const token = process.env.BYSPACE_ACTIVITY_TOKEN;
  if (!url || !terminalId || !token) return;

  void fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ terminalId, token, state }),
    signal: AbortSignal.timeout(1_000),
  }).catch(() => {});
}

function isAskUserTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase().replaceAll("-", "_");
  return ${JSON.stringify(PI_ASK_USER_TOOL_NAMES)}.includes(normalized);
}

export default function byspaceTerminalActivity(pi: ExtensionAPI): void {
  const ownerPid = process.env[ownerPidKey];
  if (ownerPid && ownerPid !== String(process.pid)) return;
  process.env[ownerPidKey] = String(process.pid);

  pi.on("agent_start", () => report("running"));
  pi.on("tool_execution_start", (event) => {
    if (isAskUserTool(event.toolName)) report("needs-input");
  });
  pi.on("tool_execution_end", (event) => {
    if (isAskUserTool(event.toolName)) report("running");
  });
  pi.on("agent_settled", () => report("idle"));
  pi.on("session_shutdown", () => report("idle"));
}
`;
