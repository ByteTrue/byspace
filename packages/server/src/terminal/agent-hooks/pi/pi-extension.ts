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
  const url =
    process.env.BYSPACE_TERMINAL_ACTIVITY_URL ?? process.env.PASEO_TERMINAL_ACTIVITY_URL;
  const terminalId = process.env.BYSPACE_TERMINAL_ID ?? process.env.PASEO_TERMINAL_ID;
  const token = process.env.BYSPACE_ACTIVITY_TOKEN ?? process.env.PASEO_ACTIVITY_TOKEN;
  if (!url || !terminalId || !token) return reportQueue.wait();

  return reportQueue.enqueue({ url, terminalId, token, state });
}

export default function byspaceTerminalActivity(pi) {
  const ownerPid = process.env[ownerPidKey];
  if (ownerPid && ownerPid !== String(process.pid)) return;
  process.env[ownerPidKey] = String(process.pid);

  pi.on("agent_start", () => void report("running"));
  pi.on("ui_prompt_start", () => void report("needs-input"));
  pi.on("ui_prompt_end", () => void report("running"));
  pi.on("agent_settled", () => void report("idle"));
  pi.on("session_shutdown", () => report("idle"));
}
`;
