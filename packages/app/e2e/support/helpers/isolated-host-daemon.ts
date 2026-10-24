import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { withDisabledE2ESpeechEnv } from "./speech-env";
import { killProcessTree } from "./spawn-node";

// The daemon under test is the Go single binary (internal/, cmd/byspace). The Node daemon
// lived in packages/server and is archived; specs, routes and the wire protocol are
// unchanged, so this file is the only place that needed to know which language hosts it.
const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const GO_DAEMON_BINARY = path.join(REPO_ROOT, "bin", "byspace");

function resolveGoDaemonBinary(): string {
  if (process.env.BYSPACE_E2E_DAEMON_BINARY) return process.env.BYSPACE_E2E_DAEMON_BINARY;
  if (!existsSync(GO_DAEMON_BINARY)) {
    throw new Error(
      `Go daemon binary not found at ${GO_DAEMON_BINARY}. Run \`make build-full\` first ` +
        `(or point BYSPACE_E2E_DAEMON_BINARY at a built binary).`,
    );
  }
  return GO_DAEMON_BINARY;
}

export interface IsolatedHostDaemon {
  serverId: string;
  port: number;
  byspaceHome: string;
  getPid(): number | undefined;
  restart(): Promise<void>;
  close(): Promise<void>;
}

export interface IsolatedHostDaemonOptions {
  environment?: NodeJS.ProcessEnv;
  mutableRelay?: {
    enabled: boolean;
    endpoint?: string;
  };
  /** Merged over the mutableRelay daemon block (auth, tunnel, ...). */
  daemonConfig?: Record<string, unknown>;
  byspaceHome?: string;
  preserveHome?: boolean;
  /**
   * Test a daemon binary other than bin/byspace — used to exercise a released or
   * otherwise prebuilt binary. Replaces the old `publishedVersion` npm install path,
   * which only existed because the daemon used to ship as an npm package.
   */
  daemonBinary?: string;
}

async function writeIsolatedDaemonConfig(
  byspaceHome: string,
  options: IsolatedHostDaemonOptions,
): Promise<void> {
  if (!options.mutableRelay && !options.daemonConfig) return;
  const endpoint =
    options.mutableRelay?.endpoint ??
    (process.env.E2E_RELAY_PORT ? `127.0.0.1:${process.env.E2E_RELAY_PORT}` : "127.0.0.1:9");
  await writeFile(
    path.join(byspaceHome, "config.json"),
    `${JSON.stringify({
      version: 1,
      daemon: {
        ...(options.mutableRelay
          ? {
              relay: {
                enabled: options.mutableRelay.enabled,
                endpoint,
                publicEndpoint: endpoint,
                useTls: false,
                publicUseTls: false,
              },
            }
          : {}),
        ...options.daemonConfig,
      },
    })}\n`,
  );
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to acquire an isolated daemon port")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 90_000;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Isolated host daemon exited before listening (code ${String(child.exitCode)}, signal ${String(child.signalCode)})`,
      );
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1", () => {
          socket.end();
          resolve();
        });
        socket.setTimeout(1_000, () => {
          socket.destroy();
          reject(new Error(`Connection timed out to isolated daemon port ${port}`));
        });
        socket.on("error", reject);
      });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error(
    `Isolated host daemon did not listen on ${port}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

export async function startIsolatedHostDaemon(
  serverId: string,
  options: IsolatedHostDaemonOptions = {},
): Promise<IsolatedHostDaemon> {
  const primaryPort = Number(process.env.E2E_DAEMON_PORT ?? 0);
  let port = await getAvailablePort();
  while (port === 6767 || port === 6777 || port === primaryPort) port = await getAvailablePort();

  const metroPort = process.env.E2E_METRO_PORT;
  if (!metroPort) throw new Error("E2E_METRO_PORT is required to start an isolated host daemon");

  const byspaceHome =
    options.byspaceHome ?? (await mkdtemp(path.join(tmpdir(), "byspace-e2e-secondary-host-")));
  await writeIsolatedDaemonConfig(byspaceHome, options);

  const spawnDaemon = async (): Promise<ChildProcess> => {
    // Every daemon this helper can start now speaks the current protocol: the
    // in-repo one, and any published version new enough to parse this app's
    // wire names. Both read the BYSPACE_* variables only.
    const daemonEnv: Record<string, string | undefined> = {
      BYSPACE_HOME: byspaceHome,
      BYSPACE_LISTEN: `127.0.0.1:${port}`,
      BYSPACE_SERVER_ID: serverId,
      // The web app runs on the Metro origin during E2E, which is cross-origin to the daemon.
      BYSPACE_CORS_ORIGINS: `http://localhost:${metroPort},http://127.0.0.1:${metroPort}`,
      // Specs assert exact workspace counts; the daemon-owned Chief workspace
      // would shift them by one.
      BYSPACE_DISABLE_HOME_WORKSPACE: "1",
    };
    const spawnOptions: SpawnOptions = {
      cwd: REPO_ROOT,
      env: withDisabledE2ESpeechEnv({
        ...process.env,
        ...options.environment,
        ...daemonEnv,
        NODE_ENV: "development",
      }),
      stdio: ["ignore", "ignore", "pipe"],
      detached: false,
    };
    // `byspace serve` reads BYSPACE_HOME / BYSPACE_LISTEN / BYSPACE_SERVER_ID from the
    // environment, matching how the Node supervisor was configured.
    const child = spawn(options.daemonBinary ?? resolveGoDaemonBinary(), ["serve"], spawnOptions);

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      stderr = stderr.split("\n").slice(-40).join("\n");
    });

    try {
      await waitForServer(port, child);
      return child;
    } catch (error) {
      await killProcessTree(child);
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nDaemon stderr:\n${stderr}`,
        { cause: error },
      );
    }
  };

  let child: ChildProcess;
  try {
    child = await spawnDaemon();
  } catch (error) {
    if (!options.preserveHome) {
      await rm(byspaceHome, { recursive: true, force: true });
    }
    throw error;
  }
  let closed = false;

  return {
    serverId,
    port,
    byspaceHome,
    getPid: () => child.pid,
    restart: async () => {
      if (closed) throw new Error(`Cannot restart closed isolated daemon ${serverId}`);
      await killProcessTree(child);
      child = await spawnDaemon();
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await killProcessTree(child);
      if (!options.preserveHome) {
        await rm(byspaceHome, { recursive: true, force: true });
      }
    },
  };
}
