import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import path from "node:path";

export interface ForgeCapableDaemon {
  endpoint: string;
  serverId: string;
  close(): Promise<void>;
}

type DaemonMessage =
  | { type: "ready"; endpoint: string; serverId: string }
  | { type: "error"; error: string };

export async function startForgeCapableDaemon(): Promise<ForgeCapableDaemon> {
  const metroPort = process.env.E2E_METRO_PORT;
  if (!metroPort) throw new Error("E2E_METRO_PORT is not set - globalSetup must run first");

  const child = fork(
    path.resolve(
      __dirname,
      "../../../server/src/server/test-utils/forge-capable-daemon-process.ts",
    ),
    {
      env: { ...process.env, E2E_METRO_PORT: metroPort },
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  const stderr: string[] = [];
  child.stderr?.on("data", (data: Buffer) => stderr.push(data.toString("utf8")));

  try {
    const ready = await waitForDaemon(child, stderr);
    return {
      endpoint: ready.endpoint,
      serverId: ready.serverId,
      async close() {
        if (child.exitCode !== null || child.signalCode !== null) return;
        child.kill("SIGTERM");
        await once(child, "exit");
      },
    };
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
}

function waitForDaemon(
  child: ChildProcess,
  stderr: string[],
): Promise<Extract<DaemonMessage, { type: "ready" }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out starting forge-capable daemon. ${stderr.join("")}`)),
      20_000,
    );
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `Forge-capable daemon exited before startup (code ${String(code)}, signal ${String(signal)}). ${stderr.join("")}`,
        ),
      );
    });
    child.once("message", (message: DaemonMessage) => {
      clearTimeout(timeout);
      if (message.type === "error") reject(new Error(message.error));
      else resolve(message);
    });
  });
}
