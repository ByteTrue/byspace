export const PI_ASK_USER_TOOL_NAMES = [
  "ask",
  "ask_user",
  "question",
  "ask_user_question",
  "askuserquestion",
] as const;

export const PI_TERMINAL_ACTIVITY_EXTENSION_SOURCE = `// byspace.pi-terminal-activity
const ownerPidKey = "BYSPACE_PI_TERMINAL_HOOK_OWNER_PID";
// Keep one request in flight and only the latest state waiting behind it.
export function createReportQueue(sendReport) {
  let pendingReport;
  let reporting;

  async function flushReports() {
    while (pendingReport) {
      const next = pendingReport;
      pendingReport = undefined;
      try {
        await sendReport(next);
      } catch {}
    }
    reporting = undefined;
  }

  return {
    enqueue(next) {
      pendingReport = next;
      // Assign the drain before a synchronous transport failure can finish it.
      reporting ??= Promise.resolve().then(flushReports);
      return reporting;
    },
    wait() {
      return reporting ?? Promise.resolve();
    },
  };
}

async function sendReport(next) {
  await fetch(next.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      terminalId: next.terminalId,
      token: next.token,
      state: next.state,
    }),
    signal: AbortSignal.timeout(1_000),
  });
}

const reportQueue = createReportQueue(sendReport);

function report(state) {
  const url = process.env.BYSPACE_TERMINAL_ACTIVITY_URL;
  const terminalId = process.env.BYSPACE_TERMINAL_ID;
  const token = process.env.BYSPACE_ACTIVITY_TOKEN;
  if (!url || !terminalId || !token) return reportQueue.wait();

  return reportQueue.enqueue({ url, terminalId, token, state });
}

function isAskUserTool(toolName) {
  const normalized = toolName.toLowerCase().replaceAll("-", "_");
  return ${JSON.stringify(PI_ASK_USER_TOOL_NAMES)}.includes(normalized);
}

export default function byspaceTerminalActivity(pi) {
  const ownerPid = process.env[ownerPidKey];
  if (ownerPid && ownerPid !== String(process.pid)) return;
  process.env[ownerPidKey] = String(process.pid);

  pi.on("agent_start", () => void report("running"));
  pi.on("tool_execution_start", (event) => {
    if (isAskUserTool(event.toolName)) void report("needs-input");
  });
  pi.on("tool_execution_end", (event) => {
    if (isAskUserTool(event.toolName)) void report("running");
  });
  pi.on("agent_settled", () => void report("idle"));
  pi.on("session_shutdown", () => report("idle"));
}
`;
