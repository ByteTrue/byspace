import { createServer, type Server } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startIsolatedHostDaemon } from "./isolated-host-daemon";

export interface OutdatedDaemon {
  endpoint: string;
  label: string;
  serverId: string;
  close(): Promise<void>;
}

const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const SERVER_ID = "outdated-host";

// The daemon this fixture starts reports a version the app does not have, because the host page
// renders the update card only when the two disagree. Copying `bin/byspace` cannot do that — it is
// built at the app's version — so the binary is built here with an older one.
const OUTDATED_VERSION = "0.0.1-e2e-outdated";

// How long the fake release host stalls before answering. The host page renders the update button's
// phase label only while the request is in flight, so the download has to last long enough to be
// observed; a local answer would come back within a frame and the label would never appear.
const RELEASE_STALL_MS = 750;

// Builds the daemon at OUTDATED_VERSION into the given directory.
function buildOutdatedDaemon(binary: string): void {
  execFileSync(
    "go",
    [
      "build",
      "-tags",
      "nogui",
      "-ldflags",
      `-X main.version=${OUTDATED_VERSION}`,
      "-o",
      binary,
      ".",
    ],
    { cwd: REPO_ROOT, stdio: "pipe" },
  );
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
  buildOutdatedDaemon(binary);
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
