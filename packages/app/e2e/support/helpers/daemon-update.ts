import { createServer, type Server } from "node:http";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { startIsolatedHostDaemon } from "./isolated-host-daemon";

export interface OutdatedDaemon {
  endpoint: string;
  label: string;
  serverId: string;
  close(): Promise<void>;
}

const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const GO_DAEMON_BINARY = path.join(REPO_ROOT, "bin", "byspace");
const SERVER_ID = "outdated-host";

// How long the fake release host stalls before answering. The host page renders the update button's
// phase label only while the request is in flight, so the download has to last long enough to be
// observed; a local answer would come back within a frame and the label would never appear.
const RELEASE_STALL_MS = 750;

function resolveGoDaemonBinary(): string {
  if (process.env.BYSPACE_E2E_DAEMON_BINARY) return process.env.BYSPACE_E2E_DAEMON_BINARY;
  if (!existsSync(GO_DAEMON_BINARY)) {
    throw new Error(
      `Go daemon binary not found at ${GO_DAEMON_BINARY}. Run \`make build\` first ` +
        `(or point BYSPACE_E2E_DAEMON_BINARY at a built binary).`,
    );
  }
  return GO_DAEMON_BINARY;
}

// A release host that stalls, then refuses. Pointing the daemon at it with
// BYSPACE_RELEASE_BASE_URL exercises the real download path offline: the update moves through
// starting → downloading and then fails with the status the client renders.
async function startFailingReleaseHost(): Promise<{ server: Server; url: string }> {
  const server = createServer((_request, response) => {
    setTimeout(() => {
      response.statusCode = 500;
      response.end("release unavailable\n");
    }, RELEASE_STALL_MS);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("failing release host did not bind a port");
  }
  return { server, url: `http://127.0.0.1:${address.port}` };
}

// A daemon that offers self-update and then fails it, so the settings host page has a real
// failure to render. The failure is a download failure against the local release host above, not
// a stubbed response: the daemon really fetches, really gets a 500, and reports it.
export async function startOutdatedDaemon(): Promise<OutdatedDaemon> {
  const binaryDir = await mkdtemp(path.join(tmpdir(), "byspace-e2e-outdated-"));
  const binary = path.join(binaryDir, "byspace");
  await copyFile(resolveGoDaemonBinary(), binary);
  const releaseHost = await startFailingReleaseHost();

  const cleanup = async (): Promise<void> => {
    await new Promise<void>((resolve) => releaseHost.server.close(() => resolve()));
    await rm(binaryDir, { recursive: true, force: true }).catch(() => undefined);
  };

  let daemon: Awaited<ReturnType<typeof startIsolatedHostDaemon>>;
  try {
    daemon = await startIsolatedHostDaemon(SERVER_ID, {
      daemonBinary: binary,
      environment: { NODE_ENV: "development", BYSPACE_RELEASE_BASE_URL: releaseHost.url },
    });
  } catch (error) {
    await cleanup();
    throw error;
  }

  return {
    endpoint: `127.0.0.1:${daemon.port}`,
    label: "outdated host",
    serverId: daemon.serverId,
    async close() {
      await daemon.close();
      await cleanup();
    },
  };
}
